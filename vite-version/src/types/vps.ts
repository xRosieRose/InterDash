/**
 * InterDash — VPS Data Types
 *
 * Models real VPS instances backed by the persistent database
 * and Proxmox VE hypervisors.
 */

export type VpsStatus =
  | "running"
  | "stopped"
  | "provisioning"
  | "error"
  | "unknown"
  | "deleting";

export interface VpsRecord {
  id: string;
  owner_user_id: string;
  proxmox_node_id: string;
  proxmox_vmid: number;
  name: string;
  hostname: string;
  status: VpsStatus;
  os_image_id: string;
  cpu_cores: number;
  memory_mb: number;
  swap_mb: number;
  disk_gb: number;
  ipv4_address: string | null;
  ipv6_address: string | null;
  created_at: string;
  updated_at: string;
  node_name?: string;
  node_region?: string;
  node_hostname?: string;
  owner_username?: string;
  owner_global_name?: string;
}

// Legacy compatibility type alias
export type VpsInstance = VpsRecord;
