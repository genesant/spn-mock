import { Router, type Request, type Response } from "express";
import db from "../db.js";

const router = Router();

/** GET /v1/charges — filterable by destination_id, paginated */
router.get("/", (req: Request, res: Response): void => {
  const { destination_id, limit, offset } = req.query;
  const tenantIds = req.auth!.tenantIds;

  let sql = `
    SELECT c.* FROM charges c
    JOIN destinations d ON d.id = c.destination_id
    WHERE d.tenant_id IN (${tenantIds.map(() => "?").join(",")})
  `;
  const params: unknown[] = [...tenantIds];

  if (destination_id) {
    sql += " AND c.destination_id = ?";
    params.push(destination_id);
  }

  sql += " ORDER BY c.created_at DESC";
  sql += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit) || 50, Number(offset) || 0);

  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, has_more: rows.length === (Number(limit) || 50) });
});

/** GET /v1/charges/:id */
router.get("/:id", (req: Request, res: Response): void => {
  const row = db
    .prepare(
      `SELECT c.* FROM charges c
       JOIN destinations d ON d.id = c.destination_id
       WHERE c.id = ? AND d.tenant_id IN (${req.auth!.tenantIds.map(() => "?").join(",")})`
    )
    .get(req.params.id, ...req.auth!.tenantIds) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: "Charge not found" });
    return;
  }

  res.json(row);
});

export default router;
