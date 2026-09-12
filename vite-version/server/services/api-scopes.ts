/**
 * InterDash Server — Canonical API Scope Registry
 *
 * Central definition of all API capability scopes, groupings, descriptions,
 * and dangerous scope flags.
 */

export interface ScopeDefinition {
  id: string;
  name: string;
  category: "Wildcard" | "Instances" | "Provisioning" | "Nodes" | "Tickets" | "Users" | "Settings" | "Analytics" | "Operations" | "Audit";
  description: string;
  isDangerous?: boolean;
  requiresAdminRole?: boolean;
}

export const SCOPES = {
  // Wildcard
  FULL_ACCESS: "api:full",

  // Instances / VPS
  INSTANCES_READ: "instances:read",
  INSTANCES_WRITE: "instances:write",
  INSTANCES_POWER: "instances:power",
  INSTANCES_REINSTALL: "instances:reinstall",
  INSTANCES_DELETE: "instances:delete",
  INSTANCES_CONSOLE: "instances:console",
  INSTANCES_EXPIRY: "instances:expiry",

  // Provisioning
  PROVISIONING_READ: "provisioning:read",
  PROVISIONING_CREATE: "provisioning:create",
  PROVISIONING_CANCEL: "provisioning:cancel",

  // Nodes
  NODES_READ: "nodes:read",
  NODES_WRITE: "nodes:write",
  NODES_VERIFY: "nodes:verify",
  NODES_DELETE: "nodes:delete",

  // Tickets
  TICKETS_READ: "tickets:read",
  TICKETS_WRITE: "tickets:write",

  // Users
  USERS_READ: "users:read",
  USERS_WRITE: "users:write",
  USERS_ROLE: "users:role",

  // Settings
  SETTINGS_READ: "settings:read",
  SETTINGS_WRITE: "settings:write",

  // Analytics, Operations, Audit
  ANALYTICS_READ: "analytics:read",
  OPERATIONS_READ: "operations:read",
  AUDIT_READ: "audit:read",
} as const;

export type ScopeId = (typeof SCOPES)[keyof typeof SCOPES];

