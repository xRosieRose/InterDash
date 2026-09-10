# InterDash — Real VPS Control Plane for InterENL

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](License.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react&logoColor=white)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-5-green?logo=express&logoColor=white)](https://expressjs.com/)
[![Proxmox VE](https://img.shields.io/badge/Proxmox_VE-v2_REST_API-E57000?logo=proxmox&logoColor=white)](https://pve.proxmox.com/wiki/Proxmox_VE_API)
[![Tests: 42 Passed](https://img.shields.io/badge/Tests-42%20Passed-brightgreen)](server/__tests__/)

**InterDash** is the production VPS management control plane for **InterENL Cloud VPS Hosting**.

> [!IMPORTANT]
> **Hypervisor Architecture**: InterDash is strictly a control plane. The panel never virtualizes instances itself. Real Proxmox VE hypervisor nodes create, isolate, and execute LXC containers. Browser clients interact solely with the authenticated InterDash Express API; Proxmox credentials never touch the browser.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│             Browser (React 19 Client)                  │
│       Tailwind CSS v4 + Radix UI + shadcn/ui           │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS / Session Cookie (HTTP-Only)
                            ▼
┌────────────────────────────────────────────────────────┐
│             InterDash Express Control Plane            │
│  - Session Auth & Discord OAuth2 Token Exchange        │
│  - RBAC & Database Query-Level Ownership Enforcement   │
│  - Async Provisioning Worker & Rollback State Machine  │
│  - IPAM Atomic Pool Allocation                         │
│  - AES-256-GCM Credential Encryption at Rest          │
│  - SQLite Database with Versioned Migrations          │
└───────────────────────────┬────────────────────────────┘
                            │ Server-to-Server PVE REST API (Token Auth)
                            ▼
┌────────────────────────────────────────────────────────┐
│              Proxmox VE Hypervisor Fleet               │
│  - Node A (e.g. pve1)      - Node B (e.g. pve2)        │
│  - LXC Container Provisioning (vmid, rootfs, net0)     │
│  - Live Status & Runtime Verification                  │
└────────────────────────────────────────────────────────┘
```

---

## Core Principles & Security Model

1. **Absolute Truth in Infrastructure**: Zero fake data, zero mock arrays, no `setTimeout` simulated operations, and no browser-generated fake IP addresses or VMIDs.
2. **Authoritative Hypervisor**: Proxmox VE is the single source of truth for runtime container state. InterDash is authoritative for ownership, quotas, network allocation, and business state.
3. **Strict Role Normalization**: Only two valid application roles exist:
   - `user`: Standard tenant. Can view only their owned VPS instances, resource allocation, and support tickets. Normal users cannot provision VPS instances.
   - `admin`: Infrastructure administrator. Full access to global fleet overview, user account administration, Proxmox node management, LXC provisioning, and panel settings.
4. **Server-Side Authorization**: Resource ownership is enforced at the database query level (`WHERE owner_user_id = ?`). Attempting to query another user's VPS or ticket results in a `403 Forbidden` response.
5. **Credential Encryption at Rest**: Proxmox API token secrets are stored in the database encrypted via AES-256-GCM using an authenticated server-only master key. Secrets are stripped from all API outputs.
6. **Asynchronous Provisioning**: LXC provisioning operations run as background jobs tracked in `provisioning_jobs` with transactional rollback if any step fails.

---

## Application Route Structure

### Compute
- `/instances` — Personal VPS instances assigned to the authenticated user. Real IP, OS, resource quotas, and Proxmox node location.
- `/analytics` — Authentic resource allocation telemetry. Shows assigned vCPUs, memory, storage, and node allocation.

### Operations
- `/tickets` — Persistent database-backed support ticketing thread system with client replies, admin status updates, and priority tagging.

### Admin (Restricted to `role === "admin"`)
- `/admin/overview` — Infrastructure fleet telemetry: aggregate vCPUs, RAM, storage, container counts by status, and node health status.
- `/admin/users` — Real registered Discord users, role promotions/demotions, account suspension toggle, and last-administrator protection.
- `/admin/nodes` — Configured Proxmox VE nodes, live connection test (`/api2/json/version`), storage/bridge discovery, and TLS security toggles.
- `/admin/settings` — Persistent global panel branding, support links, and platform identity.

---

## Asynchronous Provisioning Pipeline

When an administrator provisions an instance via `POST /api/admin/vps`:

1. **Queued**: Validates input parameters (CPU, RAM, storage, template, node) and creates a `provisioning_jobs` record.
2. **Allocating**: Allocates next unique Proxmox cluster VMID using `/api2/json/cluster/nextid` and reserves an IP from the active IPAM pool.
3. **Creating**: Submits LXC creation request to Proxmox (`POST /api2/json/nodes/{node}/lxc`) and awaits the PVE UPID task completion.
4. **Configuring**: Sets up network interface `net0`, bridge, gateway, nameservers, and resource constraints.
5. **Starting**: Issues container boot command (`POST /api2/json/nodes/{node}/lxc/{vmid}/status/start`).
6. **Verifying**: Queries container status endpoint until confirmed `running`.
7. **Completed**: Inserts the persistent `vps` record linked to the target user and node.
8. **Failure Rollback**: If Proxmox rejects creation or startup times out, the worker attempts safe container cleanup, releases reserved IP addresses, logs an audit event, and marks the job `failed`.

---

## Configuration (`.env`)

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Required | Default |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Environment (`development` or `production`) | Yes | `development` |
| `PORT` | HTTP port for the Express server | Yes | `5173` |
| `APP_URL` | Public base URL of the panel | Yes | `http://localhost:5173` |
| `SESSION_SECRET` | Cryptographically random string (64+ hex chars) | Yes | Required |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM credential encryption | No | Derived from `SESSION_SECRET` |
| `DATABASE_PATH` | Path to persistent SQLite database | Yes | `./data/interdash.db` |
| `DISCORD_CLIENT_ID` | Discord OAuth2 Application Client ID | Yes | Required |
| `DISCORD_CLIENT_SECRET`| Discord OAuth2 Application Client Secret | Yes | Required |
| `DISCORD_REDIRECT_URI` | OAuth2 Callback URL | Yes | `http://localhost:5173/api/auth/discord/callback` |
| `DISCORD_ADMIN_USER_ID`| Discord User ID to bootstrap as `admin` on first login | Yes | Required |

---

## Installation & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database Migrations
Migrations run automatically on server boot. To verify database state:
```bash
npm run dev:server
```

### 3. Bootstrap Admin Account
Ensure `DISCORD_ADMIN_USER_ID` is populated with your Discord Snowflake ID in `.env`. On first login via `/auth/sign-in`, your account will automatically be granted the `admin` role.

To manually promote an existing user:
```bash
npm run create-admin -- <discord_user_id>
```

### 4. Run Automated Regression Suite
```bash
npm test
```
Runs 42 comprehensive tests verifying:
- Unauthenticated route redirects for `/instances`, `/analytics`, `/tickets`, and `/admin/*`.
- 403 Forbidden enforcement on all administrative API endpoints for standard users.
- Query-level ownership isolation between tenants (User A cannot access User B's VPS or tickets).
- Last-admin demotion prevention.
- Public settings and health probe availability.

### 5. Production Build & Execution
```bash
npm run build
npm run start:prod
```

---

## Intentionally Deferred Features

To maintain absolute truthfulness in the control plane, unfinished or simulated features were deliberately excluded from production UI:
- **Web SSH / NoVNC Console**: Deferred until real Proxmox VNC/xterm.js websocket proxy gateway is implemented.
- **Granular Live Power Toggles**: Deferred until real-time task queuing and two-way container state synchronizers are deployed.
- **Live Disk Resize & Snapshot Trees**: Deferred to future infrastructure release.
- **User Self-Provisioning**: Disabled by design; InterENL instances are provisioned by administrators.

---

## License

Released under the [MIT License](License.md). Built for **InterENL Cloud VPS Hosting**.
