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

/** Checkout iframe page -- served to the sponsor's browser. */
app.get("/checkout/:sessionId", (req, res) => {
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
 * Called by the iframe (no API key in browser). In production SPN this
 * would be an internal call from SPN's own checkout frontend to its
 * own backend. We expose it publicly in the mock for simplicity.
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

  const chargeId = `ch_${uuid().replace(/-/g, "")}`;
  const netCents = (session.amount_cents as number) - (session.fee_cents as number);

  const complete = db.transaction(() => {
    db.prepare(
      `INSERT INTO charges (id, destination_id, session_id, amount_cents, fee_cents, net_cents, currency, reference_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`
    ).run(
      chargeId,
      session.destination_id,
      session.id,
      session.amount_cents,
      session.fee_cents,
      netCents,
      session.currency,
      session.reference_id
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
      fireWebhook(keyRow.id, {
        event: "charge.completed",
        charge_id: chargeId,
        destination_id: session.destination_id as string,
        amount_cents: session.amount_cents as number,
        fee_cents: session.fee_cents as number,
        net_cents: netCents,
        reference_id: session.reference_id as string | null,
        created_at: new Date().toISOString(),
      });
    }
  }

  res.json(updated);
});

/** Admin dashboard -- mock only, no auth. */
app.get("/admin", (_req, res) => {
  res.type("html").send(renderAdminPage());
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
