# picamera-monitor

A dashboard for monitoring and controlling [picamera-streamer](https://github.com/gogeouk/picamera-streamer) instances. Shows live streams, status, and provides stop/start/restart and HDR controls for each camera over SSH.

## Features

- Live MJPEG stream embedded per camera (falls back to snapshot when offline)
- Auto-refreshing status panel: uptime, resolution, HDR state, active client count
- SSH-based controls: Stop, Start, Restart, HDR On/Off
- HDR toggle stops the service, updates `.env`, and restarts — the streamer applies `v4l2-ctl` automatically on startup
- Tabbed layout — add as many cameras as you like in config
- Docker / docker-compose for VPS deployment, or run directly with Node

## Requirements

- Node.js 20+
- SSH key access to each Pi (password auth not supported)
- Each Pi running [picamera-streamer](https://github.com/gogeouk/picamera-streamer) ≥ `60b938a` (adds the `/status` endpoint)

## Setup

```bash
git clone https://github.com/gogeouk/picamera-monitor
cd picamera-monitor
npm install
cp config.example.yaml config.yaml
# Edit config.yaml with your camera details
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production (Node)

```bash
npm run build
npm start
```

### Production (Docker)

```bash
# Build and run — config.yaml and SSH key are mounted, never baked in
docker compose up -d
```

The SSH key path in `docker-compose.yml` defaults to `~/.ssh/id_ed25519`. Adjust the volume mount if yours differs.

## Configuration

Copy `config.example.yaml` to `config.yaml`. The file is gitignored and must never be committed.

| Key | Description |
|---|---|
| `port` | Port the dashboard listens on (default: `3000`) |
| `cameras[].id` | Unique slug used in URLs |
| `cameras[].name` | Display name shown in the tab |
| `cameras[].status_url` | Full URL to the camera's `/status` endpoint |
| `cameras[].stream_url` | Full URL for the MJPEG stream |
| `cameras[].snapshot_url` | Full URL for the JPEG snapshot (offline fallback) |
| `cameras[].ssh.host` | SSH host |
| `cameras[].ssh.port` | SSH port |
| `cameras[].ssh.username` | SSH username |
| `cameras[].ssh.private_key` | Path to private key file (`~` is expanded) |
| `cameras[].pi.env_file` | Absolute path to `.env` on the Pi |
| `cameras[].pi.service` | systemd service name (e.g. `picamera.service`) |

## API

The server also exposes a simple JSON API for external consumers:

| Endpoint | Description |
|---|---|
| `GET /api/cameras` | Status of all cameras |
| `GET /api/:id/status` | Status of one camera |
| `POST /api/:id/action/start` | Start the service |
| `POST /api/:id/action/stop` | Stop the service |
| `POST /api/:id/action/restart` | Restart the service |
| `POST /api/:id/action/hdr_on` | Enable HDR and restart |
| `POST /api/:id/action/hdr_off` | Disable HDR and restart |
