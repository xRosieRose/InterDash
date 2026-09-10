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

export default router;
