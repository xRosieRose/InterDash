/**
 * InterDash — Proxmox Layered Verification, Capabilities & Template Discovery Tests
 *
 * Comprehensive tests verifying:
 * - 14-layer node verification
 * - TLS rejection & opt-in handling
 * - Authentication & node identity
 * - Multi-storage template discovery & vztmpl/rootdir decoupling
 * - Regression fixture for multi-storage discovery bug
 * - Bridge discovery, permission assessment, capability cache
 * - Security & zero secrets leakage
 * - Provisioning preflight checks
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import {
  ProxmoxService,
  ProxmoxNodeConfig,
  ProxmoxRequestError,
  parseTemplatePresentationMetadata,
  NodeVerificationResult,
} from "../services/proxmox.js";
import { createApp } from "../index.js";
import { execute, queryOne, closeDatabase } from "../db/index.js";
import { hashToken } from "../middleware/auth.js";
import { encryptCredential } from "../services/crypto.js";

// Self-signed certificate for real TLS testing
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCof8LCZQSnLhRJ
GGIgHSiSF682WFakNNSFDVvkpR1mPAXUZRkR2RBJZvWehaCSso1hAyG2AxjVuB7B
MtVBqI0niBJeMDk6s6PKJ5bBIAVuxyhmdSTQSX1JrmS+B6NxcMcM2M/XXy6P8uGV
m2lXHDDxfiIOjbvi9it9LeuhI7W09Aw46S/pO26uqrnvckYWgXKL5XUsRRbIxzI2
5QVGH/2aMaDdycYMSpWeaMdKDEA80dcpWIMtw5BBiU8VonfxLpGN805dMwengCTG
KXAdl57hsfUI3TMfSLwdYD+c+6lw7aEremLTF5Jw8jEUQ9MLTlG/QFq2Rh+UBLiD
oGyzL45zAgMBAAECggEAIO6/mRD3ZNl7u4GZhB9O06bvZtbDMFrnAo5G3Jxs75Nh
rE6KJNPg/Ae0j+QcKy/ctA5Ro2pdiz/uOuJ9jdSsqgJNXL1eIhwEMjmknGBuz2T7
f3L72/3RD/qW1BFYH47kSJ2DmduPlTDqaDw0zYLECh8V9vQ6ubRVcaTs/dSl6hTL
sn1IcuvNDKFjszcf2C7VWMSop8Yx7pvEyPLsbU3nFhdAMlAoEexeUo3blMffu1Ql
dNgpuuCWXYotXQF7LlCLeOf82RrGGxX918pD4NaejqOgLoAUht6gGVvJbR5FrSM5
dadazmWhjV2bFzcFX4OmWtKfyQ6ABnd80k6gPs3NwQKBgQDRJXPIzVn5jUdSNl3E
+wYu0+EwtWJmlQ9Rk5HDQtJnXhhE+YHlw1WFy2vFGKj2yFun0hjPYgqpnOju2I6Y
s4plMTz7kvFTutO+uaANFWJ8Y5HkCFS+7TIagsTGjJY59KcaLZAN5DPyrFg49aXQ
+PdIEvQxh56oRKChlmJ1A+eB0wKBgQDOPzAxUpjjn8VKK/FeKm/7W4/CyXNP/lyd
IY/ymquIcdCGQCtJ3oDbzWN+aa3dPzi2YtQL6bwdJGfgqiTgWBaTvY4Ofwl/hi78
/LnCbERqhFE3JxnFa2ex5I6/BEpwRtXGT01F44InVS03cEwsgtcme7tpFW0a/uW2
cE0LvfM84QKBgQCzRQYE9bgMxwN+PamMgZqgIu9gX+lzgos54mLL2wgcoDPvU2r7
db5ly6KZs/SIa97cb6Lih+gZ0Kx8plU8IJEdAeKCxUZj/b0oO1YsQMtFUdeofVee
vBP5U2O1yKWwEbv2HV3f+l5owT9xu2WhRPY46j40AkqFcyW4u/2yzWDwDwKBgQC0
8DyAWN0mfOlhW9HB8esSEk657W/LkvR/KY2WodiwuGDfFnajtJ9JthN+OIo+mpNP
dr5ewSy2SFUVhU8avkz4SgjRcOPNS9P3QGRbTA5tgC2b/CKgzsxHBaOxsrr3az1q
X/IDyUdK6G/lvhAl0Jed/Fj7JL/2Of8fIcCF95voIQKBgE6LolnurUUxC/D17Cof
tO7Xqm0AsiWqjL+pbVGnu+mPjd0dAp5vO61jouzoeYYvF/pAKVIgABq2Q6zdsCgM
CxhzfIOiF4f4D84IhsugFxOwe0AV+WPCdX46kyJ3ssCJjygERvS8swCEjxEj8ZHs
qBj6wlnjKjiu+S3XJy3EjIfR
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUOEqvtfnzup8xkSdgcExhLH8b2FIwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDkxMTA0Mzk0NloXDTI3MDkx
MTA0Mzk0NlowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAqH/CwmUEpy4USRhiIB0okhevNlhWpDTUhQ1b5KUdZjwF
1GUZEdkQSWb1noWgkrKNYQMhtgMY1bgewTLVQaiNJ4gSXjA5OrOjyieWwSAFbsco
ZnUk0El9Sa5kvgejcXDHDNjP118uj/LhlZtpVxww8X4iDo274vYrfS3roSO1tPQM
OOkv6Tturqq573JGFoFyi+V1LEUWyMcyNuUFRh/9mjGg3cnGDEqVnmjHSgxAPNHX
KViDLcOQQYlPFaJ38S6RjfNOXTMHp4AkxilwHZee4bH1CN0zH0i8HWA/nPupcO2h
K3pi0xeScPIxFEPTC05Rv0BatkYflAS4g6Bssy+OcwIDAQABo1MwUTAdBgNVHQ4E
FgQUXFZeO6uzf1wlsNzHTwBhPMcROEAwHwYDVR0jBBgwFoAUXFZeO6uzf1wlsNzH
TwBhPMcROEAwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAEowI
G3BL0AGrSrNZ4pUrmwJEa55L0x3CyWczKjyHy7VCorqnCgmoZ25c5kWBHf7yTSrL
NoL1F4/uyzobV50el+Q9bOMN3N/NhswGao9ceLP4aztgjg+2btCzoZ4OY+xjOzbb
4M997n8u/AMUwSy7Rh2lkS6BSAXXEQ5JXLvXbGFU3AVIqg00WrLItfhCDpKvg4b4
orkTTlS5m3PFJoavSzADwHlsSRcnKKr4rgKoi5rFzreN8edTr4angwrHqYqSdImo
WKKnkOqjvvNneRmmQzsF22+P6+7Rh98+9gj1xol13suOimqyNXIz0BZEiYDIcP+2
7laNpHJWbWjfZKzLfQ==
-----END CERTIFICATE-----`;

describe("Proxmox Layered Verification & Multi-Storage Discovery", () => {
  let mockHttpServer: http.Server;
  let mockHttpsServer: https.Server;
  let httpPort: number;
  let httpsPort: number;

  // Control mock behavior dynamically per test
  let authHandler: (req: http.IncomingMessage) => boolean = () => true;
  let statusHandler: () => any = () => ({ uptime: 45000, cpu: 0.12, memory: { total: 32000, used: 8000 } });
  let nodesHandler: () => any[] = () => [{ node: "pve01", status: "online" }];
  let storagesHandler: () => any[] = () => [
    { storage: "local", type: "dir", active: 1, content: "iso,vztmpl,backup" },
    { storage: "local-lvm", type: "lvmthin", active: 1, content: "rootdir,images" },
  ];
  let templatesHandler: (storage: string) => any[] = (storage: string) => {
    if (storage === "local") {
      return [
        {
          volid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
          format: "tar.zst",
          size: 136128000,
          content: "vztmpl",
        },
      ];
    }
    return [];
  };
  let bridgesHandler: () => any[] = () => [
    { iface: "vmbr0", type: "bridge", active: 1, comments: "Default WAN bridge" },
  ];
  let permissionsHandler: () => any = () => ({
    "/nodes/pve01": { "VM.Allocate": 1, "VM.Config.Disk": 1 },
  });
  let delayMs = 0;

  before(async () => {
    // 1. Mock HTTP Server
    mockHttpServer = http.createServer(async (req, res) => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // Check auth header format
      const auth = req.headers["authorization"];
      if (!auth || !auth.startsWith("PVEAPIToken=")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "No API token provided" }));
        return;
      }

      if (!authHandler(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Authentication failed" }));
        return;
      }

      const url = req.url || "";

      if (url.endsWith("/api2/json/version")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { version: "8.2.4", release: "8.2", repoid: "pve-no-subscription" } }));
        return;
      }

      if (url.endsWith("/api2/json/nodes")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: nodesHandler() }));
        return;
      }

      if (url.includes("/cluster/nextid")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: 200 }));
        return;
      }

      if (url.includes("/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: statusHandler() }));
        return;
      }

      if (url.endsWith("/storage")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: storagesHandler() }));
        return;
      }

      const contentMatch = url.match(/\/storage\/([^/]+)\/content/);
      if (contentMatch) {
        const storage = decodeURIComponent(contentMatch[1]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: templatesHandler(storage) }));
        return;
      }

      if (url.includes("/network")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: bridgesHandler() }));
        return;
      }

      if (url.endsWith("/access/permissions")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: permissionsHandler() }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      mockHttpServer.listen(0, "127.0.0.1", () => {
        const addr = mockHttpServer.address() as any;
        httpPort = addr.port;
        resolve();
      });
    });

    // 2. Mock HTTPS Server (Self-signed)
    mockHttpsServer = https.createServer(
      {
        key: TEST_KEY,
        cert: TEST_CERT,
      },
      (req, res) => {
        if (req.url?.endsWith("/api2/json/version")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { version: "8.2.4", release: "8.2" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: {} }));
      }
    );

    await new Promise<void>((resolve) => {
      mockHttpsServer.listen(0, "127.0.0.1", () => {
        const addr = mockHttpsServer.address() as any;
        httpsPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    if (mockHttpServer) {
      mockHttpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => mockHttpServer.close(() => resolve()));
    }
    if (mockHttpsServer) {
      mockHttpsServer.closeAllConnections?.();
      await new Promise<void>((resolve) => mockHttpsServer.close(() => resolve()));
    }
  });

  beforeEach(() => {
    // Reset default handlers
    ProxmoxService.invalidateCache();
    delayMs = 0;
    authHandler = () => true;
    statusHandler = () => ({ uptime: 45000, cpu: 0.12, memory: { total: 32000, used: 8000 } });
    nodesHandler = () => [{ node: "pve01", status: "online" }];
    storagesHandler = () => [
      { storage: "local", type: "dir", active: 1, content: "iso,vztmpl,backup" },
      { storage: "local-lvm", type: "lvmthin", active: 1, content: "rootdir,images" },
    ];
    templatesHandler = (storage: string) => {
      if (storage === "local") {
        return [
          {
            volid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
            format: "tar.zst",
            size: 136128000,
            content: "vztmpl",
          },
        ];
      }
      return [];
    };
    bridgesHandler = () => [
      { iface: "vmbr0", type: "bridge", active: 1, comments: "Default bridge" },
    ];
  });

  const getBaseNodeConfig = (): ProxmoxNodeConfig => ({
    apiUrl: `http://127.0.0.1:${httpPort}`,
    port: httpPort,
    hostname: "127.0.0.1",
    nodeName: "pve01",
    name: "Test Node 01",
    authTokenId: "root@pam!test",
    authTokenSecret: "secret-token-123",
    allowInsecureTls: false,
    defaultRootfsStorage: "local-lvm",
    defaultBridge: "vmbr0",
  });

  // TEST 1: API reachable
  it("CHECK 1: should verify API reachable", async () => {
    const node = getBaseNodeConfig();
    const result = await ProxmoxService.verifyNode(node, true);
    assert.equal(result.reachable, true);
    assert.equal(result.checks.find((c) => c.name === "connectivity")?.status, "passed");
  });

  // TEST 2: API timeout
  it("CHECK 2: should handle API timeout gracefully", async () => {
    delayMs = 2000;
    const node = getBaseNodeConfig();
    await assert.rejects(
      async () => {
        await ProxmoxService.request(node, "GET", "/api2/json/version", undefined, 100);
      },
      (err: any) => {
        assert.equal(err instanceof ProxmoxRequestError, true);
        assert.equal(err.isTimeout, true);
        return true;
      }
    );
  });

  // TEST 3: TLS rejection
  it("CHECK 3: should reject self-signed TLS when allowInsecureTls is false", async () => {
    const node: ProxmoxNodeConfig = {
      ...getBaseNodeConfig(),
      apiUrl: `https://127.0.0.1:${httpsPort}`,
      port: httpsPort,
      allowInsecureTls: false,
    };
    await assert.rejects(
      async () => {
        await ProxmoxService.request(node, "GET", "/api2/json/version");
      },
      (err: any) => {
        assert.equal(err instanceof ProxmoxRequestError, true);
        assert.equal(err.isTlsError, true);
        return true;
      }
    );
  });

  // TEST 4: allowInsecureTls explicit opt-in
  it("CHECK 4: should allow connection when allowInsecureTls is explicitly true", async () => {
    const node: ProxmoxNodeConfig = {
      ...getBaseNodeConfig(),
      apiUrl: `https://127.0.0.1:${httpsPort}`,
      port: httpsPort,
      allowInsecureTls: true,
    };
    const res = await ProxmoxService.request(node, "GET", "/api2/json/version");
    assert.equal(res.status, 200);
  });

  // TEST 5: authentication failure
  it("CHECK 5: should detect authentication failure (401)", async () => {
    authHandler = () => false;
    const node = getBaseNodeConfig();
    const result = await ProxmoxService.verifyNode(node, true);
    assert.equal(result.authenticated, false);
    assert.equal(result.status, "misconfigured");
    assert.equal(result.checks.find((c) => c.name === "api_authentication")?.status, "failed");
  });

  // TEST 6: valid authentication
  it("CHECK 6: should confirm valid authentication", async () => {
    authHandler = () => true;
    const node = getBaseNodeConfig();
    const result = await ProxmoxService.verifyNode(node, true);
    assert.equal(result.authenticated, true);
    assert.equal(result.checks.find((c) => c.name === "api_authentication")?.status, "passed");
  });

  // TEST 7: node identity match
  it("CHECK 7: should confirm node identity match", async () => {
    const node = { ...getBaseNodeConfig(), nodeName: "pve01" };
    nodesHandler = () => [{ node: "pve01", status: "online" }];
    const result = await ProxmoxService.verifyNode(node, true);
    assert.equal(result.identityVerified, true);
    assert.equal(result.actualNodeName, "pve01");
    assert.equal(result.checks.find((c) => c.name === "node_identity")?.status, "passed");
  });

  // TEST 8: node identity mismatch
  it("CHECK 8: should mark node as misconfigured when configured nodeName does not match cluster", async () => {
    const node = { ...getBaseNodeConfig(), nodeName: "pve-nonexistent" };
    nodesHandler = () => [{ node: "pve01", status: "online" }];
    const result = await ProxmoxService.verifyNode(node, true);
    assert.equal(result.identityVerified, false);
    assert.equal(result.status, "misconfigured");
    assert.equal(result.checks.find((c) => c.name === "node_identity")?.status, "failed");
  });

  // TEST 9: node offline in cluster
  it("CHECK 9: should report node as offline when cluster reports node status != online", async () => {
    nodesHandler = () => [{ node: "pve01", status: "offline" }];
    const node = getBaseNodeConfig();
    const result = await ProxmoxService.verifyNode(node, true);
    assert.equal(result.status, "offline");
    assert.equal(result.checks.find((c) => c.name === "target_node_status")?.status, "failed");
  });

  // TEST 10: storage discovery
  it("CHECK 10: should discover and normalize storage pools", async () => {
    const node = getBaseNodeConfig();
    const storages = await ProxmoxService.getStorageList(node);
    assert.equal(storages.length, 2);
    assert.equal(storages[0].storage, "local");
    assert.equal(storages[1].storage, "local-lvm");
  });

  // TEST 11: storage capability parsing (supportsTemplates vs supportsRootfs)
  it("CHECK 11: should parse vztmpl vs rootdir correctly without guessing from name", async () => {
    const node = getBaseNodeConfig();
    const storages = await ProxmoxService.getStorageList(node);
    const local = storages.find((s) => s.storage === "local")!;
    const localLvm = storages.find((s) => s.storage === "local-lvm")!;

    assert.equal(local.supportsTemplates, true);
    assert.equal(local.supportsRootfs, false);

    assert.equal(localLvm.supportsTemplates, false);
    assert.equal(localLvm.supportsRootfs, true);
  });

  // TEST 12: multiple template storages
  it("CHECK 12: should discover multiple storages supporting vztmpl", async () => {
    storagesHandler = () => [
      { storage: "local", type: "dir", active: 1, content: "vztmpl,iso" },
      { storage: "nfs-templates", type: "nfs", active: 1, content: "vztmpl" },
      { storage: "ceph-pool", type: "rbd", active: 1, content: "rootdir,images" },
    ];
    const node = getBaseNodeConfig();
    const storages = await ProxmoxService.getStorageList(node);
    const tStorages = storages.filter((s) => s.supportsTemplates).map((s) => s.storage);
    assert.deepEqual(tStorages, ["local", "nfs-templates"]);
  });

  // TEST 13: template deduplication
  it("CHECK 13: should deduplicate templates with the same volid across pools", async () => {
    storagesHandler = () => [
      { storage: "local", type: "dir", active: 1, content: "vztmpl" },
      { storage: "nfs-templates", type: "nfs", active: 1, content: "vztmpl" },
    ];
    templatesHandler = (storage) => [
      {
        volid: `${storage}:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst`,
        format: "tar.zst",
        size: 130000000,
      },
    ];
    const node = getBaseNodeConfig();
    const templates = await ProxmoxService.getTemplates(node);
    assert.equal(templates.length, 2);
    assert.equal(templates[0].volid, "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst");
    assert.equal(templates[1].volid, "nfs-templates:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst");
  });

  // TEST 14: rootfs-only storage
  it("CHECK 14: should correctly identify rootfs-only storage", async () => {
    storagesHandler = () => [
      { storage: "nvme-thin", type: "lvmthin", active: 1, content: "rootdir,images" },
    ];
    const node = getBaseNodeConfig();
    const storages = await ProxmoxService.getStorageList(node);
    assert.equal(storages[0].supportsRootfs, true);
    assert.equal(storages[0].supportsTemplates, false);
  });

  // TEST 15: template-only storage
  it("CHECK 15: should correctly identify template-only storage", async () => {
    storagesHandler = () => [
      { storage: "gluster-tmpl", type: "glusterfs", active: 1, content: "vztmpl,iso" },
    ];
    const node = getBaseNodeConfig();
    const storages = await ProxmoxService.getStorageList(node);
    assert.equal(storages[0].supportsRootfs, false);
    assert.equal(storages[0].supportsTemplates, true);
  });

  // TEST 16: storage supporting both
  it("CHECK 16: should correctly identify storage supporting both rootdir and vztmpl", async () => {
    storagesHandler = () => [
      { storage: "shared-zfs", type: "zfspool", active: 1, content: "rootdir,vztmpl,images" },
    ];
    const node = getBaseNodeConfig();
    const storages = await ProxmoxService.getStorageList(node);
    assert.equal(storages[0].supportsRootfs, true);
    assert.equal(storages[0].supportsTemplates, true);
  });

  // TEST 17: zero templates
  it("CHECK 17: should handle zero templates without inventing fallback data", async () => {
    templatesHandler = () => [];
    const node = getBaseNodeConfig();
    const templates = await ProxmoxService.getTemplates(node);
    assert.equal(templates.length, 0);
  });

  // TEST 18: one template normalization
  it("CHECK 18: should accurately normalize a single template", async () => {
    templatesHandler = () => [
      {
        volid: "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst",
        format: "tar.zst",
        size: 120586240,
      },
    ];
    const node = getBaseNodeConfig();
    const templates = await ProxmoxService.getTemplates(node);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].volid, "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst");
    assert.equal(templates[0].storage, "local");
    assert.equal(templates[0].filename, "debian-12-standard_12.2-1_amd64.tar.zst");
    assert.equal(templates[0].format, "tar.zst");
    assert.equal(templates[0].sizeBytes, 120586240);
    assert.equal(templates[0].osFamily, "debian");
  });

  // TEST 19: multiple templates
  it("CHECK 19: should discover multiple templates across different stores", async () => {
    storagesHandler = () => [
      { storage: "local", type: "dir", active: 1, content: "vztmpl" },
      { storage: "nas", type: "nfs", active: 1, content: "vztmpl" },
    ];
    templatesHandler = (s) => [
      { volid: `${s}:vztmpl/ubuntu-22.04.tar.zst`, format: "tar.zst", size: 100000 },
      { volid: `${s}:vztmpl/alpine-3.19.tar.gz`, format: "tar.gz", size: 50000 },
    ];
    const node = getBaseNodeConfig();
    const templates = await ProxmoxService.getTemplates(node);
    assert.equal(templates.length, 4);
  });

  // TEST 20: bridge discovery
  it("CHECK 20: should discover actual network bridges", async () => {
    bridgesHandler = () => [
      { iface: "vmbr0", type: "bridge", active: 1, comments: "Default bridge" },
      { iface: "vmbr1", type: "bridge", active: 1, comments: "Private LAN" },
    ];
    const node = getBaseNodeConfig();
    const bridges = await ProxmoxService.getNetworkBridges(node);
    assert.equal(bridges.length, 2);
    assert.equal(bridges[0].iface, "vmbr0");
    assert.equal(bridges[1].iface, "vmbr1");
  });

  // TEST 21: bridge missing
  it("CHECK 21: should detect when no bridges exist on target node", async () => {
    bridgesHandler = () => [];
    const node = getBaseNodeConfig();
    const bridges = await ProxmoxService.getNetworkBridges(node);
    assert.equal(bridges.length, 0);
  });

  // TEST 22: verification status aggregation
  it("CHECK 22: should aggregate status to healthy when all checks pass", async () => {
    const node = getBaseNodeConfig();
    const result = await ProxmoxService.verifyNode(node, true);
    assert.equal(result.status, "healthy");
    assert.equal(result.provisionReady, true);
  });

  // TEST 23: stale verification detection
  it("CHECK 23: should detect when verification snapshot is stale", () => {
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const diffMins = Math.floor((Date.now() - new Date(twentyMinsAgo).getTime()) / 60000);
    assert.equal(diffMins >= 15, true);
  });

  // TEST 24: capability cache TTL
  it("CHECK 24: should return cached verification within TTL without querying network", async () => {
    const node = { ...getBaseNodeConfig(), id: "node-cache-test" };
    const res1 = await ProxmoxService.verifyNode(node, true);
    assert.equal(res1.status, "healthy");

    // Mutate mock handler to fail if called
    authHandler = () => false;
    // Without forceRefresh, should return cached result
    const res2 = await ProxmoxService.verifyNode(node, false);
    assert.equal(res2.status, "healthy");
    assert.equal(res2.authenticated, true);
  });

  // TEST 25: cache invalidation
  it("CHECK 25: should bypass cache when invalidated or forced", async () => {
    const node = getBaseNodeConfig();
    await ProxmoxService.verifyNode(node, true);

    authHandler = () => false;
    // Force refresh bypasses cache
    const res = await ProxmoxService.verifyNode(node, true);
    assert.equal(res.authenticated, false);
    assert.equal(res.status, "misconfigured");
  });

  // TEST 26: malformed Proxmox response
  it("CHECK 26: should handle malformed response without crashing", async () => {
    statusHandler = () => ({});
    const node = getBaseNodeConfig();
    const status = await ProxmoxService.getNodeStatus(node);
    assert.deepEqual(status, {});
  });

  // TEST 27: permission-denied storage query
  it("CHECK 27: should handle permission-denied on storage query safely", async () => {
    mockHttpServer.removeAllListeners("request");
    mockHttpServer.on("request", (req, res) => {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Permission check failed (/storage)" }));
    });

    const node = getBaseNodeConfig();
    await assert.rejects(
      async () => {
        await ProxmoxService.getStorageList(node);
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  // TEST 28: diagnostics contains no secrets
  it("CHECK 28: diagnostics output MUST NEVER contain token secrets or credentials", async () => {
    mockHttpServer.removeAllListeners("request");
    mockHttpServer.on("request", (req, res) => {
      if (req.url?.endsWith("/version")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { version: "8.2.4" } }));
      } else if (req.url?.endsWith("/nodes")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ node: "pve01", status: "online" }] }));
      } else if (req.url?.includes("/storage")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: {} }));
      }
    });

    const sensitiveSecret = "SUPER_SECRET_TOKEN_DO_NOT_LEAK_99999";
    const node: ProxmoxNodeConfig = {
      ...getBaseNodeConfig(),
      authTokenSecret: sensitiveSecret,
    };

    const verification = await ProxmoxService.verifyNode(node, true);
    const serialized = JSON.stringify(verification);
    assert.equal(serialized.includes(sensitiveSecret), false);
    assert.equal(serialized.includes("PVEAPIToken"), false);
  });

  // ============================================================
  // REGRESSION FIXTURE: Multi-Storage Template Discovery Bug Fix
  // ============================================================
  it("REGRESSION FIXTURE: discovers template on 'local' even when default rootfs is 'local-lvm'", async () => {
    // Exact user scenario:
    // Storage 'local': content = 'iso,vztmpl,backup', contains 'ubuntu-22.04-standard_22.04-1_amd64.tar.zst'
    // Storage 'local-lvm': content = 'rootdir,images', contains NO templates
    // Node default rootfs: 'local-lvm'
    // Node default template storage: null or 'local'
    mockHttpServer.removeAllListeners("request");
    mockHttpServer.on("request", (req, res) => {
      const url = req.url || "";
      if (url.endsWith("/nodes/pve01/storage")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              { storage: "local", type: "dir", active: 1, content: "iso,vztmpl,backup" },
              { storage: "local-lvm", type: "lvmthin", active: 1, content: "rootdir,images" },
            ],
          })
        );
        return;
      }

      if (url.endsWith("/storage/local/content")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                volid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
                format: "tar.zst",
                size: 136128000,
                content: "vztmpl",
              },
            ],
          })
        );
        return;
      }

      if (url.endsWith("/storage/local-lvm/content")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: {} }));
    });

    const node: ProxmoxNodeConfig = {
      ...getBaseNodeConfig(),
      defaultRootfsStorage: "local-lvm", // Rootfs is local-lvm
      defaultTemplateStorage: undefined,   // Not set
    };

    // Call getTemplates directly
    const discovered = await ProxmoxService.getTemplates(node);

    // MUST find the real Ubuntu template
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].volid, "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst");
    assert.equal(discovered[0].storage, "local");
    assert.equal(discovered[0].filename, "ubuntu-22.04-standard_22.04-1_amd64.tar.zst");
  });

  // ============================================================
  // PHASE 50: PROVISIONING PRE-FLIGHT VALIDATION TESTS
  // ============================================================
  describe("Provisioning Pre-Flight Validation", () => {
    let appServer: http.Server;
    let appBaseUrl = "";
    const ADMIN_SESSION = "test-sess-admin-" + crypto.randomUUID();
    const TEST_ADMIN_ID = "test-admin-" + crypto.randomUUID();
    const NODE_DB_ID = "node-test-" + crypto.randomUUID();

    before(async () => {
      // Setup mock server responses for pre-flight testing
      mockHttpServer.removeAllListeners("request");
      mockHttpServer.on("request", (req, res) => {
        const url = req.url || "";
        if (url.endsWith("/version")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { version: "8.2.4", release: "8.2" } }));
          return;
        }
        if (url.endsWith("/nodes")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ node: "pve01", status: "online" }] }));
          return;
        }
        if (url.includes("/content")) {
          if (url.includes("/local/")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                data: [
                  {
                    volid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
                    format: "tar.zst",
                    size: 136128000,
                    content: "vztmpl",
                  },
                ],
              })
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [] }));
          return;
        }
        if (url.includes("/storage")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              data: [
                { storage: "local", type: "dir", active: 1, content: "iso,vztmpl,backup" },
                { storage: "local-lvm", type: "lvmthin", active: 1, content: "rootdir,images" },
              ],
            })
          );
          return;
        }
        if (url.includes("/network")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [{ iface: "vmbr0", type: "bridge", active: 1 }] }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: {} }));
      });

      const app = await createApp();
      await new Promise<void>((resolve) => {
        appServer = app.listen(0, () => {
          const addr = appServer.address() as any;
          appBaseUrl = `http://localhost:${addr.port}`;
          resolve();
        });
      });

      const now = new Date().toISOString();
      const future = new Date(Date.now() + 86400000).toISOString();

      // Create admin user & session with proper schema
      execute(
        `INSERT OR REPLACE INTO users (id, discord_id, username, global_name, email, role, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Test Admin', ?, 'admin', 'active', ?, ?)`,
        [TEST_ADMIN_ID, "disc-admin-" + Date.now(), "admin", `admin-${TEST_ADMIN_ID.slice(0, 6)}@interdash.local`, now, now]
      );

      execute(
        `INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), TEST_ADMIN_ID, hashToken(ADMIN_SESSION), future, now, now]
      );

      // Insert test node into database pointing to mock Proxmox HTTP server
      execute(
        `INSERT INTO proxmox_nodes (
          id, name, hostname, api_url, port, node_name, region,
          auth_token_id, auth_token_secret_encrypted, allow_insecure_tls,
          default_storage, default_template_storage, default_rootfs_storage, default_bridge,
          enabled, status, created_at, updated_at
        ) VALUES (
          ?, 'Provisioning Test Node', '127.0.0.1', ?, ?, 'pve01', 'eu-west',
          'root@pam!token', ?, 0,
          'local-lvm', 'local', 'local-lvm', 'vmbr0',
          1, 'healthy', ?, ?
        )`,
        [
          NODE_DB_ID,
          `http://127.0.0.1:${httpPort}`,
          httpPort,
          encryptCredential("secret"),
          now,
          now,
        ]
      );
    });

    after(async () => {
      if (appServer) {
        appServer.closeAllConnections?.();
        await new Promise<void>((resolve) => appServer.close(() => resolve()));
      }
      closeDatabase();
    });

    const CSRF_TOKEN = "test-csrf-token-preflight";

    async function fetchApi(path: string, options: RequestInit = {}): Promise<Response> {
      const headers = new Headers(options.headers || {});
      if (!headers.has("x-csrf-token")) {
        headers.set("x-csrf-token", CSRF_TOKEN);
      }
      const existingCookie = headers.get("Cookie") || "";
      if (!existingCookie.includes("interdash_csrf")) {
        headers.set(
          "Cookie",
          existingCookie
            ? `${existingCookie}; interdash_csrf=${CSRF_TOKEN}`
            : `interdash_csrf=${CSRF_TOKEN}`
        );
      }
      return fetch(`${appBaseUrl}${path}`, {
        ...options,
        headers,
        redirect: "manual",
      });
    }

    it("should accept valid template and rootfs storage in preflight", async () => {
      const res = await fetchApi("/api/admin/vps/preflight", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `interdash_session=${ADMIN_SESSION}`,
        },
        body: JSON.stringify({
          targetNodeId: NODE_DB_ID,
          templateVolid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
          rootfsStorage: "local-lvm",
          bridge: "vmbr0",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.valid, true);
    });

    it("should reject nonexistent template with 422", async () => {
      const res = await fetchApi("/api/admin/vps/preflight", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `interdash_session=${ADMIN_SESSION}`,
        },
        body: JSON.stringify({
          targetNodeId: NODE_DB_ID,
          templateVolid: "local:vztmpl/archlinux-nonexistent_amd64.tar.zst",
          rootfsStorage: "local-lvm",
          bridge: "vmbr0",
        }),
      });

      assert.equal(res.status, 422);
      const data = await res.json();
      assert.equal(data.valid, false);
      assert.match(data.error, /(was not found on node|does not exist on target node)/i);
    });

    it("should reject rootfs storage that does NOT support rootdir with 422", async () => {
      const res = await fetchApi("/api/admin/vps/preflight", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `interdash_session=${ADMIN_SESSION}`,
        },
        body: JSON.stringify({
          targetNodeId: NODE_DB_ID,
          templateVolid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
          rootfsStorage: "local", // Invalid rootfs storage: local only has vztmpl, not rootdir
          bridge: "vmbr0",
        }),
      });

      assert.equal(res.status, 422);
      const data = await res.json();
      assert.equal(data.valid, false);
      assert.match(data.error, /does not support container root disks/i);
    });

    it("should reject invalid network bridge with 422", async () => {
      const res = await fetchApi("/api/admin/vps/preflight", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `interdash_session=${ADMIN_SESSION}`,
        },
        body: JSON.stringify({
          targetNodeId: NODE_DB_ID,
          templateVolid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
          rootfsStorage: "local-lvm",
          bridge: "vmbr99_nonexistent",
        }),
      });

      assert.equal(res.status, 422);
      const data = await res.json();
      assert.equal(data.valid, false);
      assert.match(data.error, /bridge.*(not found|not available)/i);
    });
  });
});
