import express from "express";
import cors from "cors";
import db from "./db.js";
import { apiKeyAuth } from "./middleware/auth.js";
import checkoutRoutes from "./routes/checkout.js";
import chargeRoutes from "./routes/charges.js";
import destinationRoutes from "./routes/destinations.js";
import refundRoutes from "./routes/refunds.js";
import webhookRoutes from "./routes/webhooks.js";
import { renderCheckoutPage } from "./views/checkout-page.js";
import { renderAdminPage } from "./views/admin-page.js";
import { renderChargeDetailPage } from "./views/charge-detail-page.js";
import { fireWebhook } from "./routes/webhooks.js";
import { v4 as uuid } from "uuid";

const app = express();
const PORT = Number(process.env.SPN_PORT) || 4100;
const BASE_URL = process.env.SPN_BASE_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());

// ----------------------------------------------------------------
// Public routes -- no API key required
// ----------------------------------------------------------------

/** Checkout iframe page -- check expiration before rendering. */
app.get("/checkout/:sessionId", (req, res) => {
  const session = db
    .prepare("SELECT * FROM checkout_sessions WHERE id = ?")
    .get(req.params.sessionId) as Record<string, unknown> | undefined;

  if (!session || session.status !== "pending") {
    res.status(404).send("Session not found or already completed.");
    return;
  }

  if (session.expires_at && new Date(session.expires_at as string) < new Date()) {
    db.prepare("UPDATE checkout_sessions SET status = 'expired', updated_at = datetime('now') WHERE id = ?")
      .run(req.params.sessionId);
    res.status(410).send("This checkout session has expired.");
    return;
  }

  const html = renderCheckoutPage(req.params.sessionId, BASE_URL);
  if (!html) {
    res.status(404).send("Session not found or already completed.");
    return;
  }
  res.type("html").send(html);
});

/**
 * POST /v1/checkout-sessions/:id/complete -- MOCK ONLY.
 *
 * For card: creates charge as 'completed', fires charge.completed webhook.
 * For ACH: creates charge as 'processing', fires charge.processing webhook.
 *   Admin settles via POST /admin/charges/:id/settle.
 */
