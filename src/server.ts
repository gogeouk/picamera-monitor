import express from 'express';
import path from 'path';
import https from 'https';
import http from 'http';
import { loadConfig } from './config.js';
import { startPolling, pollOnce } from './poller.js';
import { runAction } from './ssh.js';
import { renderPage, renderStatusFragment, renderPanelBody } from './views.js';
import type { ControlAction } from './types.js';

const config = loadConfig(process.env.CONFIG_FILE);
const states = startPolling(config.cameras);

// In-memory snapshot cache: id -> { data, contentType, fetched }
const snapshotCache = new Map<string, { data: Buffer; contentType: string; fetched: Date }>();
const SNAPSHOT_TTL_MS = 10_000;

function fetchBuffer(url: string): Promise<{ data: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        data: Buffer.concat(chunks),
        contentType: res.headers['content-type'] ?? 'image/jpeg',
      }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('Snapshot fetch timeout')));
    req.on('error', reject);
  });
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Main dashboard page ──────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.send(renderPage(states));
});

// ── Snapshot proxy (avoids browser SSL/CORS issues with Pi certs) ────────────
app.get('/api/:id/snapshot', async (req, res) => {
  const state = states.get(req.params.id);
  if (!state) return res.status(404).end();

  const cached = snapshotCache.get(req.params.id);
  if (cached && (Date.now() - cached.fetched.getTime()) < SNAPSHOT_TTL_MS) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(cached.data);
  }

  try {
    const { data, contentType } = await fetchBuffer(state.config.snapshot_url);
    const fetched = new Date();
    snapshotCache.set(req.params.id, { data, contentType, fetched });
    state.snapshot_fetched = fetched;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(data);
  } catch {
    // Return cached stale image if available, else 503
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      return res.send(cached.data);
    }
    res.status(503).end();
  }
});

// ── HTMX status fragment (polled every 5s per camera) ────────────────────────
app.get('/api/:id/status-fragment', (req, res) => {
  const state = states.get(req.params.id);
  if (!state) return res.status(404).send('Camera not found');
  res.send(renderStatusFragment(state));
});

// ── JSON status (for external consumers) ─────────────────────────────────────
app.get('/api/:id/status', (req, res) => {
  const state = states.get(req.params.id);
  if (!state) return res.status(404).json({ error: 'Camera not found' });
  res.json(state);
});

app.get('/api/cameras', (_req, res) => {
  res.json(Object.fromEntries(states));
});

// ── Control actions ───────────────────────────────────────────────────────────
app.post('/api/:id/action/:action', async (req, res) => {
  const state = states.get(req.params.id);
  if (!state) return res.status(404).send('Camera not found');

  const action = req.params.action as ControlAction;
  const validActions: ControlAction[] = ['start', 'stop', 'restart', 'hdr_on', 'hdr_off'];
  if (!validActions.includes(action)) {
    return res.status(400).send('Invalid action');
  }

  try {
    const sshResult = await runAction(state.config, action);
    console.log(`[${state.config.id}] action=${action} ssh_result=${JSON.stringify(sshResult)}`);

    if (action === 'stop') {
      // Stop is fast — short wait then poll once
      await new Promise(r => setTimeout(r, 2000));
      if (pollOnce) await pollOnce(state.config);
    } else {
      // start/restart/hdr: camera init can take 10-25s.
      // Poll every 3s until the camera responds (or 30s timeout).
      const deadline = Date.now() + 30000;
      let attempts = 0;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000));
        if (pollOnce) await pollOnce(state.config);
        const current = states.get(state.config.id)!;
        attempts++;
        console.log(`[${state.config.id}] poll attempt ${attempts}: reachable=${current.reachable} error=${current.error}`);
        if (current.reachable) break;
      }
    }

    res.send(renderPanelBody(states.get(state.config.id)!));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${state.config.id}] action=${action} FAILED: ${msg}`);
    // Return a full panel body so HTMX doesn't break the layout
    if (pollOnce) await pollOnce(state.config).catch(() => {});
    const current = states.get(state.config.id)!;
    current.action_error = `Action failed: ${msg}`;
    res.send(renderPanelBody(current));
  }
});

const port = config.port ?? 3000;
app.listen(port, () => {
  console.log(`Picamera Monitor running at http://localhost:${port}`);
  console.log(`Monitoring ${config.cameras.length} camera(s): ${config.cameras.map(c => c.name).join(', ')}`);
});
