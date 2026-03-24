import db from "../db.js";

/** Returns the HTML for the checkout iframe. */
export function renderCheckoutPage(sessionId: string, baseUrl: string): string | null {
  const session = db.prepare("SELECT * FROM checkout_sessions WHERE id = ?").get(sessionId) as
    | Record<string, unknown>
    | undefined;

  if (!session || session.status !== "pending") return null;

  const dollars = ((session.amount_cents as number) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #fafafa;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      color: #18181b;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      background: #fff;
      border-radius: 16px;
      box-shadow:
        0 1px 3px rgba(0,0,0,0.04),
        0 8px 32px rgba(0,0,0,0.06);
      padding: 40px;
      width: 100%;
      max-width: 432px;
    }

    .header {
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid #f4f4f5;
    }
    .header svg {
      display: block;
      margin-bottom: 16px;
    }

    .amount {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .amount small {
      font-size: 13px;
      color: #a1a1aa;
      font-weight: 400;
      margin-left: 4px;
    }

    .field-group { margin-bottom: 20px; }

    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #71717a;
      margin-bottom: 6px;
      letter-spacing: 0.01em;
    }

    input {
      width: 100%;
      padding: 11px 14px;
      border: 1px solid #e4e4e7;
      border-radius: 10px;
      font-family: inherit;
      font-size: 14px;
      color: #18181b;
      background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input::placeholder { color: #d4d4d8; }
    input:focus {
      outline: none;
      border-color: #a1a1aa;
      box-shadow: 0 0 0 3px rgba(161,161,170,0.12);
    }

    .row { display: flex; gap: 12px; }
    .row > .field-group { flex: 1; margin-bottom: 20px; }

    .tabs {
      display: flex;
      gap: 0;
      margin-bottom: 28px;
      background: #f4f4f5;
      border-radius: 10px;
      padding: 3px;
    }
    .tab {
      flex: 1;
      padding: 9px 12px;
      text-align: center;
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      background: transparent;
      color: #71717a;
      border: none;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .tab.active {
      background: #fff;
      color: #18181b;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    .pay-btn {
      width: 100%;
      padding: 13px 16px;
      background: #18181b;
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      margin-top: 4px;
      transition: background 0.15s, transform 0.1s;
      letter-spacing: -0.01em;
    }
    .pay-btn:hover { background: #27272a; }
    .pay-btn:active { transform: scale(0.995); }
    .pay-btn:disabled { background: #d4d4d8; cursor: not-allowed; }

    .secure {
      text-align: center;
      font-size: 11px;
      color: #a1a1aa;
      margin-top: 20px;
      letter-spacing: 0.02em;
    }

    .success {
      text-align: center;
      padding: 48px 0 16px;
    }
    .success .check {
      width: 56px;
      height: 56px;
      background: #10b981;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .success .check svg { width: 28px; height: 28px; }
    .success h2 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    .success p { color: #71717a; font-size: 14px; }

    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div id="form-view">
      <div class="header">
        <svg width="120" height="17" viewBox="0 0 512 73" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#spn)"><mask id="m" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="73"><path d="M512 0H0V72.8073H512V0Z" fill="white"/></mask><g mask="url(#m)"><path d="M82.4814 40.5497H93.9115C94.1259 45.173 95.8996 48.2309 102.499 48.2309C108.391 48.2309 109.812 45.8137 109.812 43.6805C109.812 34.2956 83.2628 41.904 83.2628 24.3393C83.2628 17.3716 87.4497 10.5459 101.863 10.5459C116.277 10.5459 120.25 17.3716 120.464 26.6144H109.107C108.892 22.7739 107.759 19.6468 101.369 19.6468C96.045 19.6468 94.6966 21.7801 94.6966 23.6986C94.6966 32.0167 120.962 25.0491 120.962 43.0397C120.962 49.5816 117.484 57.3318 101.867 57.3318C87.7405 57.3318 82.4887 51.0049 82.4887 40.5497H82.4814Z" fill="#737373"/><path d="M123.866 20.4263H128.834L131.531 26.0435C133.377 22.9855 137.564 19.7856 144.52 19.7856C156.517 19.7856 160.278 29.3126 160.278 38.5591C160.278 47.8056 156.942 57.3323 145.727 57.3323C140.119 57.3323 136.568 55.3412 134.867 53.1386V70.9147H123.862V20.4263H123.866ZM141.9 48.1586C147.933 48.1586 148.928 44.1761 148.928 38.5591C148.928 32.9419 147.936 28.8903 141.972 28.8903C136.008 28.8903 134.802 32.8 134.802 38.5591C134.802 44.3181 135.583 48.1586 141.9 48.1586Z" fill="#737373"/><path d="M163.692 38.4896C163.692 29.0319 167.526 19.7891 181.863 19.7891C196.201 19.7891 200.035 29.0319 200.035 38.4896C200.035 47.9472 196.132 57.3321 181.791 57.3321C167.45 57.3321 163.688 47.8744 163.688 38.4896H163.692ZM181.791 48.0165C187.54 48.0165 189.386 44.3179 189.386 38.4896C189.386 32.6614 187.755 29.0319 181.863 29.0319C175.972 29.0319 174.409 32.7305 174.409 38.4896C174.409 44.2486 176.256 48.0165 181.791 48.0165Z" fill="#737373"/><path d="M203.372 20.4256H208.412L210.684 25.6169C212.955 21.9182 216.433 19.0023 224.029 19.8577V29.5266C215.725 28.6748 214.445 33.1524 214.445 39.2682V56.6873H203.372V20.4256Z" fill="#737373"/><path d="M231.245 44.9586V29.3161H225.564V23.273L231.245 20.4299V11.187H241.962V20.4299H251.474V29.3196H242.246V43.8266C242.246 46.6006 243.169 48.8757 251.474 48.0203V56.9791C235.149 58.0459 231.241 54.8459 231.241 44.9624L231.245 44.9586Z" fill="#737373"/><path d="M257.343 11.1836H274.026C291.772 11.1836 293.261 20.4993 293.261 26.757C293.261 33.0149 292.338 42.1159 274.592 42.1159H267.421V56.6919H257.339V11.1836H257.343ZM274.453 34.0815C281.908 34.0815 282.972 30.0298 282.972 26.8991C282.972 23.7684 281.908 19.5746 274.453 19.5746H267.424V34.0815H274.453Z" fill="#272B28"/><path d="M295.105 45.8835C295.105 38.9851 299.647 36 310.295 35.0753L319.948 34.2235C319.875 29.3163 318.034 27.2558 312.637 27.2558C307.24 27.2558 305.965 29.6037 305.965 33.1567L296.312 33.2295C296.312 25.7633 299.365 19.7202 312.426 19.7202C327.544 19.7202 329.674 26.404 329.674 36.0728V56.6918H325.557L323.354 50.86C321.224 54.2018 316.966 57.2597 309.584 57.2597C301.49 57.2597 295.1 53.703 295.1 45.8835H295.105ZM311.932 49.6514C318.534 49.6514 319.883 45.5267 319.953 40.7616L311.789 41.6862C306.749 42.2541 305.26 43.4627 305.26 45.3848C305.26 47.8749 307.174 49.6514 311.932 49.6514Z" fill="#272B28"/><path d="M334.082 43.8925H343.667C343.667 47.6602 346.577 49.7244 351.76 49.7244C356.234 49.7244 358.717 48.1591 358.717 46.0258C358.717 39.3421 334.864 44.1072 334.864 31.2349C334.864 23.6265 340.614 19.7168 351.049 19.7168C361.481 19.7168 367.231 24.1254 367.231 32.5856H358.146C357.721 28.6758 355.943 27.1105 350.765 27.1105C345.865 27.1105 344.374 28.887 344.374 30.7363C344.374 37.136 368.297 31.8028 368.297 45.5962C368.297 52.5639 361.766 57.2562 351.972 57.2562C340.045 57.2562 334.082 52.8479 334.082 43.8888V43.8925Z" fill="#272B28"/><path d="M371.228 43.8925H380.813C380.813 47.6602 383.725 49.7244 388.906 49.7244C393.381 49.7244 395.863 48.1591 395.863 46.0258C395.863 39.3421 372.01 44.1072 372.01 31.2349C372.01 23.6265 377.76 19.7168 388.195 19.7168C398.63 19.7168 404.379 24.1254 404.379 32.5856H395.292C394.867 28.6758 393.089 27.1105 387.911 27.1105C383.011 27.1105 381.522 28.887 381.522 30.7363C381.522 37.136 405.443 31.8028 405.443 45.5962C405.443 52.5639 398.912 57.2562 389.118 57.2562C377.194 57.2562 371.228 52.8479 371.228 43.8888V43.8925Z" fill="#272B28"/><path d="M425.106 11.1836H432.203L460.173 49.9354V11.1836H465.711V56.6919H458.898L430.644 17.5142V56.6919H425.106V11.1836Z" fill="#272B28"/><path d="M473.816 11.1836H479.354V56.6919H473.816V11.1836Z" fill="#272B28"/><path d="M487.368 11.1836H492.906V52.1414H512V56.6919H487.368V11.1836Z" fill="#272B28"/><path d="M31.3464 16.8149L63.1869 32.7633V4.87081C63.1904 2.18058 61.0097 0 58.3241 0H4.86276C2.17698 0 0 2.18058 0 4.87081V32.5158L31.3464 16.8149Z" fill="#737373"/><path d="M31.3464 31.5518L0 47.249V47.6058C0 52.8261 2.78028 57.6494 7.29415 60.2632L26.7306 71.5047C29.7399 73.2448 33.447 73.2448 36.4563 71.5047L55.8928 60.2632C60.4066 57.6532 63.1869 52.8296 63.1869 47.6058V47.4966L31.3464 31.5518Z" fill="#737373"/></g></g><defs><clipPath id="spn"><rect width="512" height="72.8073" fill="white"/></clipPath></defs></svg>
        <div class="amount">$${dollars}<small>${currency}</small></div>
      </div>

      ${showTabs ? `
      <div class="tabs">
        <button class="tab active" id="tab-card" onclick="switchTab('card')">Card</button>
        <button class="tab" id="tab-ach" onclick="switchTab('ach')">Bank account</button>
      </div>
      ` : ""}

      <div id="card-form" class="${showCard ? "" : "hidden"}">
        <div class="field-group">
          <label>Card number</label>
          <input type="text" placeholder="4242 4242 4242 4242" maxlength="19" id="card-number" value="4242 4242 4242 4242">
        </div>
        <div class="row">
          <div class="field-group">
            <label>Expiry</label>
            <input type="text" placeholder="MM / YY" maxlength="5" value="12/28" id="card-exp">
          </div>
          <div class="field-group">
            <label>CVC</label>
            <input type="text" placeholder="123" maxlength="4" value="123" id="card-cvc">
          </div>
        </div>
        <div class="field-group">
          <label>Name on card</label>
          <input type="text" placeholder="Full name" id="card-name">
        </div>
      </div>

      <div id="ach-form" class="${showAch && !showCard ? "" : "hidden"}">
        <div class="field-group">
          <label>Account holder name</label>
          <input type="text" placeholder="Full name" id="ach-name">
        </div>
        <div class="field-group">
          <label>Routing number</label>
          <input type="text" placeholder="021000021" maxlength="9" id="ach-routing" value="021000021">
        </div>
        <div class="field-group">
          <label>Account number</label>
          <input type="text" placeholder="Account number" maxlength="17" id="ach-account" value="123456789">
        </div>
      </div>

      <button class="pay-btn" id="pay-btn" onclick="handlePay()">Pay $${dollars}</button>
      <div class="secure">\u{1F512} Secured by SportPassNIL</div>
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
      var cardForm = document.getElementById('card-form');
      var achForm = document.getElementById('ach-form');
      var tabCard = document.getElementById('tab-card');
      var tabAch = document.getElementById('tab-ach');
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
      var btn = document.getElementById('pay-btn');
      btn.disabled = true;
      btn.textContent = 'Processing\\u2026';

      try {
        var cardForm = document.getElementById('card-form');
        var isCard = cardForm && !cardForm.classList.contains('hidden');
        var paymentDetails = {};
        if (isCard) {
          paymentDetails = {
            method: 'card',
            cardNumber: (document.getElementById('card-number') || {}).value || '',
            expiry: (document.getElementById('card-exp') || {}).value || '',
            cvc: (document.getElementById('card-cvc') || {}).value || '',
            cardName: (document.getElementById('card-name') || {}).value || '',
          };
        } else {
          paymentDetails = {
            method: 'ach',
            accountHolder: (document.getElementById('ach-name') || {}).value || '',
            routing: (document.getElementById('ach-routing') || {}).value || '',
            accountNumber: (document.getElementById('ach-account') || {}).value || '',
          };
        }

        var res = await fetch('${baseUrl}/v1/checkout-sessions/${sessionId}/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentDetails }),
        });

        if (!res.ok) throw new Error('Payment failed');

        var data = await res.json();

        if (window.parent !== window) {
          window.parent.postMessage({
            type: 'spn:checkout:complete',
            session_id: '${sessionId}',
            charge_id: data.charge_id,
            status: 'completed',
          }, '*');
        } else {
          document.getElementById('form-view').classList.add('hidden');
          document.getElementById('success-view').classList.remove('hidden');
        }
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