import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getClientIpHash, writeAuditLog } from "./http.ts";

export type UserRole = "customer" | "staff" | "manager" | "admin";

export interface AuthenticatedActor {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  defaultAddress: string | null;
  role: UserRole;
  canEditPrice: boolean;
  isActive: boolean;
  aal: string;
  hasVerifiedMfa: boolean;
}

export class AuthError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new AuthError(503, "Dịch vụ xác thực chưa được cấu hình.", "BACKEND_NOT_CONFIGURED");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (anonKey && token === anonKey) return null;

  // Supabase publishable keys or legacy anon JWTs have role = 'anon'
  const payload = decodeJwtPayload(token);
  if (!payload || payload.role === "anon" || typeof payload.sub !== "string") {
    return null;
  }
  return token;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeJwtAal(token: string): string {
  const payload = decodeJwtPayload(token);
  return payload && typeof payload.aal === "string" ? payload.aal : "aal1";
}

async function resolveUserFromToken(
  db: SupabaseClient,
  token: string
): Promise<AuthenticatedActor> {
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) {
    throw new AuthError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.", "INVALID_SESSION");
  }

  const user = userData.user;
  const aal = decodeJwtAal(token);
  const factors = Array.isArray((user as { factors?: unknown[] }).factors)
    ? ((user as { factors?: Array<{ factor_type?: string; status?: string }> }).factors || [])
    : [];
  const hasVerifiedMfa = factors.some((f) => f && f.factor_type === "totp" && f.status === "verified");

  let { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, email, full_name, phone, default_address, role, can_edit_price, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Profile lookup failed:", profileError.code || profileError.message);
    throw new AuthError(500, "Không thể xác minh hồ sơ tài khoản.");
  }

  if (!profile) {
    const fallbackName = typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.slice(0, 100)
      : "";
    const { data: created, error: insertError } = await db
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email || "",
        full_name: fallbackName,
        role: "customer"
      })
      .select("id, email, full_name, phone, default_address, role, can_edit_price, is_active")
      .single();

    if (insertError || !created) {
      throw new AuthError(500, "Không thể khởi tạo hồ sơ tài khoản.");
    }
    profile = created;
  }

  if (!profile.is_active) {
    throw new AuthError(403, "Tài khoản này đã bị tạm khóa bởi quản trị viên.", "ACCOUNT_DISABLED");
  }

  const resolvedRole = (profile.role || "customer") as UserRole;
  return {
    id: profile.id,
    email: profile.email || user.email || "",
    fullName: profile.full_name || "",
    phone: profile.phone ?? null,
    defaultAddress: profile.default_address ?? null,
    role: resolvedRole,
    canEditPrice: resolvedRole === "admin" || (resolvedRole === "manager" && Boolean(profile.can_edit_price)),
    isActive: Boolean(profile.is_active),
    aal,
    hasVerifiedMfa
  };
}

export async function getOptionalUser(
  db: SupabaseClient,
  request: Request
): Promise<AuthenticatedActor | null> {
  const token = extractBearerToken(request);
  if (!token) return null;
  return await resolveUserFromToken(db, token);
}

export interface RequireAuthOptions {
  roles?: UserRole[];
  requireMfa?: boolean;
  enforceVerifiedMfa?: boolean;
}

export async function requireAuth(
  db: SupabaseClient,
  request: Request,
  options: RequireAuthOptions = {}
): Promise<AuthenticatedActor> {
  const token = extractBearerToken(request);
  if (!token) {
    throw new AuthError(401, "Vui lòng đăng nhập để tiếp tục.", "AUTH_REQUIRED");
  }

  const actor = await resolveUserFromToken(db, token);

  if (options.roles && !options.roles.includes(actor.role)) {
    const ipHash = await getClientIpHash(request);
    await writeAuditLog(db, {
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "access.denied",
      targetType: "edge_function",
      targetId: new URL(request.url).pathname,
      details: { requiredRoles: options.roles },
      ipHash
    });
    throw new AuthError(403, "Bạn không có quyền truy cập khu vực này.", "FORBIDDEN_ROLE");
  }

  const mfaRequiredForActor = Boolean(options.requireMfa || (options.enforceVerifiedMfa && actor.hasVerifiedMfa));
  if (mfaRequiredForActor && actor.aal !== "aal2") {
    const ipHash = await getClientIpHash(request);
    await writeAuditLog(db, {
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "access.denied",
      targetType: "edge_function",
      targetId: new URL(request.url).pathname,
      details: { reason: "mfa_required_aal2", currentAal: actor.aal },
      ipHash
    });
    throw new AuthError(
      403,
      "Tài khoản quản trị/nhân viên bắt buộc bật và xác thực 2 yếu tố (2FA – AAL2) trước khi truy cập.",
      "MFA_REQUIRED"
    );
  }

  return actor;
}
