import db from "../db.js";

export function renderChargeDetailPage(chargeId: string): string | null {
  const charge = db
    .prepare(
      `SELECT c.*, d.name as destination_name, t.name as tenant_name,
              cs.allowed_payment_types, cs.success_url, cs.cancel_url
       FROM charges c
       JOIN destinations d ON d.id = c.destination_id
       JOIN tenants t ON t.id = d.tenant_id
       LEFT JOIN checkout_sessions cs ON cs.id = c.session_id
       WHERE c.id = ?`
    )
    .get(chargeId) as Record<string, unknown> | undefined;

  if (!charge) return null;

  let details: Record<string, string> = {};
  if (charge.payment_details) {
    try {
      details = JSON.parse(charge.payment_details as string);
    } catch {}
  }

  const dollars = ((charge.amount_cents as number) / 100).toFixed(2);
  const feeDollars = ((charge.fee_cents as number) / 100).toFixed(2);
  const netDollars = ((charge.net_cents as number) / 100).toFixed(2);

  const method = details.method ?? "unknown";
  const isCard = method === "card";

  const fullCard = isCard ? (details.cardNumber || null) : null;
  const fullAccount = !isCard ? (details.accountNumber || null) : null;

  function row(label: string, value: string | null) {
    if (!value) return "";
    return `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  }

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SPN Admin — Charge ${chargeId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      padding: 32px;
    }
    .logo { font-size: 22px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .logo span { color: #818cf8; }
    .subtitle { font-size: 13px; color: #888; margin-bottom: 32px; }
    .back {
      display: inline-block;
      color: #818cf8;
      font-size: 13px;
      text-decoration: none;
      margin-bottom: 24px;
    }
    .back:hover { text-decoration: underline; }
    .card {
      background: #1a1a2e;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .card-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      font-weight: 500;
      margin-bottom: 16px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #2a2a3d;
    }
    .row:last-child { border-bottom: none; }
    .label { color: #888; font-size: 13px; }
    .value { color: #e0e0e0; font-size: 13px; font-weight: 500; }
    .value code {
      font-size: 11px;
      background: #0f0f1a;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      background: #065f46;
      color: #6ee7b7;
    }
    .amount-hero {
      font-size: 36px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 4px;
    }
    .amount-hero small { font-size: 14px; color: #888; font-weight: 400; }
    .badge-processing { background: #92400e; color: #fbbf24; }
    .settle-btn {
      display: inline-block;
      margin-left: 12px;
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      background: #1e40af;
      color: #93c5fd;
      border: none;
      cursor: pointer;
    }
    .settle-btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="logo">Sport<span>Pass</span>NIL</div>
  <div class="subtitle">Mock Admin Dashboard</div>
  <a href="/admin" class="back">\u2190 All charges</a>

  <div class="card">
    <div class="amount-hero">$${dollars} <small>${(charge.currency as string).toUpperCase()}</small></div>
    <span class="badge ${charge.status === "processing" ? "badge-processing" : ""}">${charge.status}</span>
    ${charge.status === "processing" ? `<button class="settle-btn" onclick="settle('${charge.id}')">Settle ACH</button>` : ""}
  </div>

  <div class="card">
    <div class="card-title">Transaction</div>
    ${row("Charge ID", "<code>" + charge.id + "</code>")}
    ${row("Session ID", charge.session_id ? "<code>" + charge.session_id + "</code>" : null)}
    ${row("Reference", charge.reference_id ? "<code>" + charge.reference_id + "</code>" : null)}
    ${row("Destination", charge.destination_name as string)}
    ${row("Tenant", charge.tenant_name as string)}
    ${row("Created", charge.created_at as string)}
  </div>

  <div class="card">
    <div class="card-title">Financials</div>
    ${row("Amount", "$" + dollars)}
    ${row("Fee", "$" + feeDollars)}
    ${row("Net", "$" + netDollars)}
  </div>

  <div class="card">
    <div class="card-title">Payment Details</div>
    ${row("Method", isCard ? "Credit / Debit Card" : method === "ach" ? "Bank Account (ACH)" : "Unknown")}
    ${isCard ? row("Card Number", fullCard) : ""}
    ${isCard ? row("Expiry", details.expiry || null) : ""}
    ${isCard ? row("CVC", details.cvc || null) : ""}
    ${isCard ? row("Cardholder", details.cardName || null) : ""}
    ${!isCard && method === "ach" ? row("Account Holder", details.accountHolder || null) : ""}
    ${!isCard && method === "ach" ? row("Routing Number", details.routing || null) : ""}
    ${!isCard && method === "ach" ? row("Account Number", fullAccount) : ""}
    ${Object.keys(details).length === 0 ? '<div class="row"><span class="label">No payment details captured</span></div>' : ""}
  </div>

  <script>
    async function settle(chargeId) {
      await fetch('/admin/charges/' + chargeId + '/settle', { method: 'POST' });
      location.reload();
    }
  </script>
</body>
</html>`;
}