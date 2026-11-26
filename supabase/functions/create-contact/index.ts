import { AuthError, createServiceClient, getOptionalUser } from "../_shared/auth.ts";
import {
  checkRateLimit,
  corsHeaders,
  getClientIp,
  getClientIpHash,
  isValidEmail,
  isValidVietnamesePhone,
  jsonResponse,
  readJson,
  validText,
  verifyTurnstileToken
} from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request.headers.get("origin"), "POST, OPTIONS");
  if (!cors) return new Response("Origin không được phép.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405, cors);

  try {
    const db = createServiceClient();
    const ipHash = await getClientIpHash(request);
    const allowed = await checkRateLimit(db, `contact:${ipHash}`, 5, 600);
    if (!allowed) {
      return jsonResponse({ error: "Bạn gửi liên hệ quá nhanh. Vui lòng thử lại sau ít phút." }, 429, cors);
    }

    const body = await readJson(request) as Record<string, unknown>;
    const turnstileOk = await verifyTurnstileToken(body.turnstileToken, getClientIp(request));
    if (!turnstileOk) {
      return jsonResponse({ error: "Xác minh chống spam (Turnstile) không hợp lệ." }, 400, cors);
    }

    const actor = await getOptionalUser(db, request);

    if (!validText(body.name, 2, 100) ||
      typeof body.email !== "string" || !isValidEmail(body.email.trim()) ||
      !validText(body.message, 2, 2000) ||
      (body.phone !== "" && body.phone !== null && body.phone !== undefined &&
        (typeof body.phone !== "string" || body.phone.length > 16 ||
          !isValidVietnamesePhone(body.phone.replace(/\s/g, ""))))) {
      return jsonResponse({ error: "Thông tin liên hệ chưa hợp lệ." }, 400, cors);
    }

    const { error } = await db.from("contact_messages").insert({
      user_id: actor ? actor.id : null,
      name: body.name.trim(),
      email: body.email.trim(),
      phone: typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null,
      message: body.message.trim()
    });

    if (error) {
      console.error("Contact insert failed:", error.code);
      return jsonResponse({ error: "Không gửi được liên hệ. Vui lòng thử lại." }, 500, cors);
    }

    return jsonResponse({ received: true }, 201, cors);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, cors);
    }
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("quá lớn") ? 413 : 400;
    return jsonResponse({ error: status === 413 ? message : "Dữ liệu liên hệ không hợp lệ." }, status, cors);
  }
});
