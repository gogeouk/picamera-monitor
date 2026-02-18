import express from 'express';
import path from 'path';
import { loadConfig } from './config.js';
import { startPolling } from './poller.js';
import { runAction } from './ssh.js';
import { renderPage, renderStatusFragment } from './views.js';
import type { ControlAction } from './types.js';

const config = loadConfig(process.env.CONFIG_FILE);
const states = startPolling(config.cameras);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Main dashboard page ──────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.send(renderPage(states));
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
