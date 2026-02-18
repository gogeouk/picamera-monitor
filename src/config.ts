import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import type { AppConfig } from './types.js';

export function loadConfig(configPath?: string): AppConfig {
  const resolved = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), 'config.yaml');

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Config file not found: ${resolved}\n` +
      `Copy config.example.yaml to config.yaml and fill in your details.`
    );
  }

  const raw = yaml.load(fs.readFileSync(resolved, 'utf8')) as AppConfig;

  // Expand ~ in private_key paths
  for (const cam of raw.cameras) {
    if (cam.ssh.private_key.startsWith('~')) {
      cam.ssh.private_key = path.join(os.homedir(), cam.ssh.private_key.slice(1));
    }
  }

  return raw;
}
