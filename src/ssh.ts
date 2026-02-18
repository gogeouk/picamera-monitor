import { Client } from 'ssh2';
import fs from 'fs';
import type { CameraConfig, ControlAction, PiInfo } from './types.js';

function sshExec(config: CameraConfig, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';

    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          stream
            .on('close', (code: number) => {
              conn.end();
              if (code !== 0) {
                reject(new Error(`Command exited with code ${code}: ${output.trim()}`));
              } else {
                resolve(output.trim());
              }
            })
            .on('data', (data: Buffer) => { output += data.toString(); })
            .stderr.on('data', (data: Buffer) => { output += data.toString(); });
        });
      })
      .on('error', reject)
      .connect({
        host: config.ssh.host,
        port: config.ssh.port,
        username: config.ssh.username,
        privateKey: fs.readFileSync(config.ssh.private_key),
        // Accept any host key — Pi uses self-signed or DuckDNS cert, not in known_hosts
        hostVerifier: () => true,
      });
  });
}

export async function runAction(config: CameraConfig, action: ControlAction): Promise<string> {
  const { service } = config.pi;
  // Drop-in override dir for this service, e.g. /etc/systemd/system/picamera.service.d
  const dropInDir = `/etc/systemd/system/${service}.d`;
  const dropInFile = `${dropInDir}/hdr.conf`;

  let command: string;
  switch (action) {
    case 'start':
      command = `sudo systemctl start ${service} || true`;
      break;
    case 'stop':
      command = `sudo systemctl stop ${service} || true`;
      break;
    case 'restart':
      command = `sudo systemctl restart ${service} || true`;
      break;
    case 'hdr_on':
      // Write a systemd drop-in that sets HDR=1, reload, restart
      command = [
        `sudo mkdir -p ${dropInDir}`,
        `printf '[Service]\\nEnvironment=HDR=1\\n' | sudo tee ${dropInFile} > /dev/null`,
        `sudo systemctl daemon-reload`,
        `sudo systemctl restart ${service}`,
      ].join(' && ');
      break;
    case 'hdr_off':
      // Remove the drop-in (falls back to .env / default), reload, restart
      command = [
        `sudo rm -f ${dropInFile}`,
        `sudo systemctl daemon-reload`,
        `sudo systemctl restart ${service}`,
      ].join(' && ');
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  return sshExec(config, command);
}

// Probe Pi system stats via SSH: load, memory %, CPU temp
// Returns a single pipe-delimited line: "load|mem_pct|temp_c"
export async function probePi(config: CameraConfig): Promise<PiInfo> {
  const cmd = `echo "$(awk '{print $1}' /proc/loadavg)|$(free | awk '/Mem:/ {printf "%d", $3/$2*100}')|$(vcgencmd measure_temp 2>/dev/null | grep -oP '[\\d.]+' || echo 0)"`;
  const raw = await sshExec(config, cmd);
  const [load, memStr, tempStr] = raw.split('|');
  return {
    load: load?.trim() ?? '?',
    mem_pct: parseInt(memStr ?? '0', 10),
    temp_c: parseFloat(tempStr ?? '0'),
  };
}
