import { createServiceClient } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

const FALLBACK_PRODUCTS = [
  {
    id: "drip-pack-001",
    sku: "RM-DRIP-001",
    name: "Rang Mây Bản Giao Hưởng",
    price: 119000,
    stock_quantity: 50,
    is_available: true,
    badge_text: "Best Seller • Cân bằng êm dịu"
  },
  {
    id: "drip-pack-002",
    sku: "RM-DRIP-002",
    name: "Rang Mây Đại Ngàn (Gu Đậm Sữa Đá)",
    price: 109000,
    stock_quantity: 45,
    is_available: true,
    badge_text: "Đậm đà • Chuyên Sữa đá & Bạc xỉu"
  },
  {
    id: "drip-pack-003",
    sku: "RM-DRIP-003",
    name: "Rang Mây Sương Sớm (100% Arabica)",
    price: 145000,
    stock_quantity: 35,
    is_available: true,
    badge_text: "Specialty 1.200m • Hợp Cold Brew"
  },
  {
    id: "gift-box-004",
    sku: "RM-GIFT-004",
    name: "Hộp Quà Tinh Hoa Măng Đen (Mix 3 Vị)",
    price: 269000,
    stock_quantity: 25,
    is_available: true,
    badge_text: "Quà biếu cao cấp • 24 gói đủ 3 vị"
  }
];

const FALLBACK_VOUCHERS = [
  {
    code: "RANGMAY10",
    description: "Giảm 10% cho đơn từ 100.000đ (tối đa 50.000đ)",
    discount_type: "percent",
    discount_value: 10,
    min_order_amount: 100000,
    max_discount_amount: 50000
  },
  {
    code: "MANGDEN20K",
    description: "Giảm 20.000đ cho đơn từ 119.000đ",
    discount_type: "fixed",
    discount_value: 20000,
    min_order_amount: 119000,
    max_discount_amount: null
  },
  {
    code: "VIP50K",
    description: "Giảm 50.000đ khi mua từ 2 hộp (từ 238.000đ)",
    discount_type: "fixed",
    discount_value: 50000,
    min_order_amount: 238000,
    max_discount_amount: null
  }
];

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request.headers.get("origin"), "GET, OPTIONS");
  if (!cors) return new Response("Origin không được phép.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") {
    return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405, cors);
  }

  try {
    const db = createServiceClient();
    const [prodRes, voucherRes] = await Promise.all([
      db.from("store_products")
        .select("id, sku, name, price, stock_quantity, is_available, badge_text, updated_at")
        .order("id", { ascending: true }),
      db.from("store_vouchers")
        .select("code, description, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, used_count, expires_at, is_active")
        .eq("is_active", true)
        .order("min_order_amount", { ascending: true })
    ]);

    const products = (!prodRes.error && prodRes.data && prodRes.data.length > 0)
      ? prodRes.data
      : FALLBACK_PRODUCTS;

    let vouchers = FALLBACK_VOUCHERS;
    if (!voucherRes.error && voucherRes.data) {
      const nowMs = Date.now();
      vouchers = voucherRes.data
        .filter((v) => v.is_active && v.used_count < v.usage_limit && (!v.expires_at || Date.parse(v.expires_at) > nowMs))
        .map((v) => ({
          code: v.code,
          description: v.description,
          discount_type: v.discount_type,
          discount_value: v.discount_value,
          min_order_amount: v.min_order_amount,
          max_discount_amount: v.max_discount_amount
        }));
    }

    return jsonResponse({ products, vouchers }, 200, cors);
  } catch {
    return jsonResponse({ products: FALLBACK_PRODUCTS, vouchers: FALLBACK_VOUCHERS }, 200, cors);
  }
});
