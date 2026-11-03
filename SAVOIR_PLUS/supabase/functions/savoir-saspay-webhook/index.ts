import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function safeHexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  const aa = encoder.encode(a.toLowerCase());
  const bb = encoder.encode(b.toLowerCase());
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function validSignature(rawBody: string, signature: string, timestamp: string, secret: string): Promise<boolean> {
  const seconds = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(seconds) || Math.abs(now - seconds) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return safeHexEqual(signature, toHex(mac));
}
function integerXof(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function errorEnvelope(body: any): string {
  return body?.error?.message || body?.detail || "SasPay verification failed";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("SASPAY_API_KEY");
    const webhookSecret = Deno.env.get("SASPAY_WEBHOOK_SECRET");
    if (!url || !serviceKey) throw new Error("Supabase service environment is incomplete");
    if (!apiKey || !webhookSecret) return json({ error: "SasPay webhook secrets are not configured" }, 503);

    const rawBody = await req.text();
    const signature = req.headers.get("X-Webhook-Signature") ?? "";
    const timestamp = req.headers.get("X-Webhook-Timestamp") ?? "";
    if (!await validSignature(rawBody, signature, timestamp, webhookSecret)) {
      return json({ error: "Invalid webhook signature or expired timestamp" }, 403);
    }

    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const event = payload?.event;
    const transactionId = payload?.data?.id;
    if (event === "webhook.test") return json({ received: true });
    if (typeof event !== "string" || typeof transactionId !== "string") {
      return json({ error: "Missing event or transaction id" }, 400);
    }
    if (!["transaction.success", "transaction.failed", "transaction.cancelled"].includes(event)) {
      return json({ received: true, ignored: true });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const verifyResponse = await fetch(`https://api.saspay.me/api/v1/payments/${encodeURIComponent(transactionId)}/verify/`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    const verifyText = await verifyResponse.text();
    let verification: any;
    try { verification = JSON.parse(verifyText); } catch { verification = null; }
    if (!verifyResponse.ok || !verification?.success || !verification?.data) {
      console.error("SasPay verification rejected", verifyResponse.status, errorEnvelope(verification));
      return json({ error: "Payment verification is temporarily unavailable; SasPay should retry the webhook." }, 503);
    }
    const verified = verification.data;

    let localPaymentId = verified?.metadata?.savoir_payment_id;
    let payment: any = null;
    if (typeof localPaymentId === "string" && /^[0-9a-f-]{36}$/i.test(localPaymentId)) {
      const { data } = await admin.from("payments")
        .select("id,order_id,buyer_id,amount_xof,status,provider_payload,provider_reference")
        .eq("provider", "saspay").eq("id", localPaymentId).maybeSingle();
      payment = data;
    }
    if (!payment && typeof verified?.checkout_session === "string") {
      const { data, error } = await admin.from("payments")
        .select("id,order_id,buyer_id,amount_xof,status,provider_payload,provider_reference")
        .eq("provider", "saspay")
        .filter("provider_payload->saspay->>checkout_session_id", "eq", verified.checkout_session)
        .maybeSingle();
      if (error) throw error;
      payment = data;
    }

    if (!payment) {
      console.error("SasPay webhook could not be linked to a SAVOIR+ payment", transactionId);
      return json({ error: "Payment is not yet linked to an order; retry requested." }, 503);
    }
    if (payment.status === "succeeded") return json({ received: true, already_processed: true });
    if (payment.status !== "pending") return json({ received: true, ignored: true });

    const requestedAmount = integerXof(verified?.requested_amount ?? verified?.amounts?.requested);
    if (requestedAmount === null || requestedAmount !== payment.amount_xof || verified?.currency !== "XOF") {
      console.error("SasPay amount/currency mismatch", transactionId, requestedAmount, payment.amount_xof, verified?.currency);
      return json({ error: "Verified amount or currency does not match the SAVOIR+ order." }, 409);
    }

    const eventKey = `${event}:${transactionId}`;
    if (event === "transaction.success") {
      if (verified.status !== "SUCCESS") {
        return json({ error: "Gateway has not confirmed SUCCESS yet; retry requested." }, 503);
      }
      const { error } = await admin.rpc("confirm_savoir_payment", {
        p_payment_id: payment.id,
        p_provider_reference: transactionId,
        p_event_id: eventKey,
        p_amount_xof: requestedAmount,
        p_event_payload: {
          saspay_webhook: payload,
          saspay_verification: verified,
          verified_at: new Date().toISOString()
        }
      });
      if (error) {
        console.error("SAVOIR+ payment confirmation failed", error.message);
        return json({ error: "Payment confirmation failed; retry requested." }, 503);
      }
      return json({ received: true, paid: true });
    }

    if (!["FAILED", "CANCELLED"].includes(String(verified.status))) {
      return json({ error: "Gateway has not confirmed a final failed/cancelled state; retry requested." }, 503);
    }

    const { error: eventError } = await admin.from("payment_webhook_events").insert({
      provider: "saspay",
      event_id: eventKey,
      payment_id: payment.id,
      payload: { saspay_webhook: payload, saspay_verification: verified }
    });
    if (eventError && eventError.code !== "23505") throw eventError;
    {
      const mergedPayload = {
        ...(payment.provider_payload || {}),
        saspay: {
          ...(payment.provider_payload?.saspay || {}),
          last_event: event,
          final_status: verified.status,
          transaction_id: transactionId,
          verified_at: new Date().toISOString()
        }
      };
      const { error } = await admin.from("payments")
        .update({ status: "failed", provider_reference: transactionId, provider_payload: mergedPayload, updated_at: new Date().toISOString() })
        .eq("id", payment.id).eq("status", "pending");
      if (error) throw error;
    }
    return json({ received: true, failed: true });
  } catch (error) {
    console.error("savoir-saspay-webhook", error);
    return json({ error: "Internal webhook processing error; retry requested." }, 503);
  }
});