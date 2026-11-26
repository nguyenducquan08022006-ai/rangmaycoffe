import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

export function corsHeaders(
  origin: string | null,
  methods = "POST, OPTIONS"
): Record<string, string> | null {
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin"
  };
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  cors: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function isValidVietnamesePhone(value: string): boolean {
  return /^(?:0|\+84)\d{9,10}$/.test(value);
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) throw new Error("Nội dung gửi lên quá lớn.");
  if (!request.body) throw new Error("Thiếu nội dung yêu cầu.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 16_384) {
      await reader.cancel();
      throw new Error("Nội dung gửi lên quá lớn.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  return realIp && realIp.trim() ? realIp.trim() : null;
}

export async function getClientIpHash(request: Request): Promise<string> {
  const ip = getClientIp(request) || "unknown";
  const salt = Deno.env.get("RATE_LIMIT_SALT") ||
    (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").slice(0, 32);
  const data = new TextEncoder().encode(`${ip}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function checkRateLimit(
  db: SupabaseClient,
  bucket: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await db.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds
  });

  if (error) {
    console.error("Rate limit RPC failed:", error.code || error.message);
    return Deno.env.get("RATE_LIMIT_FAIL_CLOSED") !== "true";
  }
  return Boolean(data);
}

export interface AuditLogEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
  ipHash?: string | null;
}

export async function writeAuditLog(
  db: SupabaseClient,
  entry: AuditLogEntry
): Promise<void> {
  try {
    const { error } = await db.from("security_audit_logs").insert({
      actor_id: entry.actorId || null,
      actor_email: entry.actorEmail || null,
      actor_role: entry.actorRole || null,
      action: entry.action,
      target_type: entry.targetType || null,
      target_id: entry.targetId || null,
      details: entry.details || {},
      ip_hash: entry.ipHash || null
    });
    if (error) {
      console.error("Audit log insert failed:", error.code || error.message);
    }
  } catch (err) {
    console.error("Audit log unexpected failure:", err instanceof Error ? err.message : "unknown");
  }
}

export async function verifyTurnstileToken(
  token: unknown,
  ip: string | null
): Promise<boolean> {
  const secretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secretKey) return true;
  if (typeof token !== "string" || !token.trim()) return false;

  try {
    const formData = new URLSearchParams();
    formData.set("secret", secretKey);
    formData.set("response", token.trim());
    if (ip) formData.set("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });
    if (!res.ok) return false;
    const outcome = await res.json() as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}
