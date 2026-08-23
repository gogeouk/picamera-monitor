import type { CameraConfig, CameraState, PublicCameraState } from './types.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SSH and network errors routinely embed the details we use to reach the Pi —
 * "getaddrinfo ENOTFOUND pi.example.com", "connect ECONNREFUSED 10.0.0.4:8022",
 * "Cannot parse privateKey: /home/lee/.ssh/id_ed25519". Those strings are surfaced
 * to the browser in error panels, so scrub them before they leave the process.
 */
export function redactError(message: string | null, config: CameraConfig): string | null {
  if (!message) return null;

  let out = message;

  // Order matters. The key path usually contains the username, so redacting the
  // username first would leave the path unmatched and the rest of it exposed.
  // Longest value first guarantees the most specific match wins.
  const literals = [config.ssh.private_key, config.ssh.host]
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => b.length - a.length);

  for (const value of literals) {
    const placeholder = value === config.ssh.host ? '<host>' : '<key>';
    out = out.split(value).join(placeholder);
  }

  // Whole-word only: a username like "pi" must not turn "picamera.service"
  // into "<user>camera.service".
  if (config.ssh.username) {
    out = out.replace(
      new RegExp(`\\b${escapeRegExp(config.ssh.username)}\\b`, 'g'),
      '<user>',
    );
  }

  // Ports show up as ":8022" in connection errors
  if (config.ssh.port) {
    out = out.split(`:${config.ssh.port}`).join(':<port>');
  }

  return out;
}

/**
 * The dashboard and its JSON API are unauthenticated (see AGENTS.md). `CameraState`
 * embeds the full `CameraConfig`, including SSH host, port, username and key path —
 * none of which may appear in a response. This is the only shape that goes to a client.
 */
export function toPublicState(state: CameraState): PublicCameraState {
  const { config, error, pi_error, action_error, ...rest } = state;

  return {
    id: config.id,
    name: config.name,
    ...rest,
    error: redactError(error, config),
    pi_error: redactError(pi_error, config),
    action_error: redactError(action_error, config),
  };
}
