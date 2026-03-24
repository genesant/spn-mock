import { Router, type Request, type Response } from "express";
import { createHmac } from "node:crypto";
import db from "../db.js";

const router = Router();

/** Sign and fire a webhook to the registered URL for this API key. */
export async function fireWebhook(apiKeyId: string, payload: Record<string, unknown>): Promise<void> {
  const row = db.prepare("SELECT webhook_url, webhook_secret FROM api_keys WHERE id = ?").get(apiKeyId) as
    | { webhook_url: string | null; webhook_secret: string | null }
    | undefined;

  if (!row?.webhook_url) return;

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (row.webhook_secret) {
    const signedPayload = timestamp + "." + body;
    const signature = createHmac("sha256", row.webhook_secret)
      .update(signedPayload)
      .digest("hex");
    headers["SPN-Signature"] = "t=" + timestamp + ",v1=" + signature;
  }

  try {
    await fetch(row.webhook_url, {
      method: "POST",
      headers,
      body,
    });
    console.log(`[webhook] ${payload.event} -> ${row.webhook_url}`);
  } catch (err) {
    console.error(`[webhook] Failed to fire ${payload.event}:`, err);
  }
}

/** POST /v1/webhooks/test — MOCK ONLY. Fire a test event to the registered URL. */
router.post("/test", (req: Request, res: Response): void => {
  const row = db.prepare("SELECT webhook_url FROM api_keys WHERE id = ?").get(req.auth!.apiKeyId) as
    | { webhook_url: string | null }
    | undefined;

  if (!row?.webhook_url) {
    res.status(400).json({ error: "No webhook_url configured for this API key" });
    return;
  }

  fireWebhook(req.auth!.apiKeyId, {
    event: "test",
    message: "This is a test webhook from SPN mock.",
    created_at: new Date().toISOString(),
  });

  res.json({ sent_to: row.webhook_url });
});

export default router;