import type { CameraState } from './types.js';
import { formatUptime } from './poller.js';

function statusBadge(reachable: boolean): string {
  return reachable
    ? `<span class="badge badge-ok">● Online</span>`
    : `<span class="badge badge-err">● Offline</span>`;
}

function cameraPanel(state: CameraState, active: boolean): string {
  const { config, status, reachable, last_checked, snapshot_fetched, error } = state;
  const id = config.id;
  const checked = last_checked ? last_checked.toLocaleTimeString() : 'never';
  const snapshotTime = snapshot_fetched ? snapshot_fetched.toLocaleTimeString() : null;
  const snapshotUrl = `/api/${id}/snapshot`;

  const statusRows = reachable && status ? `
    <tr><td>Status</td><td>${statusBadge(true)}</td></tr>
    <tr><td>Uptime</td><td>${formatUptime(status.uptime_seconds)}</td></tr>
    <tr><td>Resolution</td><td>${status.resolution}</td></tr>
    <tr><td>HDR</td><td>${status.hdr ? '<span class="badge badge-ok">On</span>' : '<span class="badge badge-muted">Off</span>'}</td></tr>
    <tr><td>Stream clients</td><td>${status.clients}</td></tr>
    <tr><td>Last checked</td><td>${checked}</td></tr>
    ${snapshotTime ? `<tr><td>Last snapshot</td><td>${snapshotTime}</td></tr>` : ''}
  ` : `
    <tr><td>Status</td><td>${statusBadge(false)}</td></tr>
    <tr><td>Error</td><td class="error-text">${error ?? 'Unknown'}</td></tr>
    <tr><td>Last checked</td><td>${checked}</td></tr>
    ${snapshotTime ? `<tr><td>Last snapshot</td><td>${snapshotTime}</td></tr>` : ''}
  `;

  // Snapshot proxied through our server — avoids browser SSL/CORS issues with Pi certs
  const mediaPane = reachable
    ? `<img src="${config.stream_url}" class="stream" alt="${config.name} live stream"
          onerror="this.onerror=null;this.src='${snapshotUrl}?t='+Date.now()">`
    : `<div class="stream-offline">
         <img src="${snapshotUrl}?t=${Date.now()}" class="stream snapshot"
              alt="" onerror="this.style.display='none'">
         <p class="offline-label">Stream offline</p>
       </div>`;

  const actionBtn = (action: string, label: string, cls = '') =>
    `<button class="btn ${cls}"
      hx-post="/api/${id}/action/${action}"
      hx-target="#status-${id}"
      hx-swap="outerHTML"
      onclick="startAction(this)">${label}</button>`;

  return `
  <div class="cam-panel${active ? ' active' : ''}" id="panel-${id}">
    <div class="panel-body">
      <div class="col-stream">${mediaPane}</div>
      <div class="col-status">
        <div id="status-${id}"
          hx-get="/api/${id}/status-fragment"
          hx-trigger="every 5s"
          hx-swap="outerHTML">
          <table class="status-table">${statusRows}</table>
        </div>
      </div>
    </div>
    <div class="panel-actions" id="actions-${id}">
      ${actionBtn('stop',    'Stop',    'btn-danger')}
      ${actionBtn('start',   'Start',   'btn-ok')}
      ${actionBtn('restart', 'Restart', 'btn-warn')}
      ${actionBtn('hdr_on',  'HDR On',  'btn-info')}
      ${actionBtn('hdr_off', 'HDR Off', 'btn-muted')}
    </div>
  </div>`;
}

export function renderStatusFragment(state: CameraState): string {
  const { status, reachable, last_checked, snapshot_fetched, error } = state;
  const checked = last_checked ? last_checked.toLocaleTimeString() : 'never';
  const snapshotTime = snapshot_fetched ? snapshot_fetched.toLocaleTimeString() : null;
  const id = state.config.id;

  const rows = reachable && status ? `
    <tr><td>Status</td><td>${statusBadge(true)}</td></tr>
    <tr><td>Uptime</td><td>${formatUptime(status.uptime_seconds)}</td></tr>
    <tr><td>Resolution</td><td>${status.resolution}</td></tr>
    <tr><td>HDR</td><td>${status.hdr ? '<span class="badge badge-ok">On</span>' : '<span class="badge badge-muted">Off</span>'}</td></tr>
    <tr><td>Stream clients</td><td>${status.clients}</td></tr>
    <tr><td>Last checked</td><td>${checked}</td></tr>
    ${snapshotTime ? `<tr><td>Last snapshot</td><td>${snapshotTime}</td></tr>` : ''}
  ` : `
    <tr><td>Status</td><td>${statusBadge(false)}</td></tr>
    <tr><td>Error</td><td class="error-text">${error ?? 'Unknown'}</td></tr>
    <tr><td>Last checked</td><td>${checked}</td></tr>
    ${snapshotTime ? `<tr><td>Last snapshot</td><td>${snapshotTime}</td></tr>` : ''}
  `;

  return `<div id="status-${id}"
    hx-get="/api/${id}/status-fragment"
    hx-trigger="every 5s"
    hx-swap="outerHTML">
    <table class="status-table">${rows}</table>
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
