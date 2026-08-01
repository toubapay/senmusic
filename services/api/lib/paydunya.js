/**
 * PayDunya client — checkout invoices for subscriptions.
 *
 * Env vars (Secret Manager):
 *   PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN
 *   PAYDUNYA_MODE = "live" | "test"
 *   APP_BASE_URL  = https://app.yourdomain.sn   (return/cancel pages)
 *   API_BASE_URL  = https://api.yourdomain.sn   (IPN callback)
 */

const BASE =
  process.env.PAYDUNYA_MODE === "live"
    ? "https://app.paydunya.com/api/v1"
    : "https://app.paydunya.com/sandbox-api/v1";

const headers = () => ({
  "Content-Type": "application/json",
  "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY,
  "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY,
  "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN,
});

/**
 * Creates a checkout invoice. Returns { token, checkoutUrl }.
 * `custom_data` round-trips through the IPN, which is how we link
 * the payment back to our own IDs without parsing descriptions.
 */
export async function createInvoice({ amountXof, description, paymentId, userId, planCode }) {
  const res = await fetch(`${BASE}/checkout-invoice/create`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      invoice: {
        total_amount: amountXof,
        description,
      },
      store: { name: "ProMusic" },
      custom_data: { payment_id: paymentId, user_id: userId, plan_code: planCode },
      actions: {
        callback_url: `${process.env.API_BASE_URL}/v1/webhooks/paydunya`,
        // /app prefix: web/player is served at that path on the
        // consolidated Cloud Run service, not APP_BASE_URL's root.
        return_url: `${process.env.APP_BASE_URL}/app/subscribe/success`,
        cancel_url: `${process.env.APP_BASE_URL}/app/subscribe/cancelled`,
      },
    }),
  });

  const data = await res.json();
  if (data.response_code !== "00") {
    throw new Error(`paydunya_create_failed: ${data.response_text ?? res.status}`);
  }
  return { token: data.token, checkoutUrl: data.response_text };
}

/**
 * Server-side confirmation. NEVER trust the IPN body alone —
 * always re-fetch the invoice status from PayDunya before granting access.
 */
export async function confirmInvoice(token) {
  const res = await fetch(`${BASE}/checkout-invoice/confirm/${token}`, {
    headers: headers(),
  });
  const data = await res.json();

  return {
    completed: data.response_code === "00" && data.status === "completed",
    status: data.status,
    amountXof: Number(data.invoice?.total_amount ?? 0),
    customData: data.custom_data ?? {},
    channel: normalizeChannel(data.customer?.payment_method ?? data.mode),
    raw: data,
  };
}

function normalizeChannel(method = "") {
  const m = method.toLowerCase();
  if (m.includes("wave")) return "wave";
  if (m.includes("orange")) return "orange_money";
  if (m.includes("free")) return "free_money";
  if (m.includes("card") || m.includes("carte")) return "card";
  return m || "unknown";
}
