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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!serviceKey || !anonKey || !url) throw new Error("Supabase function environment is incomplete");

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await authClient.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => ({}));
    const listingId = body?.listing_id;
    if (typeof listingId !== "string") return json({ error: "listing_id is required" }, 400);
    const user = auth.user;

    const { data: listing, error: listingError } = await admin
      .from("listings").select("id,seller_id,status").eq("id", listingId).maybeSingle();
    if (listingError || !listing || listing.status !== "approved") return json({ error: "Resource unavailable" }, 404);

    let allowed = listing.seller_id === user.id || user.app_metadata?.role === "savoir_admin" || user.app_metadata?.is_platform_owner === true;
    if (!allowed) {
      const { data: enrollment, error } = await admin.from("enrollments")
        .select("id").eq("listing_id", listingId).eq("learner_id", user.id)
        .in("status", ["active", "completed"]).maybeSingle();
      if (error) throw error;
      allowed = Boolean(enrollment);
    }

    if (!allowed) return json({ error: "An active purchase or enrolment is required" }, 403);

    const { data: files, error: filesError } = await admin.from("product_files")
      .select("storage_path,original_name,mime_type,file_size_bytes")
      .eq("listing_id", listingId).order("created_at", { ascending: true });
    if (filesError) throw filesError;
    if (!files?.length) return json({ error: "No downloadable file found" }, 404);

    const signedFiles = await Promise.all(files.map(async (file: {storage_path:string;original_name:string;mime_type:string;file_size_bytes:number}) => {
      const { data: signed, error: signError } = await admin.storage.from("savoir-products")
        .createSignedUrl(file.storage_path, 300, { download: file.original_name });
      if (signError || !signed?.signedUrl) throw signError ?? new Error("Unable to create a signed URL");
      return { filename: file.original_name, mime_type: file.mime_type, size_bytes: file.file_size_bytes, url: signed.signedUrl };
    }));

    return json({ files: signedFiles, expires_in: 300 });
  } catch (error) {
    console.error("savoir-product-download", error);
    return json({ error: "Unable to create secure download links" }, 500);
  }
});