import { AuthError, createServiceClient, requireAuth } from "../_shared/auth.ts";
import {
  checkRateLimit,
  corsHeaders,
  getClientIpHash,
  isValidUuid,
  isValidVietnamesePhone,
  jsonResponse,
  readJson,
  validText,
  writeAuditLog
} from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request.headers.get("origin"), "GET, PATCH, OPTIONS");
  if (!cors) return new Response("Origin không được phép.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET" && request.method !== "PATCH") {
    return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405, cors);
  }

  try {
    const db = createServiceClient();
    const actor = await requireAuth(db, request);
    const ipHash = await getClientIpHash(request);

    const allowed = await checkRateLimit(db, `account:${actor.id}`, 60, 60);
    if (!allowed) {
      return jsonResponse({ error: "Quá nhiều yêu cầu. Vui lòng thử lại sau giây lát." }, 429, cors);
    }

    if (request.method === "GET") {
      const { data: orders, error: ordersError } = await db
        .from("orders")
        .select("id, order_number, customer_name, customer_phone, shipping_address, items, subtotal_amount, voucher_code, discount_amount, total_amount, payment_method, status, gift_message, created_at")
        .eq("user_id", actor.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (ordersError) {
        console.error("Account orders fetch failed:", ordersError.code);
        return jsonResponse({ error: "Không tải được lịch sử đơn hàng." }, 500, cors);
      }

      return jsonResponse({
        profile: {
          id: actor.id,
          email: actor.email,
          fullName: actor.fullName,
          phone: actor.phone || "",
          defaultAddress: actor.defaultAddress || "",
          role: actor.role,
          isActive: actor.isActive
        },
        security: {
          aal: actor.aal,
          requireAdminMfa: Deno.env.get("REQUIRE_ADMIN_MFA") === "true"
        },
        orders: orders || []
      }, 200, cors);
    }

    const body = await readJson(request) as Record<string, unknown>;

    if (body.action === "cancel_order") {
      const orderId = body.orderId;
      if (!isValidUuid(orderId)) {
        return jsonResponse({ error: "Mã định danh đơn hàng không hợp lệ." }, 400, cors);
      }

      const { data: existingOrder } = await db
        .from("orders")
        .select("id, order_number, user_id, status, items, voucher_code")
        .eq("id", orderId)
        .eq("user_id", actor.id)
        .maybeSingle();

      if (!existingOrder) {
        return jsonResponse({ error: "Không tìm thấy đơn hàng thuộc tài khoản của bạn." }, 404, cors);
      }
      if (existingOrder.status !== "pending") {
        return jsonResponse({ error: "Chỉ có thể tự hủy khi đơn hàng còn ở trạng thái Chờ xác nhận." }, 400, cors);
      }

      const { data: cancelledOrder, error: cancelErr } = await db
        .from("orders")
        .update({
          status: "cancelled",
          internal_note: "Khách hàng tự hủy đơn khi chờ xác nhận",
          updated_by: actor.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId)
        .eq("user_id", actor.id)
        .select("id, order_number, status, updated_at")
        .single();

      if (cancelErr || !cancelledOrder) {
        return jsonResponse({ error: "Không thể hủy đơn hàng lúc này." }, 500, cors);
      }

      if (Array.isArray(existingOrder.items)) {
        for (const item of existingOrder.items as Array<{ id?: string; quantity?: number }>) {
          if (item?.id && typeof item.quantity === "number") {
            const { data: prod } = await db
              .from("store_products")
              .select("stock_quantity")
              .eq("id", item.id)
              .maybeSingle();
            if (prod) {
              await db
                .from("store_products")
                .update({
                  stock_quantity: Math.min(10000, (Number(prod.stock_quantity) || 0) + item.quantity),
                  updated_at: new Date().toISOString()
                })
                .eq("id", item.id);
            }
          }
        }
      }

      if (existingOrder.voucher_code) {
        const { data: vRow } = await db
          .from("store_vouchers")
          .select("used_count")
          .eq("code", existingOrder.voucher_code)
          .maybeSingle();
        if (vRow) {
          await db
            .from("store_vouchers")
            .update({
              used_count: Math.max(0, (Number(vRow.used_count) || 0) - 1),
              updated_at: new Date().toISOString()
            })
            .eq("code", existingOrder.voucher_code);
        }
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "order.cancelled_by_customer",
        targetType: "order",
        targetId: orderId,
        details: { orderNumber: existingOrder.order_number },
        ipHash
      });

      return jsonResponse({ order: cancelledOrder }, 200, cors);
    }

    const fullName = body.fullName;
    const rawPhone = body.phone;
    const rawAddress = body.defaultAddress;

    if (!validText(fullName, 2, 100)) {
      return jsonResponse({ error: "Họ và tên phải từ 2 đến 100 ký tự." }, 400, cors);
    }

    let normalizedPhone: string | null = null;
    if (rawPhone !== undefined && rawPhone !== null && rawPhone !== "") {
      if (typeof rawPhone !== "string" || rawPhone.trim().length > 16) {
        return jsonResponse({ error: "Số điện thoại chưa hợp lệ." }, 400, cors);
      }
      const compact = rawPhone.replace(/\s/g, "");
      if (!isValidVietnamesePhone(compact)) {
        return jsonResponse({ error: "Số điện thoại phải đúng định dạng Việt Nam (0... hoặc +84...)." }, 400, cors);
      }
      normalizedPhone = compact;
    }

    let normalizedAddress: string | null = null;
    if (rawAddress !== undefined && rawAddress !== null && rawAddress !== "") {
      if (!validText(rawAddress, 5, 500)) {
        return jsonResponse({ error: "Địa chỉ mặc định phải từ 5 đến 500 ký tự." }, 400, cors);
      }
      normalizedAddress = rawAddress.trim();
    }

    const { data: updated, error: updateError } = await db
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        phone: normalizedPhone,
        default_address: normalizedAddress
      })
      .eq("id", actor.id)
      .select("id, email, full_name, phone, default_address, role, is_active")
      .single();

    if (updateError || !updated) {
      console.error("Account update failed:", updateError?.code);
      return jsonResponse({ error: "Không cập nhật được thông tin hồ sơ." }, 500, cors);
    }

    await writeAuditLog(db, {
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "profile.updated",
      targetType: "profile",
      targetId: actor.id,
      ipHash
    });

    return jsonResponse({
      profile: {
        id: updated.id,
        email: updated.email,
        fullName: updated.full_name,
        phone: updated.phone || "",
        defaultAddress: updated.default_address || "",
        role: updated.role,
        isActive: updated.is_active
      }
    }, 200, cors);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, cors);
    }
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("quá lớn") ? 413 : 400;
    return jsonResponse({ error: status === 413 ? message : "Yêu cầu tài khoản không hợp lệ." }, status, cors);
  }
});
