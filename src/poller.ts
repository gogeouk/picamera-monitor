import https from 'https';
import http from 'http';
import type { CameraState, CameraStatus, CameraConfig } from './types.js';

const POLL_INTERVAL_MS = 5000;
const FETCH_TIMEOUT_MS = 4000;

function fetchStatus(url: string): Promise<CameraStatus> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data) as CameraStatus); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
    req.on('error', reject);
  });
}

export function startPolling(cameras: CameraConfig[]): Map<string, CameraState> {
  const states = new Map<string, CameraState>();

  for (const cam of cameras) {
    states.set(cam.id, {
      config: cam,
      status: null,
      reachable: false,
      last_checked: null,
      snapshot_fetched: null,
      error: null,
    });
  }

  async function poll(cam: CameraConfig) {
    const state = states.get(cam.id)!;
    try {
      const status = await fetchStatus(cam.status_url);
      state.status = status;
      state.reachable = true;
      state.error = null;
    } catch (err: unknown) {
      state.reachable = false;
      state.status = null;
      state.error = err instanceof Error ? err.message : String(err);
    }
    state.last_checked = new Date();
    states.set(cam.id, { ...state });
  }

  for (const cam of cameras) {
    // Initial poll then repeat
    poll(cam);
    setInterval(() => poll(cam), POLL_INTERVAL_MS);
  }

  return states;
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600) % 24;
  const d = Math.floor(seconds / 86400);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
