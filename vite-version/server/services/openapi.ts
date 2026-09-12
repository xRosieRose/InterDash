/**
 * InterDash Server — OpenAPI 3.1 Specification & Interactive Documentation Generator
 *
 * Dynamically serves valid OpenAPI 3.1 schema at /api/v1/openapi.json
 * and an interactive API Explorer at /api/v1/docs.
 */

import { SCOPE_REGISTRY } from "./api-scopes.js";

export function getOpenApiSpec(): Record<string, any> {
  return {
    openapi: "3.1.0",
    info: {
      title: "InterDash REST Control Plane API",
      version: "1.0.0",
      description:
        "Production-grade external REST API control plane for the InterDash Cloud VPS platform. " +
        "Allows automation tools, billing platforms, bots, and infrastructure clients to manage virtual instances, " +
        "hypervisor nodes, tickets, users, and platform settings. Requires Bearer API key authentication.",
      contact: {
        name: "InterDash API Support",
        url: "https://github.com/xRosieRose/InterDash",
      },
    },
    servers: [
      {
        url: "/api/v1",
        description: "InterDash Primary Control Plane (v1)",
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "ih_live_<token>",
          description: "Enter your admin-generated API key: `ih_live_...`",
        },
      },
      schemas: {
        ErrorEnvelope: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "INSTANCE_NOT_FOUND" },
                message: { type: "string", example: "Instance not found." },
                details: { type: "object" },
              },
              required: ["code", "message"],
            },
            requestId: { type: "string", example: "a7c2b3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d" },
          },
          required: ["error", "requestId"],
        },
        InstanceDTO: {
          type: "object",
          properties: {
            id: { type: "string", example: "vps_a1b2c3d4" },
            name: { type: "string", example: "Production Web 01" },
            hostname: { type: "string", example: "web01.example.com" },
            description: { type: "string", nullable: true },
            status: { type: "string", enum: ["running", "stopped", "provisioning", "error", "deleting"] },
            osImageId: { type: "string", example: "ubuntu-22.04" },
            cpuCores: { type: "integer", example: 2 },
            memoryMb: { type: "integer", example: 4096 },
            diskGb: { type: "integer", example: 50 },
            ipv4Address: { type: "string", example: "192.168.1.100" },
            ipv6Address: { type: "string", nullable: true },
            expiresAt: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            node: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                region: { type: "string" },
              },
            },
            owner: {
              type: "object",
              properties: {
                id: { type: "string" },
                username: { type: "string" },
              },
            },
          },
        },
        AsyncOperationEnvelope: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                operationId: { type: "string" },
                status: { type: "string", example: "queued" },
                statusUrl: { type: "string", example: "/api/v1/operations/op_123" },
                message: { type: "string" },
              },
            },
            requestId: { type: "string" },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    tags: [
      { name: "Discovery", description: "API capabilities and health discovery" },
      { name: "Identity", description: "Current API key principal and permission inspection" },
      { name: "Instances", description: "VPS lifecycle, power cycling, reinstall, and management" },
      { name: "Provisioning", description: "Asynchronous virtual server provisioning jobs" },
      { name: "Nodes", description: "Proxmox cluster hypervisor nodes and capabilities" },
      { name: "Tickets", description: "Support ticket threads and communication" },
      { name: "Users", description: "User account management and role administration" },
      { name: "Settings", description: "Platform branding and authentication configuration" },
      { name: "Analytics", description: "Fleet resource metrics and utilization" },
      { name: "Operations", description: "Lifecycle operations tracking" },
      { name: "Audit", description: "Security and administrative audit events" },
    ],
    paths: {
      "/": {
        get: {
          tags: ["Discovery"],
          summary: "API Root Discovery",
          security: [],
          responses: {
            200: { description: "API root metadata and scopes catalog" },
          },
        },
      },
      "/health": {
        get: {
          tags: ["Discovery"],
          summary: "API Process Health",
          security: [],
          responses: {
            200: { description: "API process is healthy" },
          },
        },
      },
      "/auth/me": {
        get: {
          tags: ["Identity"],
          summary: "Current API Key Principal",
          description: "Inspect active key metadata, creator username, assigned scopes, and rate limits.",
          responses: {
            200: { description: "Current principal metadata" },
            401: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      "/instances": {
        get: {
          tags: ["Instances"],
          summary: "List VPS Instances",
          description: "Query paginated instances with optional filtering by status, node, or owner.",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", default: 50 } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "nodeId", in: "query", schema: { type: "string" } },
            { name: "expiry", in: "query", schema: { type: "string", enum: ["active", "expired", "expiring_soon", "all"] } },
          ],
          responses: {
            200: { description: "Paginated list of instance DTOs" },
            403: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
        post: {
          tags: ["Instances"],
          summary: "Provision New Instance",
          description: "Asynchronously provisions an LXC container on the specified hypervisor node. Returns 202 Accepted.",
          parameters: [
            { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["ownerUserId", "targetNodeId", "hostname", "osTemplate"],
                  properties: {
                    ownerUserId: { type: "string" },
                    targetNodeId: { type: "string" },
                    hostname: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string" },
                    osTemplate: { type: "string" },
                    cpuCores: { type: "integer", default: 1 },
                    memoryMb: { type: "integer", default: 1024 },
                    diskGb: { type: "integer", default: 25 },
                  },
                },
              },
            },
          },
          responses: {
            202: { $ref: "#/components/schemas/AsyncOperationEnvelope" },
            400: { $ref: "#/components/schemas/ErrorEnvelope" },
            409: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      "/instances/{id}": {
        get: {
          tags: ["Instances"],
          summary: "Get Instance Details",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Instance details" },
            404: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
        patch: {
          tags: ["Instances"],
          summary: "Update Instance Metadata",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Updated instance" },
          },
        },
        delete: {
          tags: ["Instances"],
          summary: "Destroy Instance",
          description: "Asynchronously deletes a VPS and reclaims IPAM resources. Returns 202 Accepted.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "Idempotency-Key", in: "header", schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    confirmHostname: { type: "string", description: "Must match exact hostname if configured" },
                  },
                },
              },
            },
          },
          responses: {
            202: { $ref: "#/components/schemas/AsyncOperationEnvelope" },
          },
        },
      },
      "/instances/{id}/start": {
        post: {
          tags: ["Instances"],
          summary: "Start Instance",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 202: { $ref: "#/components/schemas/AsyncOperationEnvelope" } },
        },
      },
      "/instances/{id}/stop": {
        post: {
          tags: ["Instances"],
          summary: "Stop Instance",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 202: { $ref: "#/components/schemas/AsyncOperationEnvelope" } },
        },
      },
      "/instances/{id}/reboot": {
        post: {
          tags: ["Instances"],
          summary: "Reboot Instance",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 202: { $ref: "#/components/schemas/AsyncOperationEnvelope" } },
        },
      },
      "/instances/{id}/reinstall": {
        post: {
          tags: ["Instances"],
          summary: "Reinstall Instance OS",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "Idempotency-Key", in: "header", schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["osTemplate", "confirmHostname"],
                  properties: {
                    osTemplate: { type: "string" },
                    confirmHostname: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 202: { $ref: "#/components/schemas/AsyncOperationEnvelope" } },
        },
      },
      "/instances/{id}/password": {
        post: {
          tags: ["Instances"],
          summary: "Reset Root Password",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["password"],
                  properties: { password: { type: "string", minLength: 8 } },
                },
              },
            },
          },
          responses: { 200: { description: "Password reset dispatched" } },
        },
      },
      "/instances/{id}/expiry": {
        patch: {
          tags: ["Instances"],
          summary: "Update Instance Expiration",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { expiresAt: { type: "string", format: "date-time", nullable: true } },
                },
              },
            },
          },
          responses: { 200: { description: "Expiration updated" } },
        },
      },
      "/instances/{id}/console": {
        post: {
          tags: ["Instances"],
          summary: "Initiate Terminal Console Session",
          description: "Generates an opaque, time-limited console session token for interactive terminal access.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "Console session ticket",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          sessionTicket: { type: "string" },
                          wsUrl: { type: "string" },
                          expiresAt: { type: "string" },
                        },
                      },
                      requestId: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/provisioning/jobs/{id}": {
        get: {
          tags: ["Provisioning"],
          summary: "Get Provisioning Job Status",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Job progress and step details" } },
        },
      },
      "/nodes": {
        get: {
          tags: ["Nodes"],
          summary: "List Hypervisor Nodes",
          responses: { 200: { description: "Proxmox cluster nodes (credentials masked)" } },
        },
        post: {
          tags: ["Nodes"],
          summary: "Register Hypervisor Node",
          responses: { 201: { description: "Registered node" } },
        },
      },
      "/nodes/{id}/verify": {
        post: {
          tags: ["Nodes"],
          summary: "Trigger Live Node Verification",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Live verification results" } },
        },
      },
      "/nodes/{id}/capabilities": {
        get: {
          tags: ["Nodes"],
          summary: "Get Node Capabilities",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Discovered storages, templates, and network bridges" } },
        },
      },
      "/tickets": {
        get: {
          tags: ["Tickets"],
          summary: "List Support Tickets",
          responses: { 200: { description: "Support tickets" } },
        },
        post: {
          tags: ["Tickets"],
          summary: "Create Support Ticket",
          responses: { 201: { description: "Created ticket" } },
        },
      },
      "/tickets/{id}": {
        get: {
          tags: ["Tickets"],
          summary: "Get Ticket and Message Thread",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Ticket messages" } },
        },
      },
      "/tickets/{id}/messages": {
        post: {
          tags: ["Tickets"],
          summary: "Reply to Support Ticket",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 201: { description: "Reply added" } },
        },
      },
      "/users": {
        get: {
          tags: ["Users"],
          summary: "List User Accounts",
          responses: { 200: { description: "User accounts (password hashes stripped)" } },
        },
      },
      "/settings": {
        get: {
          tags: ["Settings"],
          summary: "Get Public Platform Settings",
          security: [],
          responses: { 200: { description: "Platform branding and public configuration" } },
        },
        patch: {
          tags: ["Settings"],
          summary: "Update Platform Settings",
          responses: { 200: { description: "Settings updated" } },
        },
      },
      "/settings/authentication": {
        get: {
          tags: ["Settings"],
          summary: "Get Authentication Provider Settings (Masked)",
          responses: { 200: { description: "Authentication provider state with secrets masked" } },
        },
      },
      "/analytics": {
        get: {
          tags: ["Analytics"],
          summary: "Get Real Resource Analytics",
          responses: { 200: { description: "Fleet metrics and utilization" } },
        },
      },
      "/operations/{id}": {
        get: {
          tags: ["Operations"],
          summary: "Get Operation Status",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Operation execution step and status" } },
        },
      },
      "/audit": {
        get: {
          tags: ["Audit"],
          summary: "Query Audit Log Trail",
          responses: { 200: { description: "Sanitized audit records" } },
        },
      },
    },
  };
}

