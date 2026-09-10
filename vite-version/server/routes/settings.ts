/**
 * InterDash Server — Public Panel Settings Route
 *
 * Public endpoint allowing the browser to load configured platform branding,
 * panel title, contact URLs, and community links dynamically.
 */

import { Router, type Request, type Response } from "express";
import { queryAll } from "../db/index.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  const rows = queryAll<{ key: string; value: string }>(
    "SELECT key, value FROM panel_settings"
  );

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  res.json({ settings });
});

/**
 * GET /api/settings/proxy-image?url=...
 * Proxies external images with server-side fetch to bypass strict hotlinking referer blocks
 */
router.get("/proxy-image", async (req: Request, res: Response) => {
  const imageUrl = req.query.url;
  if (!imageUrl || typeof imageUrl !== "string") {
    return res.status(400).send("Missing url query parameter");
  }

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).send("Invalid image URL protocol");
    }

    const upstream = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send("Failed to fetch upstream image");
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

    const arrayBuffer = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(502).send("Error proxying image");
  }
});

export default router;
