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
      roles: ["admin", "manager"],
      requireMfa,
      enforceVerifiedMfa: true
    });
    const ipHash = await getClientIpHash(request);

    const allowed = await checkRateLimit(db, `manager:${actor.id}`, 120, 60);
    if (!allowed) {
      return jsonResponse({ error: "Quá nhiều thao tác quản lý. Vui lòng thử lại sau." }, 429, cors);
    }

    if (request.method === "GET") {
      const [ordersRes, orderStatsRes, contactsRes, newContactsRes, catalogRes, staffRes, vouchersRes] = await Promise.all([
        db.from("orders")
          .select("id, order_number, user_id, customer_name, customer_phone, customer_email, shipping_address, items, subtotal_amount, voucher_code, discount_amount, total_amount, payment_method, status, gift_message, internal_note, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("orders").select("status, total_amount"),
        db.from("contact_messages")
          .select("id, user_id, name, email, phone, message, status, handled_by, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("contact_messages").select("id", { count: "exact", head: true }).eq("status", "new"),
        db.from("store_products").select("id, sku, name, price, stock_quantity, is_available, badge_text, updated_at").order("id"),
        db.from("profiles").select("id, full_name, email, is_active").eq("role", "staff").order("created_at", { ascending: false }),
        db.from("store_vouchers")
          .select("code, description, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, used_count, expires_at, is_active, updated_at")
          .order("created_at", { ascending: false })
      ]);

      if (ordersRes.error || orderStatsRes.error || contactsRes.error || newContactsRes.error || staffRes.error) {
        return jsonResponse({ error: "Không tải được dữ liệu quản lý cửa hàng." }, 500, cors);
      }

      const allOrderRows = orderStatsRes.data || [];
      const totalOrders = allOrderRows.length;
      const pendingOrders = allOrderRows.filter(o => o.status === "pending").length;
      const confirmedOrders = allOrderRows.filter(o => o.status === "confirmed").length;
      const shippedOrders = allOrderRows.filter(o => o.status === "shipped").length;
      const completedOrders = allOrderRows.filter(o => o.status === "completed").length;
      const cancelledOrders = allOrderRows.filter(o => o.status === "cancelled").length;
      const activeOrders = allOrderRows.filter(o => o.status !== "cancelled");
      const totalRevenue = activeOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
      const avgOrderValue = activeOrders.length > 0 ? Math.round(totalRevenue / activeOrders.length) : 0;
      const completionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
      const catalog = (!catalogRes.error && catalogRes.data) ? catalogRes.data : [];
      const vouchers = (!vouchersRes.error && vouchersRes.data) ? vouchersRes.data : [];
      const totalStock = catalog.reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity) || 0), 0);

      return jsonResponse({
        actor: {
          id: actor.id,
          email: actor.email,
          fullName: actor.fullName,
          role: actor.role,
          canEditPrice: actor.canEditPrice,
          aal: actor.aal,
          requireAdminMfa: requireMfa
        },
        summary: {
          totalOrders,
          pendingOrders,
          confirmedOrders,
          shippedOrders,
          completedOrders,
          cancelledOrders,
          totalRevenue,
          avgOrderValue,
          completionRate,
          newContacts: newContactsRes.count ?? 0,
          totalStock
        },
        catalog,
        vouchers,
        orders: ordersRes.data || [],
        contacts: contactsRes.data || [],
        staffRoster: staffRes.data || []
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
        .select("id, order_number, status, items, voucher_code")
        .eq("id", orderId)
        .maybeSingle();

      if (!existingOrder) {
        return jsonResponse({ error: "Không tìm thấy đơn hàng." }, 404, cors);
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

      if (existingOrder.status !== "cancelled" && status === "cancelled") {
        if (Array.isArray(existingOrder.items)) {
          for (const item of existingOrder.items as Array<{ id?: string; quantity?: number }>) {
            if (item?.id && typeof item.quantity === "number") {
              const { data: prod } = await db.from("store_products").select("stock_quantity").eq("id", item.id).maybeSingle();
              if (prod) {
                await db.from("store_products").update({
                  stock_quantity: Math.min(10000, (Number(prod.stock_quantity) || 0) + item.quantity),
                  updated_at: new Date().toISOString()
                }).eq("id", item.id);
              }
            }
          }
        }
        if (existingOrder.voucher_code) {
          const { data: vRow } = await db.from("store_vouchers").select("used_count").eq("code", existingOrder.voucher_code).maybeSingle();
          if (vRow) {
            await db.from("store_vouchers").update({
              used_count: Math.max(0, (Number(vRow.used_count) || 0) - 1),
              updated_at: new Date().toISOString()
            }).eq("code", existingOrder.voucher_code);
          }
        }
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

    if (action === "update_product") {
      const productId = body.productId;
      const stockQuantity = body.stockQuantity;
      const isAvailable = body.isAvailable;
      const badgeText = body.badgeText;

      if (typeof productId !== "string") {
        return jsonResponse({ error: "Mã sản phẩm không hợp lệ." }, 400, cors);
      }

      const { data: existingProd } = await db
        .from("store_products")
        .select("id, price, stock_quantity")
        .eq("id", productId)
        .maybeSingle();

      if (!existingProd) {
        return jsonResponse({ error: "Không tìm thấy sản phẩm trong kho." }, 404, cors);
      }

      const price = body.price === undefined ? existingProd.price : body.price;
      if (
        !Number.isInteger(price) || (price as number) < 10000 || (price as number) > 5000000 ||
        !Number.isInteger(stockQuantity) || (stockQuantity as number) < 0 || (stockQuantity as number) > 10000 ||
        typeof isAvailable !== "boolean" ||
        (badgeText !== undefined && badgeText !== null && (typeof badgeText !== "string" || badgeText.trim().length > 120))
      ) {
        return jsonResponse({ error: "Thông tin cập nhật sản phẩm không hợp lệ." }, 400, cors);
      }

      if (price !== existingProd.price && !actor.canEditPrice) {
        await writeAuditLog(db, {
          actorId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: "access.denied",
          targetType: "store_product",
          targetId: productId,
          details: { reason: "missing_can_edit_price", currentPrice: existingProd.price, attemptedPrice: price },
          ipHash
        });
        return jsonResponse({
          error: "Tài khoản Quản lý của bạn chưa được Chủ cửa hàng cấp quyền sửa giá bán. Bạn chỉ được phép cập nhật tồn kho và trạng thái mở bán.",
          code: "FORBIDDEN_PRICE_EDIT"
        }, 403, cors);
      }

      const updateFields: Record<string, unknown> = {
        price,
        stock_quantity: stockQuantity,
        is_available: isAvailable,
        updated_by: actor.id,
        updated_at: new Date().toISOString()
      };
      if (typeof badgeText === "string") {
        updateFields.badge_text = badgeText.trim();
      }

      const { data: updatedProd, error: prodErr } = await db
        .from("store_products")
        .update(updateFields)
        .eq("id", productId)
        .select("id, sku, name, price, stock_quantity, is_available, badge_text, updated_at")
        .single();

      if (prodErr || !updatedProd) {
        return jsonResponse({ error: "Không cập nhật được sản phẩm." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "product.updated",
        targetType: "store_product",
        targetId: productId,
        details: { prevPrice: existingProd.price, nextPrice: price, prevStock: existingProd.stock_quantity, nextStock: stockQuantity, isAvailable },
        ipHash
      });

      return jsonResponse({ product: updatedProd }, 200, cors);
    }

    if (action === "upsert_voucher") {
      const code = typeof body.code === "string"
        ? body.code.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "D").toUpperCase().replace(/\s+/g, "")
        : "";
      const discountType = body.discountType;
      const discountValue = body.discountValue;
      const minOrderAmount = body.minOrderAmount ?? 0;
      const maxDiscountAmount = body.maxDiscountAmount === null || body.maxDiscountAmount === "" || body.maxDiscountAmount === undefined
        ? null
        : Number(body.maxDiscountAmount);
      const usageLimit = body.usageLimit ?? 100;
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const isActive = body.isActive !== false;

      const validValue = discountType === "percent"
        ? (Number.isInteger(discountValue) && (discountValue as number) >= 1 && (discountValue as number) <= 90)
        : (discountType === "fixed" && Number.isInteger(discountValue) && (discountValue as number) >= 1000 && (discountValue as number) <= 2000000);

      if (
        !/^[A-Z0-9_-]{3,24}$/.test(code) ||
        !validValue ||
        !Number.isInteger(minOrderAmount) || (minOrderAmount as number) < 0 || (minOrderAmount as number) > 10000000 ||
        (maxDiscountAmount !== null && (!Number.isInteger(maxDiscountAmount) || maxDiscountAmount < 1000 || maxDiscountAmount > 2000000)) ||
        !Number.isInteger(usageLimit) || (usageLimit as number) < 1 || (usageLimit as number) > 100000 ||
        description.length > 160
      ) {
        return jsonResponse({ error: "Thông tin mã giảm giá chưa hợp lệ." }, 400, cors);
      }

      const { data: savedVoucher, error: vErr } = await db
        .from("store_vouchers")
        .upsert({
          code,
          description,
          discount_type: discountType,
          discount_value: discountValue,
          min_order_amount: minOrderAmount,
          max_discount_amount: discountType === "percent" ? maxDiscountAmount : null,
          usage_limit: usageLimit,
          is_active: Boolean(isActive),
          updated_by: actor.id,
          updated_at: new Date().toISOString()
        }, { onConflict: "code" })
        .select("*")
        .single();

      if (vErr || !savedVoucher) {
        return jsonResponse({ error: "Không lưu được mã giảm giá." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "voucher.upserted",
        targetType: "store_voucher",
        targetId: code,
        details: { discountType, discountValue, minOrderAmount, usageLimit, isActive: Boolean(isActive) },
        ipHash
      });
      return jsonResponse({ voucher: savedVoucher }, 200, cors);
    }

    if (action === "toggle_voucher") {
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const isActive = body.isActive;
      if (!/^[A-Z0-9_-]{3,24}$/.test(code) || typeof isActive !== "boolean") {
        return jsonResponse({ error: "Dữ liệu bật/tắt voucher không hợp lệ." }, 400, cors);
      }
      const { data: updatedV, error: tErr } = await db
        .from("store_vouchers")
        .update({ is_active: isActive, updated_by: actor.id, updated_at: new Date().toISOString() })
        .eq("code", code)
        .select("*")
        .maybeSingle();
      if (tErr || !updatedV) {
        return jsonResponse({ error: "Không tìm thấy mã giảm giá." }, 404, cors);
      }
      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "voucher.toggled",
        targetType: "store_voucher",
        targetId: code,
        details: { isActive },
        ipHash
      });
      return jsonResponse({ voucher: updatedV }, 200, cors);
    }

    if (action === "delete_voucher") {
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
        return jsonResponse({ error: "Mã voucher không hợp lệ." }, 400, cors);
      }
      const { error: dErr } = await db.from("store_vouchers").delete().eq("code", code);
      if (dErr) {
        return jsonResponse({ error: "Không xóa được mã giảm giá." }, 500, cors);
      }
      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "voucher.deleted",
        targetType: "store_voucher",
        targetId: code,
        details: {},
        ipHash
      });
      return jsonResponse({ deleted: code }, 200, cors);
    }

    await writeAuditLog(db, {
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "access.denied",
      targetType: "manager_api",
      targetId: typeof action === "string" ? action : "unknown",
      details: { attemptedAction: action },
      ipHash
    });
    return jsonResponse({ error: "Thao tác phân quyền hoặc bảo mật hệ thống chỉ thuộc về Chủ cửa hàng (Admin)." }, 403, cors);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, cors);
    }
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("quá lớn") ? 413 : 400;
    return jsonResponse({ error: status === 413 ? message : "Yêu cầu quản lý không hợp lệ." }, status, cors);
  }
});
