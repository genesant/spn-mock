import { Router, type Request, type Response } from "express";
import db from "../db.js";

const router = Router();

/** Fire a webhook to the registered URL for this API key. Best-effort, no retries. */
export async function fireWebhook(apiKeyId: string, payload: Record<string, unknown>): Promise<void> {
  const row = db.prepare("SELECT webhook_url FROM api_keys WHERE id = ?").get(apiKeyId) as
    | { webhook_url: string | null }
    | undefined;

  if (!row?.webhook_url) return;

  try {
    await fetch(row.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
