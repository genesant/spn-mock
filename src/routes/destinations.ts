import { Router, type Request, type Response } from "express";
import db from "../db.js";

const router = Router();

/** GET /v1/destinations — scoped to authorized tenants */
router.get("/", (req: Request, res: Response): void => {
  const tenantIds = req.auth!.tenantIds;

  const rows = db
    .prepare(
      `SELECT d.*, t.name as tenant_name
       FROM destinations d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.tenant_id IN (${tenantIds.map(() => "?").join(",")})`
    )
    .all(...tenantIds);

  res.json({ data: rows });
});

/** GET /v1/destinations/:id */
router.get("/:id", (req: Request, res: Response): void => {
  const tenantIds = req.auth!.tenantIds;

  const row = db
    .prepare(
      `SELECT d.*, t.name as tenant_name
       FROM destinations d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = ? AND d.tenant_id IN (${tenantIds.map(() => "?").join(",")})`
    )
    .get(req.params.id, ...tenantIds);

  if (!row) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }

  res.json(row);
});

export default router;