/**
 * Generate standalone interactive documentation HTML with modern dark-mode styling and cURL examples.
 */
export function getApiDocsHtml(): string {
  const spec = getOpenApiSpec();
  const specJson = JSON.stringify(spec).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>InterDash — API Control Plane Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background-color: #09090b; color: #f4f4f5; font-family: ui-sans-serif, system-ui, sans-serif; }
    .topbar { display: none !important; }
    .swagger-ui { color: #f4f4f5; filter: invert(88%) hue-rotate(180deg); }
    .swagger-ui .info { margin: 30px 0; }
    .swagger-ui .scheme-container { background: #18181b; padding: 20px 0; box-shadow: none; border-bottom: 1px solid #27272a; }
    .header-banner { background: #18181b; border-bottom: 1px solid #27272a; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
    .header-banner h1 { margin: 0; font-size: 1.25rem; font-weight: 700; color: #3b82f6; display: flex; align-items: center; gap: 8px; }
    .header-banner .badge { background: #2563eb; color: #fff; font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight: 600; }
    .header-banner a { color: #a1a1aa; text-decoration: none; font-size: 0.875rem; transition: color 0.15s; }
    .header-banner a:hover { color: #fff; }
    .curl-card { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px 24px; margin: 24px 32px 0 32px; }
    .curl-card h3 { margin-top: 0; margin-bottom: 8px; font-size: 0.95rem; color: #93c5fd; }
    .curl-card pre { margin: 0; background: #09090b; padding: 12px; border-radius: 6px; font-size: 0.85rem; overflow-x: auto; color: #34d399; }
  </style>
</head>
<body>
  <div class="header-banner">
    <h1>InterDash <span class="badge">API v1</span></h1>
    <div>
      <a href="/api/v1/openapi.json" target="_blank">Download OpenAPI 3.1 JSON &rarr;</a>
    </div>
  </div>

  <div class="curl-card">
    <h3>Quick Authentication Example</h3>
    <pre>curl -X GET "https://YOUR_DOMAIN/api/v1/instances" \\
  -H "Authorization: Bearer ih_live_YOUR_API_KEY" \\
  -H "Accept: application/json"</pre>
  </div>

  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        spec: ${specJson},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}
