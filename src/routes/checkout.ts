import { Router, type Request, type Response } from "express";
import { v4 as uuid } from "uuid";
import db from "../db.js";
import { assertDestinationAccess } from "../middleware/auth.js";

const router = Router();

const SPN_BASE_URL = process.env.SPN_BASE_URL || "http://localhost:4100";

/** POST /v1/checkout-sessions */
router.post("/", (req: Request, res: Response): void => {
  const { destination_id, amount_cents, fee_cents, currency, reference_id, success_url, cancel_url, allowed_payment_types } =
    req.body;

  if (!destination_id || amount_cents == null) {
    res.status(400).json({ error: "destination_id and amount_cents are required" });
    return;
  }

  if (!assertDestinationAccess(destination_id, req.auth!)) {
    res.status(403).json({ error: "Destination not accessible with this API key" });
    return;
  }

  const id = `cs_${uuid().replace(/-/g, "")}`;

  db.prepare(
    `INSERT INTO checkout_sessions
       (id, destination_id, amount_cents, fee_cents, currency, reference_id, success_url, cancel_url, allowed_payment_types, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(
    id,
    destination_id,
    amount_cents,
    fee_cents ?? 0,
    currency ?? "usd",
    reference_id ?? null,
    success_url ?? null,
    cancel_url ?? null,
    allowed_payment_types ? JSON.stringify(allowed_payment_types) : null
  );

  const session = db.prepare("SELECT * FROM checkout_sessions WHERE id = ?").get(id) as Record<string, unknown>;
  
  res.status(201).json({
    ...session,
    iframe_url: `${SPN_BASE_URL}/checkout/${id}`,
  });
});

/** GET /v1/checkout-sessions/:id */
router.get("/:id", (req: Request, res: Response): void => {
  const session = db.prepare("SELECT * FROM checkout_sessions WHERE id = ?").get(req.params.id) as
    | Record<string, unknown>
    | undefined;

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!assertDestinationAccess(session.destination_id as string, req.auth!)) {
    res.status(403).json({ error: "Not accessible with this API key" });
    return;
  }

  res.json(session);
});

export default router;