app.post("/v1/checkout-sessions/:id/complete", (req, res) => {
  const session = db
    .prepare("SELECT * FROM checkout_sessions WHERE id = ?")
    .get(req.params.id) as Record<string, unknown> | undefined;

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.status !== "pending") {
    res.status(409).json({ error: `Session already ${session.status}` });
    return;
  }

  if (session.expires_at && new Date(session.expires_at as string) < new Date()) {
    db.prepare("UPDATE checkout_sessions SET status = 'expired', updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
    res.status(410).json({ error: "Session expired" });
    return;
  }

  const paymentDetails = req.body?.paymentDetails ?? null;
  const paymentMethod = paymentDetails?.method ?? "card";
  const isAch = paymentMethod === "ach";
  const chargeStatus = isAch ? "processing" : "completed";
  const chargeId = `ch_${uuid().replace(/-/g, "")}`;
  const netCents = (session.amount_cents as number) - (session.fee_cents as number);

  const complete = db.transaction(() => {
    db.prepare(
      `INSERT INTO charges (id, destination_id, session_id, amount_cents, fee_cents, net_cents, currency, reference_id, status, payment_details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      chargeId,
      session.destination_id,
      session.id,
      session.amount_cents,
      session.fee_cents,
      netCents,
      session.currency,
      session.reference_id,
      chargeStatus,
      paymentDetails ? JSON.stringify(paymentDetails) : null
    );

    db.prepare(
      "UPDATE checkout_sessions SET status = 'completed', charge_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(chargeId, session.id);
  });

  complete();

  const updated = db.prepare("SELECT * FROM checkout_sessions WHERE id = ?").get(session.id);

  // Resolve the API key for this destination's tenant to fire webhook
  const dest = db
    .prepare("SELECT tenant_id FROM destinations WHERE id = ?")
    .get(session.destination_id as string) as { tenant_id: string } | undefined;

  if (dest) {
    const keyRow = db
      .prepare(
        `SELECT ak.id FROM api_keys ak
         JOIN api_key_tenants akt ON akt.api_key_id = ak.id
         WHERE akt.tenant_id = ? LIMIT 1`
      )
      .get(dest.tenant_id) as { id: string } | undefined;

    if (keyRow) {
      const webhookEvent = isAch ? "charge.processing" : "charge.completed";
      fireWebhook(keyRow.id, {
        event: webhookEvent,
        charge_id: chargeId,
        destination_id: session.destination_id as string,
        amount_cents: session.amount_cents as number,
        fee_cents: session.fee_cents as number,
        net_cents: netCents,
        currency: session.currency as string,
        payment_method: paymentMethod,
        reference_id: session.reference_id as string | null,
        created_at: new Date().toISOString(),
      });
    }
  }

  res.json(updated);
});

/**
 * POST /admin/charges/:id/settle -- MOCK ONLY.
 *
 * Settles a 'processing' ACH charge: flips to 'completed',
 * fires charge.completed webhook.
 */
app.post("/admin/charges/:chargeId/settle", (req, res) => {
  const charge = db
    .prepare("SELECT * FROM charges WHERE id = ?")
    .get(req.params.chargeId) as Record<string, unknown> | undefined;

  if (!charge) {
    res.status(404).json({ error: "Charge not found" });
    return;
  }

  if (charge.status !== "processing") {
    res.status(409).json({ error: `Charge is ${charge.status}, not processing` });
    return;
  }

  db.prepare("UPDATE charges SET status = 'completed' WHERE id = ?")
    .run(req.params.chargeId);

  // Fire charge.completed webhook
  const dest = db
    .prepare("SELECT tenant_id FROM destinations WHERE id = ?")
    .get(charge.destination_id as string) as { tenant_id: string } | undefined;

  if (dest) {
    const keyRow = db
      .prepare(
        `SELECT ak.id FROM api_keys ak
         JOIN api_key_tenants akt ON akt.api_key_id = ak.id
         WHERE akt.tenant_id = ? LIMIT 1`
      )
      .get(dest.tenant_id) as { id: string } | undefined;

    if (keyRow) {
      fireWebhook(keyRow.id, {
        event: "charge.completed",
        charge_id: charge.id as string,
        destination_id: charge.destination_id as string,
        amount_cents: charge.amount_cents as number,
        fee_cents: charge.fee_cents as number,
        net_cents: charge.net_cents as number,
        currency: charge.currency as string,
        payment_method: (() => {
          try {
            return JSON.parse(charge.payment_details as string)?.method ?? "ach";
          } catch {
            return "ach";
          }
        })(),
        reference_id: charge.reference_id as string | null,
        created_at: new Date().toISOString(),
      });
    }
  }

  res.json({ settled: true, charge_id: req.params.chargeId });
});

/** Admin dashboard -- mock only, no auth. */
app.get("/admin", (_req, res) => {
  res.type("html").send(renderAdminPage());
});

/** Charge detail -- mock only, no auth. */
app.get("/admin/charges/:chargeId", (req, res) => {
  const html = renderChargeDetailPage(req.params.chargeId);
  if (!html) {
    res.status(404).send("Charge not found.");
    return;
  }
  res.type("html").send(html);
});

// ----------------------------------------------------------------
// Authenticated API routes -- require Bearer API key
// ----------------------------------------------------------------

app.use("/v1/checkout-sessions", apiKeyAuth, checkoutRoutes);
app.use("/v1/charges", apiKeyAuth, chargeRoutes);
app.use("/v1/destinations", apiKeyAuth, destinationRoutes);
app.use("/v1/refunds", apiKeyAuth, refundRoutes);
app.use("/v1/webhooks", apiKeyAuth, webhookRoutes);

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------

app.listen(PORT, () => {
  console.log("");
  console.log("  +-----------------------------------------+");
  console.log("  |  SPN Mock API                           |");
  console.log(`  |  API:   ${BASE_URL.padEnd(31)}|`);
  console.log(`  |  Admin: ${(BASE_URL + "/admin").padEnd(31)}|`);
  console.log("  +-----------------------------------------+");
  console.log("");
});