export const SCOPE_REGISTRY: ScopeDefinition[] = [
  // Wildcard
  {
    id: SCOPES.FULL_ACCESS,
    name: "Full Platform API Access",
    category: "Wildcard",
    description: "Grants all API capabilities across the entire control plane. Treat like root access.",
    isDangerous: true,
    requiresAdminRole: true,
  },

  // Instances
  {
    id: SCOPES.INSTANCES_READ,
    name: "Read Instances",
    category: "Instances",
    description: "View VPS instance details, specifications, assigned IPs, and runtime status.",
  },
  {
    id: SCOPES.INSTANCES_WRITE,
    name: "Modify Instances",
    category: "Instances",
    description: "Update VPS instance names, descriptions, and reset root passwords.",
  },
  {
    id: SCOPES.INSTANCES_POWER,
    name: "Instance Power Operations",
    category: "Instances",
    description: "Start, stop, and reboot VPS instances.",
  },
  {
    id: SCOPES.INSTANCES_REINSTALL,
    name: "Reinstall Instance OS",
    category: "Instances",
    description: "Wipe and reinstall instance operating system with template selection.",
    isDangerous: true,
  },
  {
    id: SCOPES.INSTANCES_DELETE,
    name: "Delete Instances",
    category: "Instances",
    description: "Permanently destroy VPS instances and release IPAM allocations.",
    isDangerous: true,
  },
  {
    id: SCOPES.INSTANCES_CONSOLE,
    name: "Console Access",
    category: "Instances",
    description: "Generate interactive terminal tickets and access live VPS console sessions.",
  },
  {
    id: SCOPES.INSTANCES_EXPIRY,
    name: "Manage Instance Expiry",
    category: "Instances",
    description: "Extend, set, or clear VPS instance expiration dates.",
    requiresAdminRole: true,
  },

  // Provisioning
  {
    id: SCOPES.PROVISIONING_READ,
    name: "Read Provisioning Jobs",
    category: "Provisioning",
    description: "Inspect asynchronous VPS creation jobs, progress steps, and error states.",
  },
  {
    id: SCOPES.PROVISIONING_CREATE,
    name: "Create Instances (Provision)",
    category: "Provisioning",
    description: "Provision new virtual servers on Proxmox hypervisors with IP allocation.",
    isDangerous: true,
    requiresAdminRole: true,
  },
  {
    id: SCOPES.PROVISIONING_CANCEL,
    name: "Cancel Provisioning Jobs",
    category: "Provisioning",
    description: "Abort in-flight or stalled provisioning jobs.",
    requiresAdminRole: true,
  },

  // Nodes
  {
    id: SCOPES.NODES_READ,
    name: "Read Hypervisor Nodes",
    category: "Nodes",
    description: "View Proxmox cluster nodes, health, status, and storage/network capabilities.",
    requiresAdminRole: true,
  },
  {
    id: SCOPES.NODES_WRITE,
    name: "Manage Hypervisor Nodes",
    category: "Nodes",
    description: "Register new Proxmox nodes and update hypervisor configurations.",
    isDangerous: true,
    requiresAdminRole: true,
  },
  {
    id: SCOPES.NODES_VERIFY,
    name: "Verify Nodes",
    category: "Nodes",
    description: "Trigger live hypervisor reachability, authentication, and storage discovery.",
    requiresAdminRole: true,
  },
  {
    id: SCOPES.NODES_DELETE,
    name: "Delete Hypervisor Nodes",
    category: "Nodes",
    description: "Remove hypervisor nodes from InterDash with dependency checks.",
    isDangerous: true,
    requiresAdminRole: true,
  },

  // Tickets
  {
    id: SCOPES.TICKETS_READ,
    name: "Read Support Tickets",
    category: "Tickets",
    description: "View support tickets and communication thread messages.",
  },
  {
    id: SCOPES.TICKETS_WRITE,
    name: "Create & Reply to Tickets",
    category: "Tickets",
    description: "Create new tickets, post reply messages, and update ticket statuses.",
  },

  // Users
  {
    id: SCOPES.USERS_READ,
    name: "Read Users",
    category: "Users",
    description: "List user accounts and view user profile metadata.",
    requiresAdminRole: true,
  },
  {
    id: SCOPES.USERS_WRITE,
    name: "Manage User Accounts",
    category: "Users",
    description: "Suspend, ban, or reactivate user accounts.",
    isDangerous: true,
    requiresAdminRole: true,
  },
  {
    id: SCOPES.USERS_ROLE,
    name: "Modify User Roles",
    category: "Users",
    description: "Promote or demote user roles (e.g. user to admin/owner).",
    isDangerous: true,
    requiresAdminRole: true,
  },

  // Settings
  {
    id: SCOPES.SETTINGS_READ,
    name: "Read Platform Settings",
    category: "Settings",
    description: "Read platform branding, contact URLs, and authentication provider configs.",
  },
  {
    id: SCOPES.SETTINGS_WRITE,
    name: "Modify Platform Settings",
    category: "Settings",
    description: "Update panel branding, titles, URLs, and authentication provider settings.",
    isDangerous: true,
    requiresAdminRole: true,
  },

  // Analytics, Operations, Audit
  {
    id: SCOPES.ANALYTICS_READ,
    name: "Read Analytics",
    category: "Analytics",
    description: "Access real infrastructure metrics, fleet utilization, and user resource stats.",
  },
  {
    id: SCOPES.OPERATIONS_READ,
    name: "Read Operation History",
    category: "Operations",
    description: "Query asynchronous lifecycle operations, execution steps, and logs.",
  },
  {
    id: SCOPES.AUDIT_READ,
    name: "Read Audit Logs",
    category: "Audit",
    description: "Search system audit trail and security events (sanitized, no secrets).",
    requiresAdminRole: true,
  },
];

const VALID_SCOPE_SET = new Set<string>(SCOPE_REGISTRY.map((s) => s.id));

/**
 * Validate an array of scope strings against the canonical registry.
 */
export function validateScopes(scopes: string[]): { valid: boolean; invalidScopes: string[] } {
  const invalidScopes = scopes.filter((s) => !VALID_SCOPE_SET.has(s));
  return {
    valid: invalidScopes.length === 0,
    invalidScopes,
  };
}

/**
 * Check if granted scopes satisfy required scopes (supporting api:full wildcard).
 */
export function hasRequiredScopes(grantedScopes: string[], requiredScopes: string[]): boolean {
  if (grantedScopes.includes(SCOPES.FULL_ACCESS)) {
    return true;
  }
  return requiredScopes.every((req) => grantedScopes.includes(req));
}
