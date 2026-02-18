import { Client } from 'ssh2';
import fs from 'fs';
import type { CameraConfig, ControlAction } from './types.js';

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
      });
  });
}

export async function runAction(config: CameraConfig, action: ControlAction): Promise<string> {
  const { service, env_file } = config.pi;

  // Helper: upsert an env var in the .env file
  // Uses sed to replace existing line, or appends if not present
  const setEnvVar = (key: string, value: string) =>
    `grep -q '^${key}=' ${env_file} ` +
    `&& sed -i 's/^${key}=.*/${key}=${value}/' ${env_file} ` +
    `|| echo '${key}=${value}' >> ${env_file}`;

  let command: string;
  switch (action) {
    case 'start':
      command = `sudo systemctl start ${service}`;
      break;
    case 'stop':
      command = `sudo systemctl stop ${service}`;
      break;
    case 'restart':
      command = `sudo systemctl restart ${service}`;
      break;
    case 'hdr_on':
      // Stop service, enable HDR in env, start service
      // (v4l2-ctl runs automatically at startup via picamera.py)
      command = [
        `sudo systemctl stop ${service}`,
        setEnvVar('HDR', '1'),
        `sudo systemctl start ${service}`,
      ].join(' && ');
      break;
    case 'hdr_off':
      command = [
        `sudo systemctl stop ${service}`,
        setEnvVar('HDR', '0'),
        `sudo systemctl start ${service}`,
      ].join(' && ');
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  return sshExec(config, command);
}

export async function getServiceStatus(config: CameraConfig): Promise<string> {
  return sshExec(config, `systemctl is-active ${config.pi.service} 2>&1 || true`);
}
