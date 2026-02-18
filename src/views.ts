import type { CameraState } from './types.js';
import { formatUptime } from './poller.js';

function statusBadge(reachable: boolean): string {
  return reachable
    ? `<span class="badge badge-ok">● Online</span>`
    : `<span class="badge badge-err">● Offline</span>`;
}

function friendlyError(err: string | null | undefined): string {
  if (!err) return 'Unknown';
  if (err.includes('ECONNREFUSED')) return 'Connection refused (service not running?)';
  if (err.includes('ETIMEDOUT') || err.includes('ESOCKETTIMEDOUT')) return 'Connection timed out';
  if (err.includes('socket hang up') || err.includes('ECONNRESET')) return 'Connection dropped (service may be hung — try Restart)';
  if (err.includes('EHOSTUNREACH') || err.includes('ENETUNREACH')) return 'Host unreachable';
  if (err.includes('ENOTFOUND')) return 'Hostname not found';
  if (err.includes('certificate') || err.includes('SSL') || err.includes('CERT')) return 'TLS/cert error';
  return err;
}

function actionButtons(id: string, reachable: boolean): string {
  const btn = (action: string, label: string, cls: string) =>
    `<button class="btn ${cls}"
      hx-post="/api/${id}/action/${action}"
      hx-target="#body-${id}"
      hx-swap="outerHTML"
      onclick="startAction(this)">${label}</button>`;

  if (reachable) {
    return [
      btn('stop',    'Stop',    'btn-danger'),
      btn('restart', 'Restart', 'btn-warn'),
      btn('hdr_on',  'HDR On',  'btn-info'),
      btn('hdr_off', 'HDR Off', 'btn-muted'),
    ].join('\n      ');
  } else {
    return [
      btn('start',   'Start',   'btn-ok'),
      btn('restart', 'Restart', 'btn-warn'),
    ].join('\n      ');
  }
}

// Shared helpers used by both cameraPanel (initial render) and the exported functions
function buildStatusRows(state: CameraState): string {
  const { status, reachable, last_checked, snapshot_fetched, error } = state;
  const checked = last_checked ? last_checked.toLocaleTimeString() : 'never';
  const snapshotTime = snapshot_fetched ? snapshot_fetched.toLocaleTimeString() : null;
  return reachable && status ? `
    <tr><td>Status</td><td>${statusBadge(true)}</td></tr>
    <tr><td>Uptime</td><td>${formatUptime(status.uptime_seconds)}</td></tr>
    <tr><td>Resolution</td><td>${status.resolution}</td></tr>
    <tr><td>HDR</td><td>${status.hdr ? '<span class="badge badge-ok">On</span>' : '<span class="badge badge-muted">Off</span>'}</td></tr>
    <tr><td>Stream clients</td><td>${status.clients}</td></tr>
    <tr><td>Last checked</td><td>${checked}</td></tr>
    ${snapshotTime ? `<tr><td>Last snapshot</td><td>${snapshotTime}</td></tr>` : ''}
  ` : `
    <tr><td>Status</td><td>${statusBadge(false)}</td></tr>
    <tr><td>Error</td><td class="error-text">${friendlyError(error)}</td></tr>
    <tr><td>Last checked</td><td>${checked}</td></tr>
    ${snapshotTime ? `<tr><td>Last snapshot</td><td>${snapshotTime}</td></tr>` : ''}
  `;
}

function buildMediaPane(state: CameraState): string {
  const { config, reachable } = state;
  const snapshotUrl = `/api/${config.id}/snapshot`;
  // Snapshot proxied through our server — avoids browser SSL/CORS issues with Pi certs
  return reachable
    ? `<img src="${config.stream_url}" class="stream" alt="${config.name} live stream"
          onerror="this.onerror=null;this.src='${snapshotUrl}?t='+Date.now()">`
    : `<div class="stream-offline">
         <img src="${snapshotUrl}?t=${Date.now()}" class="stream snapshot"
              alt="" onerror="this.style.display='none'">
         <p class="offline-label">Stream offline — latest snapshot</p>
       </div>`;
}

// The status column (table + buttons), polled every 5s
export function renderStatusFragment(state: CameraState): string {
  const id = state.config.id;
  return `<div id="status-${id}"
    hx-get="/api/${id}/status-fragment"
    hx-trigger="every 5s"
    hx-swap="outerHTML">
    <table class="status-table">${buildStatusRows(state)}</table>
    <div class="panel-actions">
      ${actionButtons(id, state.reachable)}
    </div>
  </div>`;
}

// The full panel body (stream + status column).
// Returned by the action handler so the stream area updates after a restart/start.
export function renderPanelBody(state: CameraState): string {
  const id = state.config.id;
  return `<div class="panel-body" id="body-${id}">
    <div class="col-stream">${buildMediaPane(state)}</div>
    <div class="col-status">${renderStatusFragment(state)}</div>
  </div>`;
}

function cameraPanel(state: CameraState, active: boolean): string {
  const id = state.config.id;
  return `
  <div class="cam-panel${active ? ' active' : ''}" id="panel-${id}">
    ${renderPanelBody(state)}
  </div>`;
}

export function renderPage(states: Map<string, CameraState>): string {
  const cams = Array.from(states.values());
  const [first] = cams;

  const tabs = cams.map(s =>
    `<button class="tab" onclick="showTab('${s.config.id}')" id="tab-${s.config.id}">${s.config.name}</button>`
  ).join('');

  const panels = cams.map((s, i) => cameraPanel(s, i === 0)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Picamera Monitor</title>
  <link rel="stylesheet" href="/style.css">
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
</head>
<body>
  <header>
    <h1>Picamera Monitor</h1>
  </header>
  <nav class="tabs" id="tabs">${tabs}</nav>
  <main id="panels">${panels}</main>
  <script>
    function showTab(id) {
      document.querySelectorAll('.cam-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('panel-' + id).classList.add('active');
      document.getElementById('tab-' + id).classList.add('active');
    }
    // Disable all buttons in the panel during an action, show spinner on active btn
    function startAction(btn) {
      const panel = btn.closest('.cam-panel');
      if (!panel) return;
      const buttons = panel.querySelectorAll('.btn');
      buttons.forEach(b => { b.disabled = true; });
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<span class="btn-spinner"></span> ' + originalHTML;
      // Re-enable after HTMX response (htmx:afterRequest fires on the button)
      btn.addEventListener('htmx:afterRequest', function handler() {
        buttons.forEach(b => { b.disabled = false; });
        btn.innerHTML = originalHTML;
        btn.removeEventListener('htmx:afterRequest', handler);
      }, { once: true });
    }
    // Activate first tab on load
    showTab('${first.config.id}');
  </script>
</body>
</html>`;
}
