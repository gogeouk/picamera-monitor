import { Client } from 'ssh2';
import { createHash } from 'crypto';
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
        // Only talk to the Pi we think we are talking to. This used to accept any
        // host key, over the public internet, with a key that could run anything.
        hostVerifier: (key: Buffer) => hostKeyAllowed(key, config.ssh.host_keys),
      });
  });
}

/**
 * The verbs the Pi's `monitor-gate.sh` accepts. The dashboard's key is installed on
 * the Pis as a forced command, so these are the only things it can make happen; any
 * other string is refused on the Pi, whatever this code sends.
 */
const GATE_VERB: Record<ControlAction, string> = {
  start: 'start',
  stop: 'stop',
  restart: 'restart',
  hdr_on: 'hdr-on',
  hdr_off: 'hdr-off',
};

export async function runAction(config: CameraConfig, action: ControlAction): Promise<string> {
  const verb = GATE_VERB[action];
  if (!verb) throw new Error(`Unknown action: ${action}`);
  return sshExec(config, verb);
}

/** OpenSSH-style fingerprint of a raw host key blob: "SHA256:" + unpadded base64. */
export function fingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

export function hostKeyAllowed(key: Buffer, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return false; // fail closed: no pins, no connection
  return allowed.includes(fingerprint(key));
}

// Probe Pi system stats via SSH: load, memory %, CPU temp
// Returns a single pipe-delimited line: "load|mem_pct|temp_c"
export async function probePi(config: CameraConfig): Promise<PiInfo> {
  const raw = await sshExec(config, 'probe');
  const [load, memStr, tempStr] = raw.split('|');
  return {
    load: load?.trim() ?? '?',
    mem_pct: parseInt(memStr ?? '0', 10),
    temp_c: parseFloat(tempStr ?? '0'),
  };
}
