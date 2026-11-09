export interface Ports {
  web: number;
  cloud: number;
  site: number;
}

interface Identity {
  version: 1;
  root: string;
  id: string;
  serviceProfile?: string;
}

export interface BackendState extends Identity {
  mode?: "convex";
  ports: Ports;
  deployment: string | null;
}

export interface BackendFreeState extends Identity {
  mode: "none";
  ports?: never;
  deployment?: never;
}

export type WorktreeState = BackendState | BackendFreeState;
export type Leases = Record<string, { id: string; ports: Ports }>;
export interface Runtime {
  id: string;
  pid: number;
  ready: boolean;
}
export type Phase = "afterPrepare" | "beforeImport" | "afterPush" | "beforeStart";
export interface Hook {
  name: string;
  command: string[];
  timeoutMs?: number;
}
export interface Service {
  command: string[];
  readiness: { command: string[]; timeoutMs: number };
}
export interface Profile {
  hooks?: Partial<Record<Phase, Hook[]>>;
  services?: Record<string, Service>;
}
export interface SelectedProfile {
  name: string;
  hooks: Partial<Record<Phase, Hook[]>>;
  services: Record<string, Service>;
}
export interface Layout {
  backend?: string;
  frontend?: string | false;
  convex?: boolean;
  baseBranch?: string;
  env?: Record<string, string>;
  secretEnv?: string[];
  siteUrlEnv?: string[];
  bootstrapMissingEnv?: string[];
  profiles?: Record<string, Profile>;
}
export interface ServiceRecord {
  pid?: number;
  status: "starting" | "ready" | "failed" | "stopped";
  error?: string;
}
export interface ServiceStatus {
  id: string;
  profile: string | null;
  services: Record<string, ServiceRecord>;
}
export interface BackendConfig {
  deploymentName: string;
  ports: Pick<Ports, "cloud" | "site">;
}
export interface ManifestFile {
  path: string;
  source?: string;
  sha256: string;
  adaptation?: string;
}
export interface Manifest {
  formatVersion?: number;
  files: Record<string, ManifestFile>;
}
