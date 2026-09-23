# AGENTS.md — picamera-monitor

> **Retiring.** The Pis are to report their own health over MQTT, publish-only, and gogeo's
> logged-in section will show it. Then this dashboard, its key on the Pis and its deployment
> go (gogeo's roadmap, Steps 5–7), and this repo is archived. Fix what breaks; do not extend it.

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

**SSH for control, not an API on the Pi.** Control commands (start/stop/restart, HDR toggle) run over SSH as verbs of the Pi's `monitor-gate.sh` (see *SSH* below), which runs `systemctl` itself. This avoids adding any control surface to the streamer and works with the existing SSH key infrastructure.

**HDR toggle pattern.** HDR is a systemd drop-in on the Pi (`picamera.service.d/hdr.conf`, `Environment=HDR=1`), not the `.env` file. The gate's `hdr-on` writes it and restarts the service, and `hdr-off` removes it and restarts. The streamer runs `v4l2-ctl` itself at startup when `HDR=1`, so a single restart is enough.

**Self-signed certs tolerated.** The poller uses `rejectUnauthorized: false` when fetching the Pi's `/status` endpoint. This is intentional: the Pi cert is Let's Encrypt but may be self-signed in dev; the Pi streams are internal infrastructure not first-party API calls.

**Password at Traefik, nothing in the app.** Since 2026-09-21 `cams.gogeo.uk` is behind Traefik Basic Auth (the `cams-auth` middleware in the server's `docker-compose.prod.yml`). The app itself has no login, so it must never be published on a host port that bypasses Traefik.

## Security invariants

The dashboard and its JSON API are **unauthenticated**. Treat every response as public.

**Never send a `CameraState` to a client.** It embeds the full `CameraConfig`, including
`ssh.host`, `ssh.port`, `ssh.username` and `ssh.private_key`. Convert with `toPublicState()`
from `src/redact.ts` first — it returns `PublicCameraState`, which carries `id` and `name` in
place of `config`. `/api/cameras` and `/api/:id/status` both go through it.

**Never render an error message raw.** SSH and socket errors embed the host, port, username
and key path (`connect ECONNREFUSED pi.example.com:22`). `views.ts` passes `error`,
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

**SSH, since 2026-09-21:**

- **The dashboard has its own key**, mounted from the server (`/data/picamera-monitor/ssh/` in production, `secrets/` locally; never committed). Until then it mounted lee's personal key, which has passwordless root on both Pis, into this web-facing container.
- **On the Pis that key is fenced** by `monitor-gate.sh` (in picamera-streamer), a forced command in `authorized_keys`, and accepted only from the server's address (`from=`). It can run `probe`, `start`, `stop`, `restart`, `hdr-on` and `hdr-off`, nothing else. `ssh.ts` therefore sends those verbs, never shell. A new ability means a new verb in the gate.
- **Host keys are pinned** (`ssh.host_keys` in `config.yaml`). No pins means no connection.
- **Actions refuse cross-site requests** (`src/guard.ts`): browsers resend a saved Basic Auth password to this site even when another website triggers the request, so the action route insists on HTMX's `HX-Request` header and a same-origin `Origin`.

**Still outstanding:** HTMX is loaded from unpkg without a subresource-integrity hash.

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

## Where this is deployed

Since 23 Sep 2026 on the gogeo VPS, as a single compose file:
[deploy/downcode/docker-compose.yml](deploy/downcode/docker-compose.yml), whose header describes the
layout (state in bind mounts under `/data`, Traefik in front with basic auth, pinned image,
resource limits). There is no checkout on the server: the image is built there from an archive
of a pushed commit and tagged with its short hash, then the tag in the compose file is updated.
`config.yaml` and the SSH key are bind mounts and are not touched by a rebuild.

## Production

```bash
npm run build && npm start
# or
docker compose up -d
```

The Docker image does not bake in config or keys — they are mounted as read-only volumes at runtime. The `docker-compose.yml` mounts `./config.yaml` and `~/.ssh/id_ed25519`.

## Testing control actions

Control actions call `sudo systemctl` on the Pi. The SSH user must have passwordless sudo for `systemctl` commands, or the `picamera.service` must be owned by that user. In our setup `lee` has passwordless sudo on both Pis.

HDR actions write or remove a systemd drop-in through `sudo` in the gate, so the same passwordless sudo covers them.
