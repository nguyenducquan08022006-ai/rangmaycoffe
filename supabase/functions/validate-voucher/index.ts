import { createServiceClient } from "../_shared/auth.ts";
import {
  checkRateLimit,
  corsHeaders,
  getClientIpHash,
  jsonResponse,
  readJson
} from "../_shared/http.ts";

interface VoucherRow {
  code: string;
  description: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_amount: number;
  max_discount_amount: number | null;
  usage_limit: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
}

const FALLBACK_VOUCHERS: VoucherRow[] = [
  {
    code: "RANGMAY10",
    description: "Giảm 10% cho đơn từ 100.000đ (tối đa 50.000đ)",
    discount_type: "percent",
    discount_value: 10,
    min_order_amount: 100000,
    max_discount_amount: 50000,
    usage_limit: 100,
    used_count: 0,
    expires_at: null,
    is_active: true
  },
  {
    code: "MANGDEN20K",
    description: "Giảm 20.000đ cho đơn từ 119.000đ",
    discount_type: "fixed",
    discount_value: 20000,
    min_order_amount: 119000,
    max_discount_amount: null,
    usage_limit: 50,
    used_count: 0,
    expires_at: null,
    is_active: true
  },
  {
    code: "VIP50K",
    description: "Giảm 50.000đ khi mua từ 2 hộp (từ 238.000đ)",
    discount_type: "fixed",
    discount_value: 50000,
    min_order_amount: 238000,
    max_discount_amount: null,
    usage_limit: 30,
    used_count: 0,
    expires_at: null,
    is_active: true
  }
];

function fmtVnd(n: number): string {
  return Number(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request.headers.get("origin"), "POST, OPTIONS");
  if (!cors) return new Response("Origin không được phép.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") {
    return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405, cors);
  }

  try {
    const db = createServiceClient();
    const ipHash = await getClientIpHash(request);
    const allowed = await checkRateLimit(db, `voucher:${ipHash}`, 30, 300);
    if (!allowed) {
      return jsonResponse({ error: "Bạn kiểm tra mã giảm giá quá nhanh. Vui lòng thử lại sau ít phút." }, 429, cors);
    }

    const body = await readJson(request) as Record<string, unknown>;
    const rawCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const subtotal = Number(body.subtotal);

    if (!/^[A-Z0-9_-]{3,24}$/.test(rawCode) || !Number.isFinite(subtotal) || subtotal < 1000) {
      return jsonResponse({ error: "Mã giảm giá hoặc tạm tính đơn hàng không hợp lệ." }, 400, cors);
    }

    let voucher: VoucherRow | null = null;
    const { data, error } = await db
      .from("store_vouchers")
      .select("code, description, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, used_count, expires_at, is_active")
      .eq("code", rawCode)
      .maybeSingle();

    if (error && error.code === "PGRST205") {
      voucher = FALLBACK_VOUCHERS.find((v) => v.code === rawCode) || null;
    } else if (!error && data) {
      voucher = data as VoucherRow;
    }

    if (!voucher) {
      return jsonResponse({ error: "Mã giảm giá không tồn tại." }, 404, cors);
    }
    if (!voucher.is_active) {
      return jsonResponse({ error: "Mã giảm giá này hiện đang tạm ngưng áp dụng." }, 400, cors);
    }
    if (voucher.expires_at && Date.parse(voucher.expires_at) <= Date.now()) {
      return jsonResponse({ error: "Mã giảm giá đã hết hạn sử dụng." }, 400, cors);
    }
    if (voucher.used_count >= voucher.usage_limit) {
      return jsonResponse({ error: "Mã giảm giá đã hết lượt sử dụng." }, 400, cors);
    }
    if (subtotal < voucher.min_order_amount) {
      return jsonResponse(
        { error: `Đơn hàng cần tối thiểu ${fmtVnd(voucher.min_order_amount)}đ để áp dụng mã ${voucher.code}.` },
        400,
        cors
      );
    }

    let rawDiscount = voucher.discount_type === "percent"
      ? Math.round((subtotal * voucher.discount_value) / 100)
      : voucher.discount_value;
    if (voucher.discount_type === "percent" && voucher.max_discount_amount && voucher.max_discount_amount > 0) {
      rawDiscount = Math.min(rawDiscount, voucher.max_discount_amount);
    }
    const discountAmount = Math.min(rawDiscount, Math.max(0, Math.floor(subtotal) - 1000));
    const finalTotal = Math.floor(subtotal) - discountAmount;

    return jsonResponse({
      valid: true,
      voucher: {
        code: voucher.code,
        description: voucher.description,
        discount_type: voucher.discount_type,
        discount_value: voucher.discount_value,
        min_order_amount: voucher.min_order_amount,
        max_discount_amount: voucher.max_discount_amount
      },
      discountAmount,
      finalTotal
    }, 200, cors);
  } catch {
    return jsonResponse({ error: "Không thể kiểm tra mã giảm giá lúc này." }, 400, cors);
  }
});
