import { createServiceClient } from "../_shared/auth.ts";
import {
  checkRateLimit,
  corsHeaders,
  getClientIpHash,
  jsonResponse,
  readJson
} from "../_shared/http.ts";

interface ProductSnapshot {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  is_available: boolean;
  badge_text: string;
}

interface VoucherSnapshot {
  code: string;
  description: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_amount: number;
  max_discount_amount: number | null;
}

interface ChatAction {
  type: "add_to_cart" | "apply_voucher" | "scroll_section";
  label: string;
  code?: string;
  target?: string;
}

const ORDER_STATUS_VI: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận (đang chuẩn bị hàng)",
  shipped: "Đang giao hàng",
  completed: "Đã giao hoàn tất",
  cancelled: "Đã hủy"
};

function fmtVnd(n: number): string {
  return Number(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function foldVi(str: string): string {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p));
}

function generateSmartGiftCard(recipient: string, occasion: string, style: string): string {
  const cleanName = recipient.slice(0, 60);
  const cleanOcc = occasion.slice(0, 80);
  const occLower = cleanOcc.toLowerCase();
  if (style === "warm") {
    return `Thân gửi ${cleanName} nhân ${occLower},\nGiữa nhịp sống bận rộn, mong rằng từng giọt cà phê Măng Đen ấm nồng từ Rang Mây sẽ mang đến cho bạn phút giây thư thái, trọn vẹn niềm vui và thật nhiều năng lượng lành.`;
  }
  if (style === "gentle") {
    return `Gửi ${cleanName} lời chúc dịu êm nhất nhân ${occLower}.\nChúc bạn luôn giữ được khoảng lặng bình yên trong tâm hồn, để mỗi sớm mai thức dậy đều nhẹ nhàng và ngọt hậu như tách Arabica vùng cao.`;
  }
  return `Gửi ${cleanName} từ đại ngàn Măng Đen mây phủ nhân ${occLower},\nNhư sương sớm ấp ôm triền đồi bazan, chúc những tháng ngày sắp tới của bạn luôn đong đầy cảm hứng, thơm nồng nốt hương hạnh phúc và dịu êm trên mọi hành trình.`;
}

function calcVoucherSaving(v: VoucherSnapshot, subtotal: number): number {
  if (subtotal < Number(v.min_order_amount || 0)) return 0;
  if (v.discount_type === "percent") {
    let raw = Math.round((subtotal * Number(v.discount_value || 0)) / 100);
    if (v.max_discount_amount && raw > v.max_discount_amount) raw = v.max_discount_amount;
    return Math.min(subtotal, Math.max(0, raw));
  }
  return Math.min(subtotal, Math.max(0, Number(v.discount_value || 0)));
}

