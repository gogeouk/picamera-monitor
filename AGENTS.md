# AGENTS.md — picamera-monitor

## What this project is

A Node.js/TypeScript web dashboard for monitoring and controlling one or more [picamera-streamer](https://github.com/gogeouk/picamera-streamer) instances running on Raspberry Pis. It shows live MJPEG streams alongside auto-refreshed status panels and provides SSH-based control buttons (stop / start / restart / HDR on/off).

## Architecture

```
config.yaml          — gitignored; lists cameras with URLs + SSH details
src/
  server.ts          — Express app; routes, startup, action handler
  config.ts          — Loads and validates config.yaml, expands ~ in paths
  poller.ts          — Polls each camera's /status every 5s, holds state in memory
  ssh.ts             — Executes control commands on Pis via SSH (ssh2 library)
  types.ts           — Shared TypeScript interfaces
  views.ts           — Server-side HTML rendering (no template engine, plain TS)
public/
  style.css          — Dark-theme UI styles
Dockerfile           — Production image (node:20-alpine); config + key mounted at runtime
docker-compose.yml   — Mounts ./config.yaml and ~/.ssh/id_ed25519 as read-only volumes
```

## Key design decisions

**No frontend framework.** The UI uses [HTMX](https://htmx.org/) for partial page updates (status fragments refresh every 5s, action buttons swap in results inline). No build step, no bundler, no React overhead.

**SSH for control, not an API on the Pi.** Control commands (start/stop/restart, HDR toggle) run via SSH directly against `systemctl` and `sed` on the Pi's `.env` file. This avoids adding any control surface to the streamer itself and works with the existing SSH key infrastructure.

**HDR toggle pattern.** HDR state lives in the Pi's `.env` file as `HDR=1`/`HDR=0`. The `hdr_on`/`hdr_off` actions stop the service, `sed` the env file, then start the service. The streamer runs `v4l2-ctl` automatically at startup when `HDR=1`, so a single restart is sufficient — no separate stop/v4l2/start sequence needed.

**Self-signed certs tolerated.** The poller uses `rejectUnauthorized: false` when fetching the Pi's `/status` endpoint. This is intentional: the Pi cert is Let's Encrypt but may be self-signed in dev; the Pi streams are internal infrastructure not first-party API calls.

**No auth on the dashboard.** The dashboard has no authentication of its own and is currently reachable at `cams.gogeo.uk`. Basic Auth belongs at the Traefik/nginx layer — see *Security invariants* below.

## Security invariants

The dashboard and its JSON API are **unauthenticated**. Treat every response as public.

**Never send a `CameraState` to a client.** It embeds the full `CameraConfig`, including
`ssh.host`, `ssh.port`, `ssh.username` and `ssh.private_key`. Convert with `toPublicState()`
from `src/redact.ts` first — it returns `PublicCameraState`, which carries `id` and `name` in
place of `config`. `/api/cameras` and `/api/:id/status` both go through it.

**Never render an error message raw.** SSH and socket errors embed the host, port, username
and key path (`connect ECONNREFUSED pi.example.com:8022`). `views.ts` passes `error`,
`pi_error` and `action_error` through `redactError()` before rendering. Note the replacement
order in `redact.ts` matters: the key path usually contains the username, so it must be
substituted first, and the username match is whole-word so a user called `pi` does not turn
`picamera.service` into `<user>camera.service`.

**Escape everything interpolated into HTML.** Use `esc()` in `views.ts`. The Pi's `/status`
JSON is fetched with `rejectUnauthorized: false` and SSH probe output is shell-derived, so
neither is trusted input. `status.resolution` reaching the page unescaped was a stored-XSS
path.

Camera stream and snapshot URLs are *not* secret — they are already embedded in the public
weather site — so they stay in responses deliberately.

**Still outstanding:** Basic Auth at Traefik, and `hostVerifier: () => true` in `ssh.ts`
disables SSH host key verification entirely.

## Development

```bash
npm install
cp config.example.yaml config.yaml
# Fill in config.yaml with your camera details
npm run dev          # tsx watch — restarts on file changes
```

Open [http://localhost:3000](http://localhost:3000).

## Config

`config.yaml` is gitignored and must **never** be committed. It contains real hostnames and SSH paths. Use `config.example.yaml` as the committed template — it must only contain generic placeholder domains.

If you add a new config key you must update both `config.example.yaml` (with a generic placeholder) and the `CameraConfig` / `AppConfig` types in `src/types.ts`.

## Adding a camera

Add a new entry to `config.yaml` following the structure in `config.example.yaml`. Give it a unique `id` (used in URLs). No code changes needed.

## Production

```bash
npm run build && npm start
# or
docker compose up -d
```

The Docker image does not bake in config or keys — they are mounted as read-only volumes at runtime. The `docker-compose.yml` mounts `./config.yaml` and `~/.ssh/id_ed25519`.

## Testing control actions

Control actions call `sudo systemctl` on the Pi. The SSH user must have passwordless sudo for `systemctl` commands, or the `picamera.service` must be owned by that user. In our setup `lee` has passwordless sudo on both Pis.

HDR actions also call `sed -i` on the `.env` file — the SSH user needs write access to that file (it's in the user's home directory so this is fine by default).
