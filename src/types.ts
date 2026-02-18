export interface CameraConfig {
  id: string;
  name: string;
  status_url: string;
  stream_url: string;
  snapshot_url: string;
  ssh: {
    host: string;
    port: number;
    username: string;
    private_key: string;
  };
  pi: {
    service: string;
  };
}

export interface AppConfig {
  port: number;
  cameras: CameraConfig[];
}

// Status as returned by the /status endpoint on the Pi
export interface CameraStatus {
  name: string;
  uptime_seconds: number;
  resolution: string;
  hdr: boolean;
  clients: number;
  timestamp: string;
}

// Pi-level info gathered via SSH probe
export interface PiInfo {
  load: string;   // 1-min load average
  mem_pct: number; // memory used %
  temp_c: number;  // CPU temp in °C
}

// Combined state held in memory by the monitor
export interface CameraState {
  config: CameraConfig;
  status: CameraStatus | null;
  reachable: boolean;
  last_checked: Date | null;
  snapshot_fetched: Date | null;
  error: string | null;
  // Pi-level SSH probe (separate from camera service reachability)
  pi_reachable: boolean;
  pi_info: PiInfo | null;
  pi_error: string | null;
  // Transient error from the last control action (cleared on next action)
  action_error: string | null;
}

export type ControlAction = 'start' | 'stop' | 'restart' | 'hdr_on' | 'hdr_off';
