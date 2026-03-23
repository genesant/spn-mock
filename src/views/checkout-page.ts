import db from "../db.js";

/** Returns the HTML for the checkout iframe. */
export function renderCheckoutPage(sessionId: string, baseUrl: string): string | null {
  const session = db.prepare("SELECT * FROM checkout_sessions WHERE id = ?").get(sessionId) as
    | Record<string, unknown>
    | undefined;

  if (!session || session.status !== "pending") return null;

  const dollars = ((session.amount_cents as number) / 100).toFixed(2);
  const currency = (session.currency as string).toUpperCase();

  let allowedTypes: string[] = ["card", "ach"];
  if (session.allowed_payment_types) {
    try {
      allowedTypes = JSON.parse(session.allowed_payment_types as string);
    } catch {}
  }

  const showCard = allowedTypes.includes("card");
  const showAch = allowedTypes.includes("ach");
  const showTabs = showCard && showAch;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SPN Checkout</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f7f8fa;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      color: #1a1a2e;
    }
    .container {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 32px;
      width: 100%;
      max-width: 400px;
    }
    .logo {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #1a1a2e;
      margin-bottom: 4px;
    }
    .logo span { color: #4f46e5; }
    .subtitle {
      font-size: 12px;
      color: #888;
      margin-bottom: 24px;
    }
    .amount {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 24px;
    }
    .amount small { font-size: 14px; color: #888; font-weight: 400; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #555;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 16px;
      transition: border-color 0.15s;
    }
    input:focus { outline: none; border-color: #4f46e5; }
    .row { display: flex; gap: 12px; }
    .row > div { flex: 1; }
    .tabs {
      display: flex;
      gap: 0;
      margin-bottom: 24px;
      border: 1px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
    }
    .tab {
      flex: 1;
      padding: 10px;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      background: #f7f8fa;
      color: #888;
      border: none;
      transition: all 0.15s;
    }
    .tab.active {
      background: #fff;
      color: #1a1a2e;
      box-shadow: inset 0 -2px 0 #4f46e5;
    }
    .tab:not(:last-child) { border-right: 1px solid #ddd; }
    .pay-btn {
      width: 100%;
      padding: 14px;
      background: #4f46e5;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 8px;
      transition: background 0.15s;
    }
    .pay-btn:hover { background: #4338ca; }
    .pay-btn:disabled { background: #a5a3d6; cursor: not-allowed; }
    .secure {
      text-align: center;
      font-size: 11px;
      color: #999;
      margin-top: 16px;
    }
    .success {
      text-align: center;
      padding: 40px 0;
    }
    .success .check {
      width: 56px;
      height: 56px;
      background: #10b981;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }
    .success .check svg { width: 28px; height: 28px; }
    .success h2 { font-size: 20px; margin-bottom: 8px; }
    .success p { color: #666; font-size: 14px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div id="form-view">
      <div class="logo">Sport<span>Pass</span>NIL</div>
      <div class="subtitle">Secure checkout</div>
      <div class="amount">$${dollars} <small>${currency}</small></div>

      ${showTabs ? `
      <div class="tabs">
        <button class="tab active" id="tab-card" onclick="switchTab('card')">Credit / Debit Card</button>
        <button class="tab" id="tab-ach" onclick="switchTab('ach')">Bank Account</button>
      </div>
      ` : ""}

      <div id="card-form" class="${showCard ? "" : "hidden"}">
        <label>Card number</label>
        <input type="text" placeholder="4242 4242 4242 4242" maxlength="19" id="card-number" value="4242 4242 4242 4242">
        <div class="row">
          <div>
            <label>Expiry</label>
            <input type="text" placeholder="12/28" maxlength="5" value="12/28">
          </div>
          <div>
            <label>CVC</label>
            <input type="text" placeholder="123" maxlength="4" value="123">
          </div>
        </div>
        <label>Name on card</label>
        <input type="text" placeholder="Jane Smith" id="card-name">
      </div>

      <div id="ach-form" class="${showAch && !showCard ? "" : "hidden"}">
        <label>Account holder name</label>
        <input type="text" placeholder="Jane Smith" id="ach-name">
        <label>Routing number</label>
        <input type="text" placeholder="021000021" maxlength="9" id="ach-routing" value="021000021">
        <label>Account number</label>
        <input type="text" placeholder="123456789" maxlength="17" id="ach-account" value="123456789">
      </div>

      <button class="pay-btn" id="pay-btn" onclick="handlePay()">Pay $${dollars}</button>
      <div class="secure">&#128274; Secured by SportPassNIL</div>
    </div>

    <div id="success-view" class="hidden">
      <div class="success">
        <div class="check">
          <svg fill="none" stroke="#fff" stroke-width="3" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h2>Payment successful</h2>
        <p>You can close this window.</p>
      </div>
    </div>
  </div>

  <script>
    function switchTab(type) {
      const cardForm = document.getElementById('card-form');
      const achForm = document.getElementById('ach-form');
      const tabCard = document.getElementById('tab-card');
      const tabAch = document.getElementById('tab-ach');
      if (type === 'card') {
        cardForm.classList.remove('hidden');
        achForm.classList.add('hidden');
        tabCard.classList.add('active');
        tabAch.classList.remove('active');
      } else {
        cardForm.classList.add('hidden');
        achForm.classList.remove('hidden');
        tabCard.classList.remove('active');
        tabAch.classList.add('active');
      }
    }

    async function handlePay() {
      const btn = document.getElementById('pay-btn');
      btn.disabled = true;
      btn.textContent = 'Processing\\u2026';

      try {
        const res = await fetch('${baseUrl}/v1/checkout-sessions/${sessionId}/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) throw new Error('Payment failed');

        const data = await res.json();

        // Notify parent first — it will navigate away
        if (window.parent !== window) {
          window.parent.postMessage({
            type: 'spn:checkout:complete',
            session_id: '${sessionId}',
            charge_id: data.charge_id,
            status: 'completed',
          }, '*');
        }

        // Fallback for standalone (no parent frame)
        document.getElementById('form-view').classList.add('hidden');
        document.getElementById('success-view').classList.remove('hidden');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Pay $${dollars}';
        alert('Payment failed. Please try again.');
      }
    }
  </script>
</body>
</html>`;
}