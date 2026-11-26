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

const productCatalog = {
  "drip-pack-001": { name: "Cà phê phin giấy Rang Mây", unitPrice: 119000 }
};

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request.headers.get("origin"), "POST, OPTIONS");
  if (!cors) return new Response("Origin không được phép.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405, cors);

  try {
    const db = createServiceClient();
    const ipHash = await getClientIpHash(request);
    const allowed = await checkRateLimit(db, `order:${ipHash}`, 10, 600);
    if (!allowed) {
      return jsonResponse({ error: "Bạn thao tác đặt hàng quá nhanh. Vui lòng thử lại sau ít phút." }, 429, cors);
    }

    const body = await readJson(request) as Record<string, unknown>;
    const turnstileOk = await verifyTurnstileToken(body.turnstileToken, getClientIp(request));
    if (!turnstileOk) {
      return jsonResponse({ error: "Xác minh chống spam (Turnstile) không hợp lệ." }, 400, cors);
    }

    const actor = await getOptionalUser(db, request);
    const customer = body.customer as Record<string, unknown> | undefined;
    const items = body.items;
    const paymentMethod = body.paymentMethod;
    const giftMessage = body.giftMessage;

    if (!customer ||
      !validText(customer.name, 2, 100) ||
      !validText(customer.phone, 10, 13) ||
      !isValidVietnamesePhone(customer.phone) ||
      (customer.email !== "" && customer.email !== null && customer.email !== undefined &&
        (typeof customer.email !== "string" || !isValidEmail(customer.email.trim()))) ||
      !validText(customer.address, 5, 500)) {
      return jsonResponse({ error: "Thông tin người nhận chưa hợp lệ." }, 400, cors);
    }

    if (!Array.isArray(items) || items.length !== 1 || paymentMethod !== "COD" ||
      (giftMessage !== undefined && giftMessage !== "" &&
        (typeof giftMessage !== "string" || giftMessage.length > 1000))) {
      return jsonResponse({ error: "Thông tin đơn hàng hoặc phương thức thanh toán chưa hợp lệ." }, 400, cors);
    }

    const item = items[0] as Record<string, unknown>;
    const fallbackProduct = productCatalog[item.id as keyof typeof productCatalog];
    const quantity = item.quantity;
    if (!fallbackProduct || !Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 99) {
      return jsonResponse({ error: "Sản phẩm hoặc số lượng không hợp lệ." }, 400, cors);
    }

    let productName = fallbackProduct.name;
    let unitPrice = fallbackProduct.unitPrice;
    let liveStockRow: { stock_quantity: number; is_available: boolean } | null = null;

    const { data: dbProduct, error: dbProductErr } = await db
      .from("store_products")
      .select("name, price, stock_quantity, is_available")
      .eq("id", item.id)
      .maybeSingle();

    if (!dbProductErr && dbProduct) {
      if (!dbProduct.is_available || dbProduct.stock_quantity < (quantity as number)) {
        return jsonResponse({
          error: dbProduct.is_available
            ? `Sản phẩm hiện chỉ còn ${dbProduct.stock_quantity} hộp trong kho.`
            : "Sản phẩm hiện đang tạm hết hàng."
        }, 400, cors);
      }
      productName = dbProduct.name;
      unitPrice = dbProduct.price;
      liveStockRow = dbProduct;
    }

    const subtotal = unitPrice * (quantity as number);
    const rawVoucherCode = typeof body.voucherCode === "string" ? body.voucherCode.trim().toUpperCase() : "";
    let appliedVoucherCode: string | null = null;
    let discountAmount = 0;
    let liveVoucherUsedCount: number | null = null;

    if (rawVoucherCode) {
      if (!/^[A-Z0-9_-]{3,24}$/.test(rawVoucherCode)) {
        return jsonResponse({ error: "Định dạng mã giảm giá không hợp lệ." }, 400, cors);
      }
      const { data: vRow, error: vErr } = await db
        .from("store_vouchers")
        .select("code, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, used_count, expires_at, is_active")
        .eq("code", rawVoucherCode)
        .maybeSingle();

      if (vErr || !vRow) {
        return jsonResponse({ error: "Mã giảm giá không tồn tại." }, 400, cors);
      }
      if (!vRow.is_active || (vRow.expires_at && Date.parse(vRow.expires_at) <= Date.now())) {
        return jsonResponse({ error: "Mã giảm giá đang tạm ngưng hoặc đã hết hạn." }, 400, cors);
      }
      if (vRow.used_count >= vRow.usage_limit) {
        return jsonResponse({ error: "Mã giảm giá đã hết lượt sử dụng." }, 400, cors);
      }
      if (subtotal < vRow.min_order_amount) {
        return jsonResponse({ error: "Đơn hàng chưa đạt giá trị tối thiểu để áp dụng mã giảm giá này." }, 400, cors);
      }
      let rawDiscount = vRow.discount_type === "percent"
        ? Math.round((subtotal * vRow.discount_value) / 100)
        : vRow.discount_value;
      if (vRow.discount_type === "percent" && vRow.max_discount_amount && vRow.max_discount_amount > 0) {
        rawDiscount = Math.min(rawDiscount, vRow.max_discount_amount);
      }
      discountAmount = Math.min(rawDiscount, Math.max(0, subtotal - 1000));
      appliedVoucherCode = vRow.code;
      liveVoucherUsedCount = vRow.used_count;
    }

    const total = subtotal - discountAmount;
    const { data, error } = await db.from("orders").insert({
      user_id: actor ? actor.id : null,
      customer_name: customer.name.trim(),
      customer_phone: customer.phone,
      customer_email: typeof customer.email === "string" && customer.email.trim()
        ? customer.email.trim()
        : (actor ? actor.email : null),
      shipping_address: customer.address.trim(),
      items: [{ id: item.id, name: productName, quantity, unit_price: unitPrice }],
      subtotal_amount: subtotal,
      voucher_code: appliedVoucherCode,
      discount_amount: discountAmount,
      total_amount: total,
      payment_method: "COD",
      gift_message: typeof giftMessage === "string" && giftMessage.trim() ? giftMessage.trim() : null
    }).select("order_number, gift_message").single();

    if (error) {
      console.error("Order insert failed:", error.code);
      return jsonResponse({ error: "Không lưu được đơn hàng. Vui lòng thử lại." }, 500, cors);
    }

    if (liveStockRow) {
      await db
        .from("store_products")
        .update({
          stock_quantity: Math.max(0, liveStockRow.stock_quantity - (quantity as number)),
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);
    }

    if (appliedVoucherCode && liveVoucherUsedCount !== null) {
      await db
        .from("store_vouchers")
        .update({
          used_count: liveVoucherUsedCount + 1,
          updated_at: new Date().toISOString()
        })
        .eq("code", appliedVoucherCode);
    }

    return jsonResponse({
      orderNumber: data.order_number,
      subtotalAmount: subtotal,
      discountAmount,
      totalAmount: total,
      voucherCode: appliedVoucherCode || "",
      giftMessage: data.gift_message || ""
    }, 201, cors);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, cors);
    }
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("quá lớn") ? 413 : 400;
    return jsonResponse({ error: status === 413 ? message : "Dữ liệu đơn hàng không hợp lệ." }, status, cors);
  }
});
