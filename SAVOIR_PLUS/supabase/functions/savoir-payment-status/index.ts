import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
});
function integerXof(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("SASPAY_API_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase environment is incomplete");
    if (!apiKey) return json({ error: "SasPay n'est pas encore configuré sur le serveur." }, 503);

    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id;
    if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "order_id invalide" }, 400);

    const { data: order, error: orderError } = await admin.from("orders")
      .select("id,buyer_id,status,subtotal_xof").eq("id", orderId).maybeSingle();
    if (orderError || !order) return json({ error: "Commande introuvable." }, 404);
    if (order.buyer_id !== authData.user.id) return json({ error: "Accès refusé." }, 403);
    if (order.status === "paid") return json({ status: "paid", order_id: orderId });

    const { data: payment, error: paymentError } = await admin.from("payments")
      .select("id,amount_xof,status,provider_payload,provider_reference")
      .eq("order_id", orderId).eq("provider", "saspay")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return json({ status: "not_started", order_id: orderId });
    if (payment.status === "succeeded") return json({ status: "paid", order_id: orderId });
    if (payment.status === "failed") return json({ status: "failed", order_id: orderId });

    const sessionId = payment.provider_payload?.saspay?.checkout_session_id;
    if (typeof sessionId !== "string") {
      return json({ status: "checking", order_id: orderId, message: "La session SasPay nécessite une vérification administrative." });
    }

    const sessionResponse = await fetch(
      `https://api.saspay.me/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/status/`,
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(12000) }
    );
    const sessionText = await sessionResponse.text();
    let sessionResult: any;
    try { sessionResult = JSON.parse(sessionText); } catch { sessionResult = null; }
    if (!sessionResponse.ok || !sessionResult?.success || !sessionResult?.data) {
      return json({ status: "checking", order_id: orderId, message: "SasPay n'a pas encore fourni un statut vérifiable." }, 202);
    }

    const sessionStatus = String(sessionResult.data.status || "").toUpperCase();
    const transactionStatus = String(sessionResult.data.transaction_status || "").toUpperCase();
    const transactionId = sessionResult.data.transaction_id;

    if (sessionStatus === "EXPIRED" || sessionStatus === "CANCELLED" || transactionStatus === "FAILED" || transactionStatus === "CANCELLED") {
      const mergedPayload = {
        ...(payment.provider_payload || {}),
        saspay: { ...(payment.provider_payload?.saspay || {}), session_status: sessionStatus, transaction_status: transactionStatus, checked_at: new Date().toISOString() }
      };
      await admin.from("payments").update({ status: "failed", provider_payload: mergedPayload, updated_at: new Date().toISOString() })
        .eq("id", payment.id).eq("status", "pending");
      return json({ status: "failed", order_id: orderId });
    }

    if (sessionStatus !== "PAID" || transactionStatus !== "SUCCESS" || typeof transactionId !== "string") {
      return json({ status: "pending", order_id: orderId });
    }

    const verifyResponse = await fetch(
      `https://api.saspay.me/api/v1/payments/${encodeURIComponent(transactionId)}/verify/`,
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(12000) }
    );
    const verifyText = await verifyResponse.text();
    let verifyResult: any;
    try { verifyResult = JSON.parse(verifyText); } catch { verifyResult = null; }
    if (!verifyResponse.ok || !verifyResult?.success || verifyResult?.data?.status !== "SUCCESS") {
      return json({ status: "checking", order_id: orderId, message: "Le statut final du paiement est encore en cours de vérification." }, 202);
    }

    const verified = verifyResult.data;
    const requested = integerXof(verified.requested_amount ?? verified.amounts?.requested);
    if (requested === null || requested !== payment.amount_xof || requested !== order.subtotal_xof || verified.currency !== "XOF") {
      console.error("SasPay status check amount mismatch", transactionId, requested, payment.amount_xof, order.subtotal_xof);
      return json({ status: "checking", order_id: orderId, message: "Le montant reçu nécessite une vérification administrative." }, 409);
    }
    const metadataPaymentId = verified.metadata?.savoir_payment_id;
    if (metadataPaymentId && metadataPaymentId !== payment.id) {
      return json({ status: "checking", order_id: orderId, message: "La référence de paiement ne correspond pas à cette commande." }, 409);
    }

    const { error: confirmError } = await admin.rpc("confirm_savoir_payment", {
      p_payment_id: payment.id,
      p_provider_reference: transactionId,
      p_event_id: `status-poll:${transactionId}`,
      p_amount_xof: requested,
      p_event_payload: { saspay_session_status: sessionResult.data, saspay_verification: verified, verified_at: new Date().toISOString() }
    });
    if (confirmError) {
      console.error("SAVOIR+ poll confirmation failed", confirmError.message);
      return json({ status: "checking", order_id: orderId, message: "La confirmation est en attente de finalisation." }, 202);
    }
    return json({ status: "paid", order_id: orderId });
  } catch (error) {
    console.error("savoir-payment-status", error);
    return json({ error: "Impossible de vérifier le paiement pour le moment." }, 503);
  }
});