function buildGroundedBaristaResponse(
  rawMessage: string,
  product: ProductSnapshot,
  vouchers: VoucherSnapshot[],
  orderMatch: { order_number: string; status: string; total_amount: number; discount_amount?: number; voucher_code?: string | null; created_at: string } | null,
  askedOrderCode: string | null
): { reply: string; actions: ChatAction[]; suggestions: string[] } {
  const q = foldVi(rawMessage);
  const actions: ChatAction[] = [];
  const pricePerCup = Math.round(product.price / 10);
  const inStock = product.is_available && product.stock_quantity > 0;

  // 1. Order tracking intent (explicit RM-... code or asking how to track)
  if (askedOrderCode) {
    if (orderMatch) {
      const stLabel = ORDER_STATUS_VI[orderMatch.status] || orderMatch.status;
      const vchPart = orderMatch.voucher_code && Number(orderMatch.discount_amount) > 0
        ? ` (đã áp mã ${orderMatch.voucher_code} giảm ${fmtVnd(Number(orderMatch.discount_amount))}đ)`
        : "";
      return {
        reply:
          `📦 Tra cứu đơn hàng ${orderMatch.order_number}:\n` +
          `• Trạng thái hiện tại: ${stLabel}\n` +
          `• Tổng thanh toán COD: ${fmtVnd(orderMatch.total_amount)}đ${vchPart}\n` +
          `• Thời gian đặt: ${new Date(orderMatch.created_at).toLocaleString("vi-VN")}\n` +
          `Nếu cần đổi giờ nhận hàng, bạn có thể nhắn tại mục Liên hệ hoặc gọi 0383.505.924 nhé!`,
        actions: [{ type: "scroll_section", label: "📞 Tới mục Liên hệ", target: "#contact" }],
        suggestions: ["Mã giảm giá hôm nay", "Cách pha Sữa đá ngon", "Chính sách đổi trả"]
      };
    }
    return {
      reply:
        `Mình chưa tìm thấy mã đơn "${askedOrderCode}" trên hệ thống. Bạn kiểm tra lại đúng định dạng mã đơn (ví dụ RM-2026-0001) hoặc đăng nhập vào trang Tài khoản để xem toàn bộ lịch sử đơn hàng của mình nhé!`,
      actions: [],
      suggestions: ["Giá 1 hộp bao nhiêu?", "Có mã voucher nào không?", "Phí giao hàng thế nào?"]
    };
  }

  if (hasAny(q, ["tra cuu", "kiem tra don", "don hang cua toi", "tinh trang don", "theo doi don"])) {
    return {
      reply:
        "Để kiểm tra nhanh tiến độ đơn hàng, bạn chỉ cần nhắn thẳng Mã đơn hàng (bắt đầu bằng chữ RM-...) vào khung chat này, hoặc bấm vào mục Tài khoản ở góc trên để xem lịch sử đơn đã đặt nhé!",
      actions: [],
      suggestions: ["Giá & tồn kho hiện tại", "Mã giảm giá hôm nay", "Thời gian giao hàng"]
    };
  }

  const parts: string[] = [];

  // 2. Price / Quantity per box / Combo 2 boxes / Stock
  if (hasAny(q, ["gia", "bao nhieu tien", "bn tien", "1 hop", "mot hop", "2 hop", "hai hop", "combo", "quy cach", "may goi", "may ly", "bao nhieu gam", "khoi luong", "trong luong", "ton kho", "con hang", "het hang", "mua", "dat hang", "chot don"])) {
    const stockLine = inStock
      ? `Hiện kho đang sẵn sàng ${product.stock_quantity} hộp để giao ngay.`
      : "Hiện lô rang này đang tạm hết hàng, xưởng đang chuẩn bị mẻ rang mới.";
    let comboTip = "";
    if (inStock && vouchers.length > 0 && hasAny(q, ["2 hop", "hai hop", "combo", "mua nhieu"])) {
      const twoBox = product.price * 2;
      let bestV: VoucherSnapshot | null = null;
      let bestDisc = 0;
      for (const v of vouchers) {
        const d = calcVoucherSaving(v, twoBox);
        if (d > bestDisc) {
          bestDisc = d;
          bestV = v;
        }
      }
      if (bestV && bestDisc > 0) {
        comboTip = `\n• 💡 Ưu đãi 2 hộp: Tạm tính ${fmtVnd(twoBox)}đ → áp mã ${bestV.code} giảm ${fmtVnd(bestDisc)}đ, chỉ còn ${fmtVnd(twoBox - bestDisc)}đ!`;
        actions.push({ type: "apply_voucher", label: `🏷️ Mua 2 hộp & Áp mã ${bestV.code}`, code: bestV.code });
      }
    }
    parts.push(
      `☕ ${product.name} (hộp 10 túi phin giấy × 12g cà phê nguyên chất = 10 ly):\n` +
      `• Giá niêm yết hiện tại: ${fmtVnd(product.price)}đ/hộp (chỉ khoảng ${fmtVnd(pricePerCup)}đ cho 1 ly cà phê đặc sản Măng Đen, miễn phí ship toàn quốc).\n` +
      `• Tình trạng kho: ${stockLine}${comboTip}`
    );
    if (inStock) {
      actions.push({ type: "add_to_cart", label: `🛒 Thêm vào giỏ (${fmtVnd(product.price)}đ)` });
    }
  }

  // 3. Voucher / Discount / Promo codes
  if (hasAny(q, ["voucher", "ma giam", "khuyen mai", "uu dai", "giam gia", "code", "sale", "deal"])) {
    if (vouchers.length > 0) {
      const lines = vouchers.slice(0, 4).map((v) => {
        const valText = v.discount_type === "percent"
          ? `giảm ${v.discount_value}%` + (v.max_discount_amount ? ` (tối đa ${fmtVnd(v.max_discount_amount)}đ)` : "")
          : `giảm trực tiếp ${fmtVnd(v.discount_value)}đ`;
        return `• ${v.code}: ${valText} — đơn tối thiểu ${fmtVnd(v.min_order_amount)}đ`;
      });
      parts.push(
        `🏷️ Các mã Voucher đang mở áp dụng trực tiếp trên hệ thống:\n${lines.join("\n")}\n` +
        `Bạn có thể bấm nút bên dưới để tự động thêm sản phẩm và áp mã ngay!`
      );
      vouchers.slice(0, 2).forEach((v) => {
        actions.push({ type: "apply_voucher", label: `🏷️ Áp mã ${v.code}`, code: v.code });
      });
    } else {
      parts.push("Hiện cửa hàng chưa có mã giảm giá mới, nhưng mọi đơn hàng đều đang được Miễn phí giao hàng toàn quốc 🎉.");
    }
  }

  // 4. Brewing recipes (Cold brew / Milk coffee / Iced black / Hot pour-over)
  if (hasAny(q, ["cold brew", "coldbrew", "u lanh"])) {
    parts.push(
      "❄️ Công thức Cold Brew thanh mát bằng phin giấy Rang Mây:\n" +
      "1. Đặt 1–2 túi phin giấy với 180–220ml nước lọc mát trong bình kín.\n" +
      "2. Ủ trong ngăn mát tủ lạnh 8–12 tiếng qua đêm.\n" +
      "3. Nhấc túi lọc ra, thêm đá viên và 1 lát cam vàng hoặc chút đường phèn — vị ngọt hậu trái cây chín mở ra cực kỳ sảng khoái!"
    );
  } else if (hasAny(q, ["sua da", "bac xiu", "pha sua", "latte", "cappuccino", "capuchino", "sua tuoi"])) {
    parts.push(
      "🥛 Bí quyết pha Cà phê Sữa Đá đậm vị bằng phin giấy:\n" +
      "1. Cho sẵn 20–25ml sữa đặc vào đáy ly.\n" +
      "2. Cài quai phin giấy lên miệng ly, rót 25ml nước sôi 92–95°C ủ cà phê nở đều trong 25 giây.\n" +
      "3. Rót chậm thêm 65–75ml nước nóng (tổng ~95ml cốt đậm hơn pha nóng thường).\n" +
      "4. Khuấy đều cốt cà phê nóng với sữa đặc cho dậy mùi caramel rồi thêm đá già đầy ly!"
    );
  } else if (hasAny(q, ["den da", "pha da", "uong da"])) {
    parts.push(
      "🧊 Cách pha Cà phê Đen Đá đậm thơm không bị nhạt:\n" +
      "1. Gài phin giấy lên ly, ủ 25ml nước nóng 92–95°C trong 25 giây cho bột nở đều.\n" +
      "2. Rót chậm thêm 70–80ml nước nóng (tổng ~100ml nước cốt cô đặc).\n" +
      "3. Thêm 1 thìa nhỏ đường (tùy gu), đánh mạnh tạo lớp bọt nâu mịn rồi rót vào ly đầy đá viên già!"
    );
  } else if (hasAny(q, ["cach pha", "huong dan pha", "cong thuc", "nhiet do", "bao nhieu ml", "pha nong", "pha phin"])) {
    parts.push(
      "☕ Chuẩn 4 bước pha Cà phê Phin Giấy nóng trọn vị:\n" +
      "1. Xé miệng túi theo đường cắt sẵn, kéo 2 quai giấy gài chắc lên thành ly.\n" +
      "2. Ủ (Bloom): Rót nhẹ ~30ml nước nóng 90–95°C thấm đều bột, chờ 25–30 giây.\n" +
      "3. Chiết xuất: Rót từ tốn thêm 120–140ml nước nóng theo vòng tròn xoắn ốc.\n" +
      "4. Đợi nước rút hết (khoảng 2–3 phút), nhấc túi phin ra và thưởng thức khi còn ấm!"
    );
  }

  // 5. Flavor profile / Sourness / Bitterness / Caffeine / Stomach / Sleep
  if (hasAny(q, ["chua", "dang", "huong vi", "vi gi", "chocolate", "caramel", "arabica", "robusta", "caffeine", "mat ngu", "say ca phe", "da day"])) {
    parts.push(
      "🍫 Về hạt & nốt hương vị của Rang Mây:\n" +
      "• Tuyển chọn hạt Arabica vùng cao Măng Đen (độ cao ~1.200m) rang mộc chậm ở mức Vừa–Đậm (Medium-Dark).\n" +
      "• Hương thơm tự nhiên của chocolate đen, caramel và đường nâu; vị cân bằng êm dịu, KHÔNG chua gắt và hậu vị ngọt thanh.\n" +
      "• Hàm lượng caffeine vừa phải (~1,2–1,5%), không tẩm hóa chất hay bơ phụ gia nên rất êm dạ dày, ít gây hồi hộp. Nếu nhạy cảm giấc ngủ, bạn nên thưởng thức trước 15h chiều nhé!"
    );
  }

  // 6. Origin / Purity / Shelf-life / Storage
  if (hasAny(q, ["nguon goc", "mang den", "kon tum", "nguyen chat", "phu gia", "tam uop", "han su dung", "hsd", "bao quan", "de duoc bao lau"])) {
    parts.push(
      "🌲 Nguồn gốc & Bảo quản:\n" +
      "• 100% cà phê rang xay nguyên chất từ vùng đất sương mù Măng Đen – Kon Tum, cam kết 3 KHÔNG: Không hương liệu tổng hợp, Không độn bắp/đậu, Không chất bảo quản.\n" +
      "• Mỗi phin giấy được đóng gói kín riêng biệt giúp giữ trọn hương thơm suốt 12 tháng kể từ ngày sản xuất (ngon nhất trong 6 tháng đầu, bảo quản nơi khô mát tránh nắng)."
    );
  }

  // 7. Shipping / Payment / Return policy
  if (hasAny(q, ["ship", "giao hang", "van chuyen", "bao lau nhan", "phi ship", "freeship", "thanh toan", "cod", "chuyen khoan", "doi tra", "hoan tien", "bao hanh"])) {
    parts.push(
      "🚚 Chính sách Giao hàng, Thanh toán & Đổi trả:\n" +
      "• Giao hàng: MIỄN PHÍ giao hàng toàn quốc cho mọi đơn hàng! Thời gian nhận dự kiến 1–2 ngày (TP.HCM & trung tâm) hoặc 2–4 ngày (các tỉnh thành khác).\n" +
      "• Thanh toán: Nhận hàng kiểm tra ngoại quan rồi mới thanh toán tiền mặt (COD) cực kỳ an tâm.\n" +
      "• Đổi trả: Hỗ trợ đổi mới 1–1 miễn phí trong vòng 7 ngày nếu hộp bị móp rách do vận chuyển hoặc lỗi bao bì từ nhà sản xuất."
    );
  }

  // 8. Music & Pastry Pairing / Gift Card / Wholesale
  if (hasAny(q, ["am nhac", "nhac", "banh", "an kem", "pairing"])) {
    parts.push(
      "🎵 Gợi ý thưởng thức (Pairing):\n" +
      "Ly Rang Mây ấm nồng hợp nhất khi đi cùng nhạc Acoustic mộc mạc, Jazz piano hoặc Lo-fi ngày mưa, nhâm nhi kèm bánh sừng bò bơ (Croissant), bánh quy hạnh nhân hoặc Tiramisu ít ngọt."
    );
  }

  if (hasAny(q, ["thiep", "qua tang", "bieu", "sinh nhat", "mua si", "so luong lon", "doanh nghiep", "lien he", "hotline", "so dien thoai", "zalo", "dia chi"])) {
    parts.push(
      "🎁 Quà tặng & Liên hệ nhanh:\n" +
      "• Khi bấm Thanh toán trên web, bạn có thể tích chọn 'Gửi kèm thiệp chúc mừng viết bằng AI' hoàn toàn miễn phí!\n" +
      "• Đặt sỉ / quà tặng doanh nghiệp hoặc cần hỗ trợ gấp: gọi/Zalo 0383.505.924 hoặc email hello@rangmaycoffee.vn."
    );
    actions.push({ type: "scroll_section", label: "📩 Gửi tin nhắn liên hệ", target: "#contact" });
  }

  if (parts.length > 0) {
    return {
      reply: parts.join("\n\n"),
      actions: actions.slice(0, 3),
      suggestions: [
        "Có mã giảm giá nào không?",
        "Cách pha Cà phê Sữa đá",
        "Cà phê có chua hay say không?",
        "Giao hàng mất bao lâu?"
      ]
    };
  }

  // 9. Greeting / Bot Identity / Thank you / General conversational fallback
  if (hasAny(q, ["xin chao", "chao", "hello", "hi", "hey", "alo", "shop oi", "ad oi", "tu van", "ban la ai", "lam duoc gi"])) {
    return {
      reply:
        `Xin chào bạn! Mình là Trợ lý Barista AI của Rang Mây Coffee ☁️\n` +
        `Hiện hộp Cà phê phin giấy Măng Đen (10 gói) đang có giá ${fmtVnd(product.price)}đ (còn ${product.stock_quantity} hộp, miễn phí giao hàng` +
        (vouchers.length > 0 ? ` và có sẵn mã ưu đãi như ${vouchers[0].code}` : "") +
        `).\nBạn thường thích uống Đen nóng nguyên bản, Sữa đá đậm đà hay Cold Brew thanh mát để mình gợi ý cách pha chuẩn gu nhất?`,
      actions: inStock ? [{ type: "add_to_cart", label: `🛒 Thêm 1 hộp (${fmtVnd(product.price)}đ)` }] : [],
      suggestions: ["Pha Sữa đá sao cho ngon?", "Cho mình xin mã Voucher", "Cà phê có chua không?"]
    };
  }

  if (hasAny(q, ["cam on", "thank", "tks", "ok", "tuyet", "ngon", "hay qua"])) {
    return {
      reply:
        "Rất vui được đồng hành cùng bạn! Chúc bạn có những phút giây thưởng thức cà phê thật bình yên và trọn vị. Cần mã ưu đãi hay công thức pha chế nào cứ nhắn mình bất cứ lúc nào nhé! ☕✨",
      actions: [],
      suggestions: ["Xem mã giảm giá hôm nay", "Cách làm Cold Brew ủ lạnh"]
    };
  }

  // Smart helpful catch-all grounded with live store summary
  return {
    reply:
      `Cảm ơn câu hỏi của bạn! Với dòng ${product.name} (${fmtVnd(product.price)}đ/hộp 10 gói, hiện còn ${product.stock_quantity} hộp), mình có thể hỗ trợ ngay cho bạn các thông tin:\n` +
      `• 🏷️ Săn mã Voucher giảm giá đang mở (${vouchers.map((v) => v.code).join(", ") || "Freeship"})\n` +
      `• ☕ Công thức pha Đen nóng, Sữa đá, Bạc xỉu hoặc Cold Brew\n` +
      `• 📦 Tra cứu nhanh đơn hàng (chỉ cần nhắn mã RM-...)\n` +
      `• 🚚 Chính sách Freeship toàn quốc, COD & đổi trả 7 ngày\n` +
      `Bạn muốn tìm hiểu mục nào trước để mình giải đáp chi tiết nhé?`,
    actions: inStock ? [{ type: "add_to_cart", label: `🛒 Đặt thử 1 hộp (${fmtVnd(product.price)}đ)` }] : [],
    suggestions: ["Cho mình xin mã giảm giá", "Cách pha Cà phê Sữa đá", "Hương vị có chua không?"]
  };
}

