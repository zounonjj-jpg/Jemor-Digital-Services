import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const countryCodes: Record<string, string> = {
  "BENIN": "BJ", "BÉNIN": "BJ", "TOGO": "TG", "COTE D'IVOIRE": "CI", "CÔTE D’IVOIRE": "CI",
  "SENEGAL": "SN", "SÉNÉGAL": "SN", "BURKINA FASO": "BF", "CAMEROON": "CM", "CAMEROUN": "CM",
  "GHANA": "GH", "GUINEA": "GN", "GUINÉE": "GN", "MALI": "ML", "NIGER": "NE", "NIGERIA": "NG",
  "KENYA": "KE", "TANZANIA": "TZ", "TANZANIE": "TZ", "UGANDA": "UG", "RWANDA": "RW",
  "DR CONGO": "CD", "CONGO": "CD", "MALAWI": "MW", "ZAMBIA": "ZM"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const saspayKey = Deno.env.get("SASPAY_API_KEY");
    const checkoutEnabled = Deno.env.get("SASPAY_CHECKOUT_ENABLED") === "true";
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase function environment is incomplete");
    if (!checkoutEnabled) return json({ error: "Les paiements SasPay sont volontairement désactivés en attendant les tests Sandbox et la validation du compte marchand." }, 503);
    if (!saspayKey) return json({ error: "La clé API SasPay n'est pas configurée sur le serveur. Aucun paiement n'a été créé." }, 503);

    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
    const user = authData.user;
    if (!user.email) return json({ error: "Une adresse e-mail vérifiée est nécessaire pour créer le paiement." }, 400);

    const body = await req.json().catch(() => ({}));
    const listingId = body?.listing_id;
    if (typeof listingId !== "string" || !/^[0-9a-f-]{36}$/i.test(listingId)) {
      return json({ error: "listing_id invalide" }, 400);
    }

    const { data: listing, error: listingError } = await admin
      .from("listings")
      .select("id,title,description,price_xof,seller_id,status")
      .eq("id", listingId)
      .eq("status", "approved")
      .maybeSingle();
    if (listingError || !listing) return json({ error: "Ce produit n'est pas disponible." }, 404);
    if (listing.seller_id === user.id) return json({ error: "Tu ne peux pas acheter ton propre produit." }, 403);
    if (!Number.isInteger(listing.price_xof) || listing.price_xof <= 0) return json({ error: "Ce produit n'est pas payant." }, 400);

    const { data: orderId, error: orderError } = await userClient.rpc("create_savoir_order", { p_listing_id: listingId });
    if (orderError || typeof orderId !== "string") {
      return json({ error: orderError?.message ?? "Impossible de préparer la commande." }, 400);
    }

    const { data: order, error: orderReadError } = await admin
      .from("orders").select("id,buyer_id,subtotal_xof,status,source_listing_id")
      .eq("id", orderId).maybeSingle();
    if (orderReadError || !order || order.buyer_id !== user.id || order.status !== "pending") {
      return json({ error: "La commande n'est plus en attente." }, 409);
    }

    const { data: item, error: itemError } = await admin
      .from("order_items").select("id,listing_id,seller_id,title_snapshot,unit_price_xof,platform_fee_xof,teacher_amount_xof")
      .eq("order_id", orderId).maybeSingle();
    if (itemError || !item || item.listing_id !== listingId || item.unit_price_xof !== order.subtotal_xof) {
      return json({ error: "Impossible de vérifier le contenu de la commande." }, 409);
    }

    // Claim exactly one pending SasPay payment attempt. Hosted checkout sessions do not support Idempotency-Key.
    const { data: claimRows, error: claimError } = await admin.rpc("claim_savoir_payment_attempt", { p_order_id: orderId });
    if (claimError || !Array.isArray(claimRows) || !claimRows[0]?.payment_id) {
      return json({ error: claimError?.message ?? "Impossible de réserver une tentative de paiement." }, 409);
    }
    const claim = claimRows[0];
    const paymentId = claim.payment_id;

    const { data: payment, error: paymentReadError } = await admin
      .from("payments")
      .select("id,status,provider_payload")
      .eq("id", paymentId)
      .eq("order_id", orderId)
      .maybeSingle();
    if (paymentReadError || !payment) return json({ error: "Tentative de paiement introuvable." }, 500);

    const saspayState = payment.provider_payload?.saspay ?? {};
    if (!claim.claimed) {
      if (payment.status === "pending" && saspayState.initiation_status === "created" && typeof saspayState.checkout_url === "string") {
        return json({ order_id: orderId, payment_id: paymentId, checkout_url: saspayState.checkout_url, reused: true });
      }
      return json({
        error: "Une tentative de paiement est déjà en préparation ou nécessite une vérification. Pour éviter un double paiement, aucune nouvelle session n'a été créée. Réessaie après vérification du statut."
      }, 409);
    }

    const { data: profile } = await admin
      .from("profiles").select("display_name,country").eq("id", user.id).maybeSingle();
    const customerName = (profile?.display_name || user.user_metadata?.display_name || user.email.split("@")[0] || "Client SAVOIR+").trim();
    const normalizedCountry = String(profile?.country || "").trim().toUpperCase();
    const country = countryCodes[normalizedCountry] || (normalizedCountry.length === 2 ? normalizedCountry : undefined);

    const payload = {
      amount: `${order.subtotal_xof.toFixed(2)}`,
      currency: "XOF",
      ...(country ? { country } : {}),
      customer_name: customerName,
      customer_email: user.email,
      description: `SAVOIR+ — ${item.title_snapshot}`,
      return_url: `https://savoir-plus-app.vercel.app/paiement/retour?order_id=${encodeURIComponent(orderId)}`,
      metadata: {
        savoir_order_id: orderId,
        savoir_payment_id: paymentId,
        savoir_listing_id: listingId,
        savoir_buyer_id: user.id
      }
    };

    let providerResponse: Response;
    try {
      providerResponse = await fetch("https://api.saspay.me/api/v1/checkout-sessions/", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${saspayKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      await admin.from("payments").update({
        provider_payload: {
          saspay: {
            initiation_status: "unknown",
            error: error instanceof Error ? error.message : "Network timeout",
            order_id: orderId,
            attempted_at: new Date().toISOString()
          }
        }
      }).eq("id", paymentId).eq("status", "pending");
      return json({ error: "La réponse de SasPay est incertaine. Pour éviter de créer deux sessions ou deux paiements, la tentative est bloquée en vérification manuelle." }, 503);
    }

    const responseText = await providerResponse.text();
    let result: any;
    try { result = JSON.parse(responseText); } catch { result = null; }

    if (!providerResponse.ok || !result?.success) {
      const message = result?.error?.message || result?.detail || `SasPay a répondu avec le code ${providerResponse.status}`;
      if (providerResponse.status >= 500) {
        await admin.from("payments").update({
          provider_payload: { saspay: { initiation_status: "unknown", http_status: providerResponse.status, error: message, attempted_at: new Date().toISOString() } }
        }).eq("id", paymentId).eq("status", "pending");
        return json({ error: "Réponse SasPay incertaine. La tentative est bloquée pour empêcher un double paiement." }, 503);
      }
      await admin.from("payments").update({
        status: "failed",
        provider_payload: { saspay: { initiation_status: "rejected", http_status: providerResponse.status, error: message, rejected_at: new Date().toISOString() } }
      }).eq("id", paymentId).eq("status", "pending");
      return json({ error: message }, 400);
    }

    const sessionId = result?.data?.id;
    const checkoutUrl = result?.data?.checkout_url;
    if (typeof sessionId !== "string" || typeof checkoutUrl !== "string" || !checkoutUrl.startsWith("https://")) {
      await admin.from("payments").update({
        provider_payload: {
          saspay: {
            initiation_status: "unknown",
            error: "SasPay did not return a valid session id and HTTPS checkout URL",
            response: result,
            attempted_at: new Date().toISOString()
          }
        }
      }).eq("id", paymentId).eq("status", "pending");
      return json({ error: "SasPay n'a pas retourné un lien de paiement exploitable. La tentative est bloquée pour vérification." }, 502);
    }

    const { error: saveError } = await admin.from("payments").update({
      provider_payload: {
        saspay: {
          initiation_status: "created",
          checkout_session_id: sessionId,
          checkout_url: checkoutUrl,
          session_status: result?.data?.status ?? "PENDING",
          created_at: new Date().toISOString()
        }
      }
    }).eq("id", paymentId).eq("status", "pending");

    if (saveError) {
      // Never retry session creation: SasPay does not support Idempotency-Key for this endpoint.
      return json({ error: "La session a été créée chez SasPay mais son enregistrement local a échoué. Ne relance pas le paiement ; une vérification administrative est nécessaire." }, 503);
    }

    return json({ order_id: orderId, payment_id: paymentId, checkout_url: checkoutUrl });
  } catch (error) {
    console.error("savoir-create-checkout", error);
    return json({ error: "Erreur serveur pendant la préparation du paiement." }, 500);
  }
});