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
    env_file: string;
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

// Combined state held in memory by the monitor
export interface CameraState {
  config: CameraConfig;
  status: CameraStatus | null;
  reachable: boolean;
  last_checked: Date | null;
  snapshot_fetched: Date | null;
  error: string | null;
}

export type ControlAction = 'start' | 'stop' | 'restart' | 'hdr_on' | 'hdr_off';
