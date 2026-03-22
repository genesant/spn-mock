import db from "../db.js";

/** Simple admin view showing all charges. No auth — mock only. */
export function renderAdminPage(): string {
  const charges = db
    .prepare(
      `SELECT c.*, d.name as destination_name, t.name as tenant_name
       FROM charges c
       JOIN destinations d ON d.id = c.destination_id
       JOIN tenants t ON t.id = d.tenant_id
       ORDER BY c.created_at DESC
       LIMIT 100`
    )
    .all() as Record<string, unknown>[];

  const rows = charges
    .map(
      (c) => `
      <tr>
        <td><code>${c.id}</code></td>
        <td>${c.tenant_name}</td>
        <td>${c.destination_name}</td>
        <td>$${((c.amount_cents as number) / 100).toFixed(2)}</td>
        <td>$${((c.fee_cents as number) / 100).toFixed(2)}</td>
        <td>$${((c.net_cents as number) / 100).toFixed(2)}</td>
        <td><code>${c.reference_id || "—"}</code></td>
        <td><span class="badge">${c.status}</span></td>
        <td>${c.created_at}</td>
      </tr>`
    )
    .join("");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SPN Admin — Charges</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      padding: 32px;
    }
    .logo {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 4px;
    }
    .logo span { color: #818cf8; }
    .subtitle { font-size: 13px; color: #888; margin-bottom: 32px; }
    .count { color: #888; font-size: 14px; margin-bottom: 16px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #2a2a3d;
      color: #888;
      font-weight: 500;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #1a1a2e;
    }
    tr:hover td { background: #1a1a2e; }
    code {
      font-size: 11px;
      background: #1a1a2e;
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
    .empty {
      text-align: center;
      padding: 64px 0;
      color: #555;
    }
    .refresh {
      float: right;
      padding: 8px 16px;
      background: #1a1a2e;
      color: #818cf8;
      border: 1px solid #2a2a3d;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    .refresh:hover { background: #2a2a3d; }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;">
    <div>
      <div class="logo">Sport<span>Pass</span>NIL</div>
      <div class="subtitle">Mock Admin Dashboard</div>
    </div>
    <button class="refresh" onclick="location.reload()">Refresh</button>
  </div>

  <div class="count">${charges.length} charge${charges.length === 1 ? "" : "s"}</div>

  ${
    charges.length === 0
      ? '<div class="empty">No charges yet. Waiting for checkouts…</div>'
      : `<table>
      <thead>
        <tr>
          <th>Charge ID</th>
          <th>Tenant</th>
          <th>Destination</th>
          <th>Amount</th>
          <th>Fee</th>
          <th>Net</th>
          <th>Reference</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
  }

  <script>setTimeout(() => location.reload(), 30000);</script>
</body>
</html>`;
}
