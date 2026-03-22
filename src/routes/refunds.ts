import { Router, type Request, type Response } from "express";
import { v4 as uuid } from "uuid";
import db from "../db.js";
import { fireWebhook } from "./webhooks.js";

const router = Router();

/** POST /v1/refunds */
router.post("/", (req: Request, res: Response): void => {
  const { charge_id, amount_cents } = req.body;

  if (!charge_id) {
    res.status(400).json({ error: "charge_id is required" });
    return;
  }

  const charge = db
    .prepare(
      `SELECT c.* FROM charges c
       JOIN destinations d ON d.id = c.destination_id
       WHERE c.id = ? AND d.tenant_id IN (${req.auth!.tenantIds.map(() => "?").join(",")})`
    )
    .get(charge_id, ...req.auth!.tenantIds) as Record<string, unknown> | undefined;

  if (!charge) {
    res.status(404).json({ error: "Charge not found" });
    return;
  }

  const refundAmount = amount_cents ?? charge.amount_cents;
  const id = `re_${uuid().replace(/-/g, "")}`;

  db.prepare(
    "INSERT INTO refunds (id, charge_id, amount_cents, status) VALUES (?, ?, ?, 'completed')"
  ).run(id, charge_id, refundAmount);

  const refund = db.prepare("SELECT * FROM refunds WHERE id = ?").get(id);

  fireWebhook(req.auth!.apiKeyId, {
    event: "refund.completed",
    refund_id: id,
    charge_id,
    amount_cents: refundAmount,
    created_at: new Date().toISOString(),
  });

  res.status(201).json(refund);
});

export default router;
