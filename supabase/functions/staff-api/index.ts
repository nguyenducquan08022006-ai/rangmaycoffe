import { AuthError, createServiceClient, requireAuth } from "../_shared/auth.ts";
import {
  checkRateLimit,
  corsHeaders,
  getClientIpHash,
  isValidUuid,
  jsonResponse,
  readJson,
  writeAuditLog
} from "../_shared/http.ts";

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "completed", "cancelled"] as const;
const STAFF_ORDER_STATUSES = ["pending", "confirmed", "shipped", "completed"] as const;
const CONTACT_STATUSES = ["new", "in_progress", "resolved"] as const;

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request.headers.get("origin"), "GET, PATCH, OPTIONS");
  if (!cors) return new Response("Origin không được phép.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET" && request.method !== "PATCH") {
    return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405, cors);
  }

  try {
    const db = createServiceClient();
    const envRequireMfa = Deno.env.get("REQUIRE_ADMIN_MFA") === "true";
    const { data: policyRow } = await db
      .from("security_policies")
      .select("require_admin_mfa")
      .eq("id", "default")
      .maybeSingle();

    const requireMfa = envRequireMfa || Boolean(policyRow?.require_admin_mfa);
    const actor = await requireAuth(db, request, {
      roles: ["admin", "manager", "staff"],
      requireMfa,
      enforceVerifiedMfa: true
    });
    const ipHash = await getClientIpHash(request);

    const allowed = await checkRateLimit(db, `staff:${actor.id}`, 120, 60);
    if (!allowed) {
      return jsonResponse({ error: "Quá nhiều thao tác. Vui lòng thử lại sau." }, 429, cors);
    }

    if (request.method === "GET") {
      const [ordersRes, orderStatusesRes, contactsRes, newContactsRes] = await Promise.all([
        db.from("orders")
          .select("id, order_number, customer_name, customer_phone, customer_email, shipping_address, items, subtotal_amount, voucher_code, discount_amount, total_amount, payment_method, status, gift_message, internal_note, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("orders").select("status"),
        db.from("contact_messages")
          .select("id, name, email, phone, message, status, handled_by, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("contact_messages").select("id", { count: "exact", head: true }).eq("status", "new")
      ]);

      if (ordersRes.error || orderStatusesRes.error || contactsRes.error || newContactsRes.error) {
        return jsonResponse({ error: "Không tải được dữ liệu xử lý đơn." }, 500, cors);
      }

      const statuses = orderStatusesRes.data || [];
      return jsonResponse({
        actor: {
          id: actor.id,
          email: actor.email,
          fullName: actor.fullName,
          role: actor.role,
          aal: actor.aal,
          requireAdminMfa: requireMfa
        },
        summary: {
          pendingOrders: statuses.filter(o => o.status === "pending").length,
          confirmedOrders: statuses.filter(o => o.status === "confirmed").length,
          shippedOrders: statuses.filter(o => o.status === "shipped").length,
          completedOrders: statuses.filter(o => o.status === "completed").length,
          newContacts: newContactsRes.count ?? 0
        },
        orders: ordersRes.data || [],
        contacts: contactsRes.data || []
      }, 200, cors);
    }

    const body = await readJson(request) as Record<string, unknown>;
    const action = body.action;

    if (action === "update_order") {
      const orderId = body.orderId;
      const status = body.status;
      const internalNote = body.internalNote;

      if (!isValidUuid(orderId) ||
        typeof status !== "string" ||
        !(ORDER_STATUSES as readonly string[]).includes(status) ||
        (internalNote !== undefined && internalNote !== null &&
          (typeof internalNote !== "string" || internalNote.length > 1000))) {
        return jsonResponse({ error: "Dữ liệu cập nhật đơn hàng không hợp lệ." }, 400, cors);
      }

      const { data: existingOrder } = await db
        .from("orders")
        .select("id, order_number, status")
        .eq("id", orderId)
        .maybeSingle();

      if (!existingOrder) {
        return jsonResponse({ error: "Không tìm thấy đơn hàng." }, 404, cors);
      }

      if (actor.role === "staff" &&
        (!(STAFF_ORDER_STATUSES as readonly string[]).includes(status) || existingOrder.status === "cancelled")) {
        await writeAuditLog(db, {
          actorId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: "access.denied",
          targetType: "order",
          targetId: orderId,
          details: { reason: "staff_cannot_cancel_or_reopen_cancelled", currentStatus: existingOrder.status, requestedStatus: status },
          ipHash
        });
        return jsonResponse({
          error: "Nhân viên không có quyền hủy hoặc sửa đơn đã hủy. Vui lòng báo Quản lý cửa hàng hoặc Chủ cửa hàng.",
          code: "FORBIDDEN_ORDER_CANCEL"
        }, 403, cors);
      }

      const cleanNote = typeof internalNote === "string" && internalNote.trim() ? internalNote.trim() : null;
      const { data: updatedOrder, error: orderUpdateError } = await db
        .from("orders")
        .update({
          status,
          internal_note: cleanNote,
          updated_by: actor.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId)
        .select("id, order_number, status, internal_note, updated_at")
        .single();

      if (orderUpdateError || !updatedOrder) {
        return jsonResponse({ error: "Không cập nhật được đơn hàng." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "order.status_updated",
        targetType: "order",
        targetId: orderId,
        details: { orderNumber: existingOrder.order_number, previousStatus: existingOrder.status, nextStatus: status },
        ipHash
      });

      return jsonResponse({ order: updatedOrder }, 200, cors);
    }

    if (action === "update_contact") {
      const contactId = body.contactId;
      const status = body.status;
      if (!isValidUuid(contactId) || typeof status !== "string" || !(CONTACT_STATUSES as readonly string[]).includes(status)) {
        return jsonResponse({ error: "Dữ liệu cập nhật liên hệ không hợp lệ." }, 400, cors);
      }
      const { data: existingContact } = await db.from("contact_messages").select("id, status").eq("id", contactId).maybeSingle();
      if (!existingContact) {
        return jsonResponse({ error: "Không tìm thấy tin nhắn liên hệ." }, 404, cors);
      }
      const { data: updatedContact, error: contactUpdateError } = await db
        .from("contact_messages")
        .update({ status, handled_by: actor.id, updated_at: new Date().toISOString() })
        .eq("id", contactId)
        .select("id, status, handled_by, updated_at")
        .single();
      if (contactUpdateError || !updatedContact) {
        return jsonResponse({ error: "Không cập nhật được trạng thái liên hệ." }, 500, cors);
      }
      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "contact.status_updated",
        targetType: "contact_message",
        targetId: contactId,
        details: { previousStatus: existingContact.status, nextStatus: status },
        ipHash
      });
      return jsonResponse({ contact: updatedContact }, 200, cors);
    }

    await writeAuditLog(db, {
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "access.denied",
      targetType: "staff_api",
      targetId: typeof action === "string" ? action : "unknown",
      details: { attemptedAction: action },
      ipHash
    });
    return jsonResponse({ error: "Nhân viên chỉ được cập nhật tiến độ xử lý đơn và phản hồi liên hệ." }, 403, cors);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, cors);
    }
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("quá lớn") ? 413 : 400;
    return jsonResponse({ error: status === 413 ? message : "Yêu cầu nhân viên không hợp lệ." }, status, cors);
  }
});