async function tryGeminiBaristaReply(
  apiKey: string,
  message: string,
  history: Array<{ role: string; text: string }>,
  product: ProductSnapshot,
  vouchers: VoucherSnapshot[],
  orderMatch: { order_number: string; status: string; total_amount: number; created_at: string } | null
): Promise<string | null> {
  try {
    const voucherLines = vouchers
      .map((v) =>
        v.discount_type === "percent"
          ? `${v.code}: giảm ${v.discount_value}% (đơn từ ${fmtVnd(v.min_order_amount)}đ${v.max_discount_amount ? `, tối đa ${fmtVnd(v.max_discount_amount)}đ` : ""})`
          : `${v.code}: giảm ${fmtVnd(v.discount_value)}đ (đơn từ ${fmtVnd(v.min_order_amount)}đ)`
      )
      .join("; ");

    const systemInstruction =
      `Bạn là Nghệ Nhân Barista AI chính thức của thương hiệu Rang Mây Coffee (cà phê phin giấy đặc sản từ Măng Đen – Kon Tum, cao 1.200m, hạt Arabica rang mộc vừa-đậm nốt hương chocolate đen & caramel, hậu ngọt thanh, không hương liệu/phụ gia).\n` +
      `Dữ liệu cửa hàng THỜI GIAN THỰC hiện tại:\n` +
      `- Sản phẩm: ${product.name} (Hộp 10 túi phin giấy x 12g) | Giá: ${fmtVnd(product.price)}đ | Tồn kho: ${product.stock_quantity} hộp | Mở bán: ${product.is_available ? "Có" : "Tạm hết"}.\n` +
      `- Mã giảm giá (Voucher) đang hoạt động: ${voucherLines || "Hiện chưa có mã"}.\n` +
      `- Chính sách: Miễn phí giao hàng toàn quốc (1-4 ngày), thanh toán COD khi nhận hàng, đổi trả 1-1 trong 7 ngày nếu lỗi bao bì. Liên hệ: 0383.505.924 / hello@rangmaycoffee.vn.\n` +
      (orderMatch
        ? `- Tra cứu đơn khách vừa hỏi (${orderMatch.order_number}): Trạng thái = ${ORDER_STATUS_VI[orderMatch.status] || orderMatch.status}, Tổng tiền = ${fmtVnd(orderMatch.total_amount)}đ.\n`
        : "") +
      `Quy tắc: Trả lời tiếng Việt ấm áp, tinh tế, súc tích (dưới 130 từ), đúng 100% giá/tồn kho/voucher thực tế ở trên, tuyệt đối không bịa mã giảm giá hay chính sách ngoài danh sách, chỉ trả văn bản thuần (không dùng bảng Markdown hay HTML).`;

    const contents = [
      ...history.slice(-6).map((h) => ({
        role: h.role === "ai" || h.role === "model" ? "model" : "user",
        parts: [{ text: String(h.text || "").slice(0, 500) }]
      })),
      { role: "user", parts: [{ text: message }] }
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.55, maxOutputTokens: 320 }
        })
      }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
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
    const allowed = await checkRateLimit(db, `barista:${ipHash}`, 35, 300);
    if (!allowed) {
      return jsonResponse({ error: "Barista AI đang pha chế nhiều câu trả lời, bạn chờ vài giây rồi hỏi tiếp nhé!" }, 429, cors);
    }

    const body = await readJson(request) as Record<string, unknown>;
    if (body.mode === "gift_card") {
      const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
      const occasion = typeof body.occasion === "string" ? body.occasion.trim() : "dịp đặc biệt";
      const style = typeof body.style === "string" ? body.style.trim() : "poetic";
      if (!recipient || recipient.length > 80) {
        return jsonResponse({ error: "Vui lòng nhập tên người nhận hợp lệ." }, 400, cors);
      }
      return jsonResponse({
        giftMessage: generateSmartGiftCard(recipient, occasion, style)
      }, 200, cors);
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 600) {
      return jsonResponse({ error: "Câu hỏi vui lòng từ 1 đến 600 ký tự." }, 400, cors);
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history = rawHistory
      .filter((item): item is { role: string; text: string } => Boolean(item && typeof item === "object"))
      .slice(-6);

    const [prodRes, vchRes] = await Promise.all([
      db.from("store_products")
        .select("id, name, price, stock_quantity, is_available, badge_text")
        .eq("id", "drip-pack-001")
        .maybeSingle(),
      db.from("store_vouchers")
        .select("code, description, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, used_count, expires_at, is_active")
        .eq("is_active", true)
        .order("min_order_amount", { ascending: true })
    ]);

    const product: ProductSnapshot = (!prodRes.error && prodRes.data)
      ? (prodRes.data as ProductSnapshot)
      : {
          id: "drip-pack-001",
          name: "Cà phê phin giấy Rang Mây",
          price: 119000,
          stock_quantity: 50,
          is_available: true,
          badge_text: "Phin giấy tiện lợi, minh bạch lô sản xuất"
        };

    const nowMs = Date.now();
    const vouchers: VoucherSnapshot[] = (!vchRes.error && vchRes.data)
      ? vchRes.data
          .filter((v) => v.is_active && v.used_count < v.usage_limit && (!v.expires_at || Date.parse(v.expires_at) > nowMs))
          .map((v) => ({
            code: v.code,
            description: v.description,
            discount_type: v.discount_type,
            discount_value: v.discount_value,
            min_order_amount: v.min_order_amount,
            max_discount_amount: v.max_discount_amount
          }))
      : [];

    // Safe order lookup (ONLY status/amount/date, NEVER customer PII!)
    const codeMatch = message.toUpperCase().match(/\bRM-\d{4,8}-\d{4,6}\b/);
    const askedOrderCode = codeMatch ? codeMatch[0] : null;
    let orderMatch = null;
    if (askedOrderCode) {
      const { data: ord } = await db
        .from("orders")
        .select("order_number, status, total_amount, discount_amount, voucher_code, created_at")
        .eq("order_number", askedOrderCode)
        .maybeSingle();
      if (ord) orderMatch = ord;
    }

    const deterministic = buildGroundedBaristaResponse(message, product, vouchers, orderMatch, askedOrderCode);
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
    if (geminiKey) {
      const llmReply = await tryGeminiBaristaReply(geminiKey, message, history, product, vouchers, orderMatch);
      if (llmReply) {
        return jsonResponse({
          reply: llmReply,
          actions: deterministic.actions,
          suggestions: deterministic.suggestions,
          engine: "gemini-2.5-flash"
        }, 200, cors);
      }
    }

    return jsonResponse({
      reply: deterministic.reply,
      actions: deterministic.actions,
      suggestions: deterministic.suggestions,
      engine: "rangmay-smart-nlu"
    }, 200, cors);
  } catch {
    return jsonResponse({ error: "Barista AI tạm bận trong giây lát, bạn thử gửi lại câu hỏi nhé!" }, 400, cors);
  }
});
