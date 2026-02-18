import express from 'express';
import path from 'path';
import https from 'https';
import http from 'http';
import { loadConfig } from './config.js';
import { startPolling } from './poller.js';
import { runAction } from './ssh.js';
import { renderPage, renderStatusFragment } from './views.js';
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
    await runAction(state.config, action);
    // Brief pause to allow the service to settle before the next poll reflects the change
    await new Promise(r => setTimeout(r, 1500));
    // Return a refreshed status fragment
    res.send(renderStatusFragment(state));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`<div class="error-text">Action failed: ${msg}</div>`);
  }
});

const port = config.port ?? 3000;
app.listen(port, () => {
  console.log(`Picamera Monitor running at http://localhost:${port}`);
  console.log(`Monitoring ${config.cameras.length} camera(s): ${config.cameras.map(c => c.name).join(', ')}`);
});
