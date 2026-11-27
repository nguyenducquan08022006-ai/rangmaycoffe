import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import selfsigned from "selfsigned";
import QRCode from "qrcode";
import { buildOtpAuthUri, generateBase32Secret, verifyTotpCode } from "./totp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const DEFAULT_CATALOG = [
  {
    id: "drip-pack-001",
    sku: "RM-DRIP-001",
    name: "Rang Mây Bản Giao Hưởng",
    price: 119000,
    stock_quantity: 50,
    is_available: true,
    badge_text: "Best Seller • Cân bằng êm dịu",
    updated_at: new Date().toISOString(),
    updated_by: "system"
  },
  {
    id: "drip-pack-002",
    sku: "RM-DRIP-002",
    name: "Rang Mây Đại Ngàn (Gu Đậm Sữa Đá)",
    price: 109000,
    stock_quantity: 45,
    is_available: true,
    badge_text: "Đậm đà • Chuyên Sữa đá & Bạc xỉu",
    updated_at: new Date().toISOString(),
    updated_by: "system"
  },
  {
    id: "drip-pack-003",
    sku: "RM-DRIP-003",
    name: "Rang Mây Sương Sớm (100% Arabica)",
    price: 145000,
    stock_quantity: 35,
    is_available: true,
    badge_text: "Specialty 1.200m • Hợp Cold Brew",
    updated_at: new Date().toISOString(),
    updated_by: "system"
  },
  {
    id: "gift-box-004",
    sku: "RM-GIFT-004",
    name: "Hộp Quà Tinh Hoa Măng Đen (Mix 3 Vị)",
    price: 269000,
    stock_quantity: 25,
    is_available: true,
    badge_text: "Quà biếu cao cấp • 24 gói đủ 3 vị",
    updated_at: new Date().toISOString(),
    updated_by: "system"
  }
];

const DEFAULT_VOUCHERS = [
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
    is_active: true,
    updated_by: "system"
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
    is_active: true,
    updated_by: "system"
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
    is_active: true,
    updated_by: "system"
  }
];

const ORDER_STATUS_VI_CHAT = Object.freeze({
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận (đang chuẩn bị hàng)",
  shipped: "Đang giao hàng",
  completed: "Đã giao hoàn tất",
  cancelled: "Đã hủy"
});

function fmtVndChat(n) {
  return Number(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function foldViChat(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyChat(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

function generateSmartGiftCard(recipient, occasion, style) {
  const cleanName = String(recipient || "").slice(0, 60);
  const cleanOcc = String(occasion || "dịp đặc biệt").slice(0, 80);
  const occLower = cleanOcc.toLowerCase();
  if (style === "warm") {
    return `Thân gửi ${cleanName} nhân ${occLower},\nGiữa nhịp sống bận rộn, mong rằng từng giọt cà phê Măng Đen ấm nồng từ Rang Mây sẽ mang đến cho bạn phút giây thư thái, trọn vẹn niềm vui và thật nhiều năng lượng lành.`;
  }
  if (style === "gentle") {
    return `Gửi ${cleanName} lời chúc dịu êm nhất nhân ${occLower}.\nChúc bạn luôn giữ được khoảng lặng bình yên trong tâm hồn, để mỗi sớm mai thức dậy đều nhẹ nhàng và ngọt hậu như tách Arabica vùng cao.`;
  }
  return `Gửi ${cleanName} từ đại ngàn Măng Đen mây phủ nhân ${occLower},\nNhư sương sớm ấp ôm triền đồi bazan, chúc những tháng ngày sắp tới của bạn luôn đong đầy cảm hứng, thơm nồng nốt hương hạnh phúc và dịu êm trên mọi hành trình.`;
}

function calcVoucherSavingChat(v, subtotal) {
  if (subtotal < Number(v.min_order_amount || 0)) return 0;
  if (v.discount_type === "percent") {
    let raw = Math.round((subtotal * Number(v.discount_value || 0)) / 100);
    if (v.max_discount_amount && raw > v.max_discount_amount) raw = v.max_discount_amount;
    return Math.min(subtotal, Math.max(0, raw));
  }
  return Math.min(subtotal, Math.max(0, Number(v.discount_value || 0)));
}

function buildGroundedBaristaResponse(rawMessage, products, vouchers, orderMatch, askedOrderCode) {
  const q = foldViChat(rawMessage);
  const actions = [];
  const list = Array.isArray(products) && products.length > 0 ? products : DEFAULT_CATALOG;
  const pSignature = list.find((p) => p.id === "drip-pack-001") || list[0];
  const pStrong = list.find((p) => p.id === "drip-pack-002") || pSignature;
  const pArabica = list.find((p) => p.id === "drip-pack-003") || pSignature;
  const pGift = list.find((p) => p.id === "gift-box-004") || pSignature;

  if (askedOrderCode) {
    if (orderMatch) {
      const stLabel = ORDER_STATUS_VI_CHAT[orderMatch.status] || orderMatch.status;
      const vchPart = orderMatch.voucher_code && Number(orderMatch.discount_amount) > 0
        ? ` (đã áp mã ${orderMatch.voucher_code} giảm ${fmtVndChat(Number(orderMatch.discount_amount))}đ)`
        : "";
      return {
        reply:
          `📦 Tra cứu đơn hàng ${orderMatch.order_number}:\n` +
          `• Trạng thái hiện tại: ${stLabel}\n` +
          `• Tổng thanh toán COD: ${fmtVndChat(orderMatch.total_amount)}đ${vchPart}\n` +
          `• Thời gian đặt: ${new Date(orderMatch.created_at).toLocaleString("vi-VN")}\n` +
          `Nếu cần đổi giờ nhận hàng, bạn có thể nhắn tại mục Liên hệ hoặc gọi 0383.505.924 nhé!`,
        actions: [{ type: "scroll_section", label: "📞 Tới mục Liên hệ", target: "#contact" }],
        suggestions: ["Xem 4 dòng sản phẩm", "Mã giảm giá hôm nay", "Chính sách đổi trả"]
      };
    }
    return {
      reply:
        `Mình chưa tìm thấy mã đơn "${askedOrderCode}" trên hệ thống. Bạn kiểm tra lại đúng định dạng mã đơn (ví dụ RM-2026-0001) hoặc đăng nhập vào trang Tài khoản để xem toàn bộ lịch sử đơn hàng của mình nhé!`,
      actions: [],
      suggestions: ["Các dòng cà phê & giá bán", "Có mã voucher nào không?", "Phí giao hàng thế nào?"]
    };
  }

  if (hasAnyChat(q, ["tra cuu", "kiem tra don", "don hang cua toi", "tinh trang don", "theo doi don"])) {
    return {
      reply:
        "Để kiểm tra nhanh tiến độ đơn hàng, bạn chỉ cần nhắn thẳng Mã đơn hàng (bắt đầu bằng chữ RM-...) vào khung chat này, hoặc bấm vào mục Tài khoản ở góc trên để xem lịch sử đơn đã đặt nhé!",
      actions: [],
      suggestions: ["Xem bảng giá 4 dòng cà phê", "Mã giảm giá hôm nay", "Thời gian giao hàng"]
    };
  }

  const parts = [];

  if (hasAnyChat(q, ["gia", "bao nhieu tien", "bn tien", "1 hop", "mot hop", "2 hop", "hai hop", "combo", "may loai", "cac dong", "menu", "danh muc", "san pham", "quy cach", "may goi", "may ly", "bao nhieu gam", "khoi luong", "trong luong", "ton kho", "con hang", "het hang", "mua", "dat hang", "chot don"])) {
    const catalogLines = list.map((p) => {
      const st = p.is_available && p.stock_quantity > 0 ? `còn ${p.stock_quantity} hộp` : "tạm hết";
      return `• ${p.name}: ${fmtVndChat(p.price)}đ (${st})`;
    });
    let comboTip = "";
    if (pSignature.is_available && pSignature.stock_quantity > 0 && vouchers.length > 0 && hasAnyChat(q, ["2 hop", "hai hop", "combo", "mua nhieu"])) {
      const twoBox = pSignature.price * 2;
      let bestV = null;
      let bestDisc = 0;
      for (const v of vouchers) {
        const d = calcVoucherSavingChat(v, twoBox);
        if (d > bestDisc) {
          bestDisc = d;
          bestV = v;
        }
      }
      if (bestV && bestDisc > 0) {
        comboTip = `\n💡 Ưu đãi mua 2 hộp ${pSignature.name}: Tạm tính ${fmtVndChat(twoBox)}đ → áp mã ${bestV.code} giảm ${fmtVndChat(bestDisc)}đ, chỉ còn ${fmtVndChat(twoBox - bestDisc)}đ!`;
        actions.push({ type: "apply_voucher", label: `🏷️ Mua 2 hộp & Áp mã ${bestV.code}`, code: bestV.code, productId: pSignature.id });
      }
    }
    parts.push(
      `☕ Bộ sưu tập Cà phê Phin Giấy Rang Mây hiện có ${list.length} lựa chọn (Miễn phí giao hàng toàn quốc):\n` +
      `${catalogLines.join("\n")}${comboTip}`
    );
    if (pSignature.is_available && pSignature.stock_quantity > 0) {
      actions.push({ type: "add_to_cart", productId: pSignature.id, label: `🛒 Thêm Bản Giao Hưởng (${fmtVndChat(pSignature.price)}đ)` });
    }
    if (pGift && pGift.id !== pSignature.id && pGift.is_available && pGift.stock_quantity > 0 && hasAnyChat(q, ["hop qua", "mix", "qua bieu", "may loai", "cac dong"])) {
      actions.push({ type: "add_to_cart", productId: pGift.id, label: `🎁 Thêm Hộp Quà 24 gói (${fmtVndChat(pGift.price)}đ)` });
    }
  }

  if (hasAnyChat(q, ["voucher", "ma giam", "khuyen mai", "uu dai", "giam gia", "code", "sale", "deal"])) {
    if (vouchers.length > 0) {
      const lines = vouchers.slice(0, 4).map((v) => {
        const valText = v.discount_type === "percent"
          ? `giảm ${v.discount_value}%` + (v.max_discount_amount ? ` (tối đa ${fmtVndChat(v.max_discount_amount)}đ)` : "")
          : `giảm trực tiếp ${fmtVndChat(v.discount_value)}đ`;
        return `• ${v.code}: ${valText} — đơn tối thiểu ${fmtVndChat(v.min_order_amount)}đ`;
      });
      parts.push(
        `🏷️ Các mã Voucher đang mở áp dụng trực tiếp trên hệ thống:\n${lines.join("\n")}\n` +
        `Bạn có thể bấm nút bên dưới để tự động thêm sản phẩm và áp mã ngay!`
      );
      vouchers.slice(0, 2).forEach((v) => {
        actions.push({ type: "apply_voucher", label: `🏷️ Áp mã ${v.code}`, code: v.code, productId: pSignature.id });
      });
    } else {
      parts.push("Hiện cửa hàng chưa có mã giảm giá mới, nhưng mọi đơn hàng đều đang được Miễn phí giao hàng toàn quốc 🎉.");
    }
  }

  if (hasAnyChat(q, ["cold brew", "coldbrew", "u lanh", "suong som"])) {
    parts.push(
      `❄️ Công thức Cold Brew thanh mát (hợp nhất với dòng ${pArabica.name} – ${fmtVndChat(pArabica.price)}đ):\n` +
      "1. Đặt 1–2 túi phin giấy với 180–220ml nước lọc mát trong bình kín.\n" +
      "2. Ủ trong ngăn mát tủ lạnh 8–12 tiếng qua đêm.\n" +
      "3. Nhấc túi lọc ra, thêm đá viên và 1 lát cam vàng — hương hoa trắng & trái cây chín của 100% Arabica Măng Đen mở ra cực kỳ sảng khoái!"
    );
    if (pArabica.is_available && pArabica.stock_quantity > 0) {
      actions.push({ type: "add_to_cart", productId: pArabica.id, label: `🛒 Thêm Sương Sớm Arabica (${fmtVndChat(pArabica.price)}đ)` });
    }
  } else if (hasAnyChat(q, ["sua da", "bac xiu", "pha sua", "latte", "cappuccino", "capuchino", "sua tuoi", "dai ngan", "gu dam"])) {
    parts.push(
      `🥛 Bí quyết pha Cà phê Sữa Đá đậm vị (chuẩn nhất với dòng ${pStrong.name} – ${fmtVndChat(pStrong.price)}đ):\n` +
      "1. Cho sẵn 20–25ml sữa đặc vào đáy ly.\n" +
      "2. Cài quai phin giấy lên miệng ly, rót 25ml nước sôi 92–95°C ủ cà phê nở đều trong 25 giây.\n" +
      "3. Rót chậm thêm 65–75ml nước nóng thu cốt cà phê sánh đậm.\n" +
      "4. Khuấy đều cốt nóng với sữa đặc cho dậy mùi bơ cacao rồi thêm đá già đầy ly!"
    );
    if (pStrong.is_available && pStrong.stock_quantity > 0) {
      actions.push({ type: "add_to_cart", productId: pStrong.id, label: `🛒 Thêm Đại Ngàn Sữa Đá (${fmtVndChat(pStrong.price)}đ)` });
    }
  } else if (hasAnyChat(q, ["den da", "pha da", "uong da"])) {
    parts.push(
      "🧊 Cách pha Cà phê Đen Đá đậm thơm không bị nhạt:\n" +
      "1. Gài phin giấy lên ly, ủ 25ml nước nóng 92–95°C trong 25 giây cho bột nở đều.\n" +
      "2. Rót chậm thêm 70–80ml nước nóng (tổng ~100ml nước cốt cô đặc).\n" +
      "3. Thêm 1 thìa nhỏ đường (tùy gu), đánh mạnh tạo lớp bọt nâu mịn rồi rót vào ly đầy đá viên già!"
    );
  } else if (hasAnyChat(q, ["cach pha", "huong dan pha", "cong thuc", "nhiet do", "bao nhieu ml", "pha nong", "pha phin"])) {
    parts.push(
      "☕ Chuẩn 4 bước pha Cà phê Phin Giấy nóng trọn vị:\n" +
      "1. Xé miệng túi theo đường cắt sẵn, kéo 2 quai giấy gài chắc lên thành ly.\n" +
      "2. Ủ (Bloom): Rót nhẹ ~30ml nước nóng 90–95°C thấm đều bột, chờ 25–30 giây.\n" +
      "3. Chiết xuất: Rót từ tốn thêm 120–140ml nước nóng theo vòng tròn xoắn ốc.\n" +
      "4. Đợi nước rút hết (khoảng 2–3 phút), nhấc túi phin ra và thưởng thức khi còn ấm!"
    );
  }

  if (hasAnyChat(q, ["chua", "dang", "huong vi", "vi gi", "chocolate", "caramel", "arabica", "robusta", "caffeine", "mat ngu", "say ca phe", "da day", "chon loai nao", "hop gu"])) {
    parts.push(
      "🍫 Gợi ý chọn đúng dòng Rang Mây hợp gu bạn nhất:\n" +
      `• Thích cân bằng, thơm chocolate & caramel, KHÔNG chua gắt: chọn ${pSignature.name} (${fmtVndChat(pSignature.price)}đ).\n` +
      `• Thích đậm sánh, hậu dày, pha Sữa đá / Bạc xỉu: chọn ${pStrong.name} (${fmtVndChat(pStrong.price)}đ).\n` +
      `• Thích thanh nhẹ, thơm hương hoa & trái cây chín, ít đắng, êm dạ dày: chọn ${pArabica.name} (${fmtVndChat(pArabica.price)}đ).\n` +
      `• Muốn thử đủ cả 3 vị hoặc làm quà biếu: chọn ${pGift.name} (${fmtVndChat(pGift.price)}đ – áp ngay được mã VIP50K giảm 50.000đ!).`
    );
  }

  if (hasAnyChat(q, ["nguon goc", "mang den", "kon tum", "nguyen chat", "phu gia", "tam uop", "han su dung", "hsd", "bao quan", "de duoc bao lau"])) {
    parts.push(
      "🌲 Nguồn gốc & Bảo quản:\n" +
      "• 100% cà phê rang xay nguyên chất từ vùng đất sương mù Măng Đen – Kon Tum, cam kết 3 KHÔNG: Không hương liệu tổng hợp, Không độn bắp/đậu, Không chất bảo quản.\n" +
      "• Mỗi phin giấy được đóng gói kín riêng biệt giúp giữ trọn hương thơm suốt 12 tháng kể từ ngày sản xuất."
    );
  }

  if (hasAnyChat(q, ["ship", "giao hang", "van chuyen", "bao lau nhan", "phi ship", "freeship", "thanh toan", "cod", "chuyen khoan", "doi tra", "hoan tien", "bao hanh"])) {
    parts.push(
      "🚚 Chính sách Giao hàng, Thanh toán & Đổi trả:\n" +
      "• Giao hàng: MIỄN PHÍ giao hàng toàn quốc cho mọi đơn hàng! Nhận hàng sau 1–2 ngày (TP.HCM) hoặc 2–4 ngày (các tỉnh khác).\n" +
      "• Thanh toán: Nhận hàng kiểm tra rồi mới thanh toán tiền mặt (COD).\n" +
      "• Đổi trả: Đổi mới 1–1 miễn phí trong 7 ngày nếu lỗi bao bì hoặc móp rách do vận chuyển."
    );
  }

  if (hasAnyChat(q, ["am nhac", "nhac", "banh", "an kem", "pairing"])) {
    parts.push(
      "🎵 Gợi ý thưởng thức (Pairing):\n" +
      "Ly Rang Mây ấm nồng hợp nhất khi đi cùng nhạc Acoustic mộc mạc, Jazz piano hoặc Lo-fi ngày mưa, nhâm nhi kèm bánh sừng bò bơ (Croissant), bánh quy hạnh nhân hoặc Tiramisu ít ngọt."
    );
  }

  if (hasAnyChat(q, ["thiep", "qua tang", "hop qua", "bieu", "sinh nhat", "mua si", "so luong lon", "doanh nghiep", "lien he", "hotline", "so dien thoai", "zalo", "dia chi"])) {
    parts.push(
      `🎁 Quà biếu & Liên hệ nhanh:\n` +
      `• Gợi ý quà tặng: ${pGift.name} (${fmtVndChat(pGift.price)}đ – 24 gói đủ 3 vị, đủ điều kiện áp mã VIP50K giảm ngay 50.000đ chỉ còn ${fmtVndChat(Math.max(0, pGift.price - 50000))}đ!) kèm thiệp chúc mừng AI miễn phí.\n` +
      `• Đặt sỉ / quà tặng doanh nghiệp: gọi/Zalo 0383.505.924 hoặc email hello@rangmaycoffee.vn.`
    );
    if (pGift.is_available && pGift.stock_quantity > 0) {
      actions.push({ type: "add_to_cart", productId: pGift.id, label: `🎁 Thêm Hộp Quà 24 gói (${fmtVndChat(pGift.price)}đ)` });
    }
    actions.push({ type: "scroll_section", label: "📩 Tới mục Liên hệ", target: "#contact" });
  }

  if (parts.length > 0) {
    return {
      reply: parts.join("\n\n"),
      actions: actions.slice(0, 3),
      suggestions: [
        "Tư vấn chọn dòng hợp gu",
        "Có mã giảm giá nào không?",
        "Cách pha Cà phê Sữa đá",
        "Hộp quà Mix 3 vị có gì?"
      ]
    };
  }

  if (hasAnyChat(q, ["xin chao", "chao", "hello", "hi", "hey", "alo", "shop oi", "ad oi", "tu van", "ban la ai", "lam duoc gi"])) {
    return {
      reply:
        `Xin chào bạn! Mình là Trợ lý Barista AI của Rang Mây Coffee ☁️\n` +
        `Hiện cửa hàng có đủ 4 dòng cà phê phin giấy Măng Đen từ ${fmtVndChat(Math.min(...list.map(p => p.price)))}đ – ${fmtVndChat(Math.max(...list.map(p => p.price)))}đ (Bản Giao Hưởng cân bằng, Đại Ngàn đậm Sữa đá, Sương Sớm 100% Arabica và Hộp Quà Mix 24 gói).\n` +
        `Bạn thích uống Đen nóng, Sữa đá đậm đà, Cold Brew thanh mát hay tìm quà biếu để mình chọn đúng hộp chuẩn gu nhất?`,
      actions: [{ type: "scroll_section", label: "☕ Xem 4 dòng sản phẩm", target: "#product" }],
      suggestions: ["Xem bảng giá 4 dòng cà phê", "Cho mình xin mã Voucher", "Mình thích uống Sữa đá đậm"]
    };
  }

  if (hasAnyChat(q, ["cam on", "thank", "tks", "ok", "tuyet", "ngon", "hay qua"])) {
    return {
      reply:
        "Rất vui được đồng hành cùng bạn! Chúc bạn có những phút giây thưởng thức cà phê thật bình yên và trọn vị. Cần mã ưu đãi hay tư vấn chọn dòng nào cứ nhắn mình nhé! ☕✨",
      actions: [],
      suggestions: ["Xem mã giảm giá hôm nay", "Tư vấn chọn dòng hợp gu"]
    };
  }

  return {
    reply:
      `Cảm ơn câu hỏi của bạn! Hiện Rang Mây Coffee có ${list.length} dòng sản phẩm đặc sản Măng Đen (từ ${fmtVndChat(pStrong.price)}đ đến ${fmtVndChat(pGift.price)}đ, miễn phí giao hàng toàn quốc). Mình có thể hỗ trợ ngay:\n` +
      `• ☕ Tư vấn chọn dòng hợp gu (Êm dịu / Đậm Sữa đá / 100% Arabica / Hộp Quà 24 gói)\n` +
      `• 🏷️ Săn mã Voucher giảm giá đang mở (${vouchers.map((v) => v.code).join(", ") || "Freeship"})\n` +
      `• 📦 Tra cứu nhanh đơn hàng (chỉ cần nhắn mã RM-...)\n` +
      `Bạn muốn xem bảng giá hay tư vấn hương vị trước nhé?`,
    actions: [{ type: "scroll_section", label: "☕ Xem bộ sưu tập 4 vị", target: "#product" }],
    suggestions: ["Xem bảng giá 4 dòng cà phê", "Cho mình xin mã giảm giá", "Tư vấn chọn dòng hợp gu"]
  };
}

async function tryGeminiBaristaReplyNode(apiKey, message, history, products, vouchers, orderMatch) {
  if (typeof fetch !== "function") return null;
  try {
    const prodLines = (products || [])
      .map((p) => `${p.name} (${p.id}): ${fmtVndChat(p.price)}đ, kho còn ${p.stock_quantity} hộp`)
      .join(" | ");
    const voucherLines = vouchers
      .map((v) =>
        v.discount_type === "percent"
          ? `${v.code}: giảm ${v.discount_value}% (đơn từ ${fmtVndChat(v.min_order_amount)}đ${v.max_discount_amount ? `, tối đa ${fmtVndChat(v.max_discount_amount)}đ` : ""})`
          : `${v.code}: giảm ${fmtVndChat(v.discount_value)}đ (đơn từ ${fmtVndChat(v.min_order_amount)}đ)`
      )
      .join("; ");

    const systemInstruction =
      `Bạn là Nghệ Nhân Barista AI chính thức của thương hiệu Rang Mây Coffee (cà phê phin giấy đặc sản từ Măng Đen – Kon Tum).\n` +
      `Dữ liệu cửa hàng THỜI GIAN THỰC:\n` +
      `- Danh mục 4 dòng sản phẩm: ${prodLines}.\n` +
      `- Mã giảm giá (Voucher) đang hoạt động: ${voucherLines || "Hiện chưa có mã"}.\n` +
      `- Chính sách: Miễn phí giao hàng toàn quốc (1-4 ngày), thanh toán COD, đổi trả 1-1 trong 7 ngày. Liên hệ: 0383.505.924 / hello@rangmaycoffee.vn.\n` +
      (orderMatch
        ? `- Tra cứu đơn khách vừa hỏi (${orderMatch.order_number}): Trạng thái = ${ORDER_STATUS_VI_CHAT[orderMatch.status] || orderMatch.status}, Tổng tiền = ${fmtVndChat(orderMatch.total_amount)}đ.\n`
        : "") +
      `Quy tắc: Trả lời tiếng Việt ấm áp, súc tích (dưới 130 từ), đúng 100% giá/tồn kho/voucher thực tế, chỉ trả văn bản thuần.`;

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

export const CHECKLIST_ITEMS = Object.freeze([
  { id: "daily_uptime", freq: "Hàng ngày", label: "Kiểm tra uptime, tốc độ phản hồi trang chủ & checkout" },
  { id: "daily_orders", freq: "Hàng ngày", label: "Rà soát đơn hàng COD bất thường & nhật ký đăng nhập thất bại" },
  { id: "daily_backup", freq: "Hàng ngày", label: "Xác nhận bản sao lưu CSDL & snapshot 3-2-1 hoàn tất" },
  { id: "weekly_updates", freq: "Hàng tuần", label: "Kiểm tra cập nhật bảo mật thư viện, Supabase CLI & Edge Functions" },
  { id: "weekly_scan", freq: "Hàng tuần", label: "Quét lỗ hổng phụ thuộc (npm audit), khóa API & tệp cấu hình" },
  { id: "weekly_antispam", freq: "Hàng tuần", label: "Rà soát log honeypot spam, brute-force & cấu hình Rate Limit" },
  { id: "monthly_rbac", freq: "Hàng tháng", label: "Rà soát tài khoản Admin/Manager/Staff, khóa tài khoản nghỉ & kiểm tra 2FA" },
  { id: "monthly_ssl", freq: "Hàng tháng", label: "Kiểm tra chứng chỉ SSL/TLS, HSTS, CSP và HTTP Security Headers" },
  { id: "monthly_cleanup", freq: "Hàng tháng", label: "Kiểm tra thu hồi phiên cũ & không để lọt tệp .env/.json công khai" },
  { id: "quarterly_restore", freq: "Hàng quý", label: "Diễn tập khôi phục (Restore Drill) từ bản sao lưu Snapshot AES-256-GCM" },
  { id: "quarterly_dns", freq: "Hàng quý", label: "Kiểm tra bảo mật tên miền DNSSEC, SPF/DKIM/DMARC & khóa Registrar" },
  { id: "quarterly_privacy", freq: "Hàng quý", label: "Rà soát chính sách quyền riêng tư, xóa dữ liệu & nhật ký quá hạn" }
]);

const CHECKLIST_ID_SET = new Set(CHECKLIST_ITEMS.map((item) => item.id));
const ORDER_STATUSES = new Set(["pending", "confirmed", "shipped", "completed", "cancelled"]);
const STAFF_ORDER_STATUSES = new Set(["pending", "confirmed", "shipped", "completed"]);
const CONTACT_STATUSES = new Set(["new", "in_progress", "resolved"]);
const USER_ROLES = new Set(["customer", "staff", "manager", "admin"]);
const PRIVILEGED_ROLES = new Set(["admin", "manager", "staff"]);
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const COMMON_PASSWORDS = new Set([
  "123456", "12345678", "123456789", "1234567890", "password", "password123",
  "qwerty123", "admin123", "admin@123", "admin@1234", "admin@12345",
  "rangmay123", "rangmaycoffee", "iloveyou", "abc12345", "letmein123", "welcome123"
]);

const STATIC_ROOT_ALLOWLIST = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/blog.html", "blog.html"],
  ["/login.html", "login.html"],
  ["/account.html", "account.html"],
  ["/admin.html", "admin.html"],
  ["/manager.html", "manager.html"],
  ["/staff.html", "staff.html"],
  ["/robots.txt", "robots.txt"],
  ["/sitemap.xml", "sitemap.xml"]
]);

const SENSITIVE_HTML_FILES = new Set([
  "login.html",
  "account.html",
  "admin.html",
  "manager.html",
  "staff.html"
]);

const STATIC_PREFIX_ALLOWLIST = ["/assets/", "/hinhanh/", "/.well-known/"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

const CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function minPasswordLengthForRole(role) {
  return PRIVILEGED_ROLES.has(role) ? 14 : 10;
}

function evaluatePasswordStrength(password, email, { minLength = 10 } = {}) {
  const pwd = typeof password === "string" ? password : "";
  const lowerPwd = pwd.toLowerCase();
  const emailLocal =
    typeof email === "string" && email.includes("@") ? email.split("@")[0].trim().toLowerCase() : "";

  return (
    pwd.length >= minLength &&
    pwd.length <= 128 &&
    /[A-Z]/.test(pwd) &&
    /[a-z]/.test(pwd) &&
    /[0-9]/.test(pwd) &&
    /[^A-Za-z0-9\s]/.test(pwd) &&
    !COMMON_PASSWORDS.has(lowerPwd) &&
    !lowerPwd.includes("rangmay") &&
    !lowerPwd.includes("password") &&
    !lowerPwd.includes("qwerty") &&
    !lowerPwd.includes("123456") &&
    !/^admin[^a-z0-9]*\d+$/i.test(lowerPwd) &&
    (emailLocal.length < 3 || !lowerPwd.includes(emailLocal))
  );
}

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function isValidVietnamesePhone(value) {
  return typeof value === "string" && /^(?:0|\+84)\d{9,10}$/.test(value);
}

function validText(value, min, max) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isHoneypotTripped(body) {
  if (!body || typeof body !== "object") return false;
  return (
    (typeof body.website === "string" && body.website.trim() !== "") ||
    (typeof body.honeypot === "string" && body.honeypot.trim() !== "")
  );
}

function hashPasswordScrypt(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPasswordScrypt(password, salt, expectedHash) {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, "hex");
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function normalizeRecoveryCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateRecoveryCodesAndHashes(salt, count = 8) {
  const codes = [];
  const hashes = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = crypto.randomBytes(8);
    let raw = "";
    for (let j = 0; j < 8; j += 1) {
      raw += RECOVERY_ALPHABET[bytes[j] % RECOVERY_ALPHABET.length];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    codes.push(formatted);
    hashes.push(crypto.createHash("sha256").update(`${raw}:${salt}`, "utf8").digest("hex"));
  }
  return { codes, hashes };
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwtHs256(payload, secret) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

function verifyJwtHs256(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
  const a = Buffer.from(sigB64, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.exp <= nowSec) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function buildSessionCookieHeader(sid, secret, maxAgeSec = 1800) {
  if (!sid || maxAgeSec <= 0) {
    return "rm_sid=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0";
  }
  const sig = crypto.createHmac("sha256", secret).update(sid).digest("hex").slice(0, 32);
  return `rm_sid=${sid}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${maxAgeSec}`;
}

function buildSecurityHeaders(isSensitive) {
  const headers = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": CSP_HEADER
  };
  if (isSensitive) {
    headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private";
    headers["X-Robots-Tag"] = "noindex, nofollow";
  }
  return headers;
}

function readJsonBody(req, maxBytes = 16384) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > maxBytes) {
      reject(Object.assign(new Error("Nội dung gửi lên quá lớn."), { status: 413 }));
      return;
    }
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("Nội dung gửi lên quá lớn."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (total === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Dữ liệu JSON không hợp lệ."), { status: 400 }));
      }
    });
    req.on("error", () => reject(Object.assign(new Error("Lỗi đọc dữ liệu yêu cầu."), { status: 400 })));
  });
}

async function ensureTlsCert(certsDir) {
  fs.mkdirSync(certsDir, { recursive: true });
  const keyPath = path.join(certsDir, "localhost.key");
  const certPath = path.join(certsDir, "localhost.crt");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath, "utf8"),
      cert: fs.readFileSync(certPath, "utf8"),
      keyPath,
      certPath
    };
  }

  const attrs = [
    { name: "commonName", value: "localhost" },
    { name: "organizationName", value: "Rang May Coffee Web" },
    { name: "countryName", value: "VN" }
  ];
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" }
        ]
      }
    ]
  });

  fs.writeFileSync(keyPath, pems.private, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert, "utf8");
  return { key: pems.private, cert: pems.cert, keyPath, certPath };
}

function loadOrCreateSecrets(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const secretsPath = path.join(dataDir, "secrets.json");
  let existing = null;
  if (fs.existsSync(secretsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    } catch {
      existing = null;
    }
  }

  if (
    existing &&
    typeof existing.jwtSecret === "string" &&
    typeof existing.rateLimitSalt === "string" &&
    typeof existing.backupKeyHex === "string" &&
    existing.backupKeyHex.length === 64
  ) {
    return existing;
  }

  const secrets = {
    jwtSecret: (existing && typeof existing.jwtSecret === "string" ? existing.jwtSecret : "") || crypto.randomBytes(32).toString("hex"),
    rateLimitSalt: (existing && typeof existing.rateLimitSalt === "string" ? existing.rateLimitSalt : "") || crypto.randomBytes(16).toString("hex"),
    backupKeyHex: (existing && typeof existing.backupKeyHex === "string" && existing.backupKeyHex.length === 64 ? existing.backupKeyHex : "") || crypto.randomBytes(32).toString("hex")
  };
  fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { encoding: "utf8", mode: 0o600 });
  return secrets;
}

function cloneDefaultCatalog() {
  return DEFAULT_CATALOG.map((item) => ({ ...item, updated_at: new Date().toISOString() }));
}

function cloneDefaultVouchers() {
  const now = new Date().toISOString();
  return DEFAULT_VOUCHERS.map((item) => ({ ...item, created_at: now, updated_at: now }));
}

function fmtVndPlain(num) {
  return Number(num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatVoucherPublic(v) {
  return {
    code: v.code,
    description: v.description || "",
    discount_type: v.discount_type,
    discount_value: Number(v.discount_value),
    min_order_amount: Number(v.min_order_amount || 0),
    max_discount_amount: v.max_discount_amount ? Number(v.max_discount_amount) : null
  };
}

function formatVoucherAdmin(v) {
  return {
    code: v.code,
    description: v.description || "",
    discount_type: v.discount_type,
    discount_value: Number(v.discount_value),
    min_order_amount: Number(v.min_order_amount || 0),
    max_discount_amount: v.max_discount_amount ? Number(v.max_discount_amount) : null,
    usage_limit: Number(v.usage_limit || 1),
    used_count: Number(v.used_count || 0),
    expires_at: v.expires_at || null,
    is_active: Boolean(v.is_active),
    updated_by: v.updated_by || null,
    updated_at: v.updated_at || null
  };
}

function evaluateVoucher(voucher, subtotal) {
  if (!voucher) {
    return { ok: false, status: 404, error: "Mã giảm giá không tồn tại." };
  }
  if (!voucher.is_active) {
    return { ok: false, status: 400, error: "Mã giảm giá này hiện đang tạm ngưng áp dụng." };
  }
  if (voucher.expires_at && Date.parse(voucher.expires_at) <= Date.now()) {
    return { ok: false, status: 400, error: "Mã giảm giá đã hết hạn sử dụng." };
  }
  if ((Number(voucher.used_count) || 0) >= (Number(voucher.usage_limit) || 0)) {
    return { ok: false, status: 400, error: "Mã giảm giá đã hết lượt sử dụng." };
  }
  const minAmt = Number(voucher.min_order_amount) || 0;
  if (subtotal < minAmt) {
    return {
      ok: false,
      status: 400,
      error: `Đơn hàng cần tối thiểu ${fmtVndPlain(minAmt)}đ để áp dụng mã ${voucher.code}.`
    };
  }
  let rawDiscount = voucher.discount_type === "percent"
    ? Math.round((subtotal * Number(voucher.discount_value)) / 100)
    : Number(voucher.discount_value);
  if (voucher.discount_type === "percent" && voucher.max_discount_amount && Number(voucher.max_discount_amount) > 0) {
    rawDiscount = Math.min(rawDiscount, Number(voucher.max_discount_amount));
  }
  const discountAmount = Math.min(rawDiscount, Math.max(0, Math.floor(subtotal) - 1000));
  const finalTotal = Math.floor(subtotal) - discountAmount;
  return { ok: true, discountAmount, finalTotal };
}

function createInitialStore() {
  const now = new Date().toISOString();
  const adminId = crypto.randomUUID();
  const managerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  const customerId = crypto.randomUUID();

  const adminCreds = hashPasswordScrypt("RmAdmin@2026#Sec!");
  const managerCreds = hashPasswordScrypt("RmManager@2026#Sec!");
  const staffCreds = hashPasswordScrypt("RmStaff@2026#Sec!");
  const customerCreds = hashPasswordScrypt("RmKhach@2026#Sec!");

  return {
    orderSeq: 2,
    catalog: cloneDefaultCatalog(),
    vouchers: cloneDefaultVouchers(),
    users: [
      {
        id: adminId,
        email: "admin@rangmaycoffee.vn",
        full_name: "Chủ cửa hàng (Admin)",
        phone: "0383505924",
        default_address: "Măng Đen – Kon Tum / TP.HCM",
        role: "admin",
        can_edit_price: true,
        is_active: true,
        passwordHash: adminCreds.hash,
        passwordSalt: adminCreds.salt,
        totpFactors: [],
        recoveryCodeHashes: [],
        created_at: now,
        updated_at: now
      },
      {
        id: managerId,
        email: "manager@rangmaycoffee.vn",
        full_name: "Quản lý Cửa hàng Rang Mây",
        phone: "0901000111",
        default_address: "Văn phòng vận hành TP.HCM",
        role: "manager",
        can_edit_price: false,
        is_active: true,
        passwordHash: managerCreds.hash,
        passwordSalt: managerCreds.salt,
        totpFactors: [],
        recoveryCodeHashes: [],
        created_at: now,
        updated_at: now
      },
      {
        id: staffId,
        email: "staff@rangmaycoffee.vn",
        full_name: "Nhân viên Xử lý Đơn",
        phone: "0901000222",
        default_address: "Kho giao vận TP.HCM",
        role: "staff",
        is_active: true,
        passwordHash: staffCreds.hash,
        passwordSalt: staffCreds.salt,
        totpFactors: [],
        recoveryCodeHashes: [],
        created_at: now,
        updated_at: now
      },
      {
        id: customerId,
        email: "khachhang@rangmaycoffee.vn",
        full_name: "Nguyễn Minh Anh",
        phone: "0901234567",
        default_address: "123 Đường Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
        role: "customer",
        is_active: true,
        passwordHash: customerCreds.hash,
        passwordSalt: customerCreds.salt,
        totpFactors: [],
        recoveryCodeHashes: [],
        created_at: now,
        updated_at: now
      }
    ],
    sessions: [],
    mfaChallenges: [],
    orders: [
      {
        id: crypto.randomUUID(),
        order_number: "RM-2026-0001",
        user_id: customerId,
        customer_name: "Nguyễn Minh Anh",
        customer_phone: "0901234567",
        customer_email: "khachhang@rangmaycoffee.vn",
        shipping_address: "123 Đường Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
        items: [{ id: "drip-pack-001", name: "Cà phê phin giấy Rang Mây", quantity: 2, unit_price: 119000 }],
        total_amount: 238000,
        payment_method: "COD",
        status: "confirmed",
        gift_message: "Chúc bạn một ngày mới bình an và thơm dịu hương cà phê Măng Đen.",
        internal_note: "Đã xác nhận địa chỉ giao nội thành.",
        updated_by: staffId,
        created_at: now,
        updated_at: now
      },
      {
        id: crypto.randomUUID(),
        order_number: "RM-2026-0002",
        user_id: customerId,
        customer_name: "Nguyễn Minh Anh",
        customer_phone: "0901234567",
        customer_email: "khachhang@rangmaycoffee.vn",
        shipping_address: "123 Đường Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
        items: [{ id: "drip-pack-001", name: "Cà phê phin giấy Rang Mây", quantity: 1, unit_price: 119000 }],
        total_amount: 119000,
        payment_method: "COD",
        status: "completed",
        gift_message: null,
        internal_note: "Giao hàng COD thành công.",
        updated_by: staffId,
        created_at: now,
        updated_at: now
      }
    ],
    contacts: [
      {
        id: crypto.randomUUID(),
        user_id: customerId,
        name: "Nguyễn Minh Anh",
        email: "khachhang@rangmaycoffee.vn",
        phone: "0901234567",
        message: "Mình muốn hỏi chính sách chiết khấu khi đặt 10 hộp làm quà tặng công ty.",
        status: "new",
        handled_by: null,
        created_at: now,
        updated_at: now
      }
    ],
    auditLogs: [
      {
        id: 1,
        actor_id: adminId,
        actor_email: "system",
        actor_role: "admin",
        action: "system.initialized",
        target_type: "security_center",
        target_id: "default",
        details: { message: "Khởi tạo hệ thống bảo mật 5 trụ cột & 3 cổng vận hành RBAC cho website Rang Mây Coffee" },
        ip_hash: "local-init",
        created_at: now
      }
    ],
    checklist: {
      checkedIds: ["daily_uptime", "daily_backup", "monthly_ssl"],
      updatedAt: now,
      updatedByEmail: "system"
    },
    securityPolicy: {
      requireAdminMfa: false,
      updatedAt: now,
      updatedByEmail: "system"
    },
    backups: []
  };
}

function loadOrCreateStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const storePath = path.join(dataDir, "store.json");
  if (fs.existsSync(storePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.orders)) {
        let migrated = false;
        const now = new Date().toISOString();
        if (!Array.isArray(parsed.catalog) || parsed.catalog.length === 0) {
          parsed.catalog = cloneDefaultCatalog();
          migrated = true;
        } else {
          for (const defProd of DEFAULT_CATALOG) {
            const existing = parsed.catalog.find((p) => p.id === defProd.id);
            if (!existing) {
              parsed.catalog.push({ ...defProd, updated_at: now });
              migrated = true;
            } else if (existing.id === "drip-pack-001" && existing.name === "Cà phê phin giấy Rang Mây") {
              existing.name = defProd.name;
              if (existing.badge_text === "Phin giấy tiện lợi, minh bạch lô sản xuất") {
                existing.badge_text = defProd.badge_text;
              }
              migrated = true;
            }
          }
        }
        if (!Array.isArray(parsed.vouchers)) {
          parsed.vouchers = cloneDefaultVouchers();
          migrated = true;
        }
        if (!parsed.users.some((u) => u.email === "manager@rangmaycoffee.vn")) {
          const managerCreds = hashPasswordScrypt("RmManager@2026#Sec!");
          parsed.users.splice(1, 0, {
            id: crypto.randomUUID(),
            email: "manager@rangmaycoffee.vn",
            full_name: "Quản lý Cửa hàng Rang Mây",
            phone: "0901000111",
            default_address: "Văn phòng vận hành TP.HCM",
            role: "manager",
            is_active: true,
            passwordHash: managerCreds.hash,
            passwordSalt: managerCreds.salt,
            totpFactors: [],
            recoveryCodeHashes: [],
            created_at: now,
            updated_at: now
          });
          migrated = true;
        }
        parsed.users.forEach((u) => {
          if (!Array.isArray(u.totpFactors)) {
            u.totpFactors = [];
            migrated = true;
          }
          if (!Array.isArray(u.recoveryCodeHashes)) {
            u.recoveryCodeHashes = [];
            migrated = true;
          }
          if (u.role === "admin" && u.can_edit_price !== true) {
            u.can_edit_price = true;
            migrated = true;
          } else if (u.role === "manager" && typeof u.can_edit_price !== "boolean") {
            u.can_edit_price = false;
            migrated = true;
          } else if (u.role !== "admin" && u.role !== "manager" && u.can_edit_price !== false) {
            u.can_edit_price = false;
            migrated = true;
          }
        });
        if (!parsed.securityPolicy) {
          parsed.securityPolicy = { requireAdminMfa: false, updatedAt: now, updatedByEmail: "system" };
          migrated = true;
        }
        if (migrated) {
          fs.writeFileSync(storePath, JSON.stringify(parsed, null, 2), "utf8");
        }
        return { store: parsed, storePath };
      }
    } catch {
      // Recreate cleanly below
    }
  }
  const store = createInitialStore();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  return { store, storePath };
}

function readPackageDeps(rootDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    return pkg.dependencies || {};
  } catch {
    return {};
  }
}

/**
 * Creates a hardened HTTPS server + HTTP 301 redirector serving the original storefront,
 * dedicated role portals (admin.html / manager.html / staff.html / account.html), and RBAC backend APIs.
 */
export function createSecureServer(options = {}) {
  const httpPort = Number(options.httpPort ?? process.env.RANGMAY_HTTP_PORT ?? 3080);
  const httpsPort = Number(options.httpsPort ?? process.env.RANGMAY_HTTPS_PORT ?? 3443);
  const host = options.host || process.env.RANGMAY_HOST || "127.0.0.1";
  const rootDir = path.resolve(options.rootDir || ROOT_DIR);
  const certsDir = path.resolve(options.certsDir || path.join(__dirname, "certs"));
  const dataDir = path.resolve(options.dataDir || path.join(__dirname, "data"));
  const backupsDir = path.resolve(options.backupsDir || path.join(__dirname, "backups"));

  let httpServer = null;
  let httpsServer = null;
  let store = null;
  let storePath = "";
  let secrets = null;
  let certInfo = null;
  let realRootDir = "";
  let packageDeps = {};

  const windowBuckets = new Map();
  const loginFailBuckets = new Map();

  function getActualHttpsPort() {
    if (httpsServer && typeof httpsServer.address() === "object" && httpsServer.address()) {
      return httpsServer.address().port;
    }
    return httpsPort;
  }

  function getActualHttpPort() {
    if (httpServer && typeof httpServer.address() === "object" && httpServer.address()) {
      return httpServer.address().port;
    }
    return httpPort;
  }

  function persistStore() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpPath = storePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmpPath, storePath);
  }

  function getClientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      return xff.split(",")[0].trim();
    }
    return req.socket?.remoteAddress || "127.0.0.1";
  }

  function getClientIpHash(req) {
    const ip = getClientIp(req);
    return crypto
      .createHash("sha256")
      .update(`${ip}:${secrets.rateLimitSalt}`)
      .digest("hex")
      .slice(0, 32);
  }

  function checkSlidingWindow(map, key, maxRequests, windowMs, recordNow = true) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const list = (map.get(key) || []).filter((ts) => ts >= cutoff);
    if (list.length >= maxRequests) {
      map.set(key, list);
      const oldest = list[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, count: list.length, retryAfterSec };
    }
    if (recordNow) {
      list.push(now);
      map.set(key, list);
    }
    return { allowed: true, count: list.length, retryAfterSec: 0 };
  }

  function recordSlidingFailure(map, key, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const list = (map.get(key) || []).filter((ts) => ts >= cutoff);
    list.push(now);
    map.set(key, list);
    return list.length;
  }

  function countActiveLockouts() {
    const cutoff = Date.now() - 15 * 60 * 1000;
    let lockedCount = 0;
    for (const [key, timestamps] of loginFailBuckets.entries()) {
      if (!key.startsWith("login:")) continue;
      const recent = timestamps.filter((ts) => ts >= cutoff);
      if (recent.length >= 5) lockedCount += 1;
    }
    return lockedCount;
  }

  function appendAuditLog({ actorId = null, actorEmail = null, actorRole = null, action, targetType = null, targetId = null, details = {}, ipHash = "" }) {
    const nextId = store.auditLogs.length > 0 ? Math.max(...store.auditLogs.map((l) => Number(l.id) || 0)) + 1 : 1;
    store.auditLogs.unshift({
      id: nextId,
      actor_id: actorId,
      actor_email: actorEmail,
      actor_role: actorRole,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      ip_hash: ipHash,
      created_at: new Date().toISOString()
    });
    if (store.auditLogs.length > 500) {
      store.auditLogs = store.auditLogs.slice(0, 500);
    }
  }

  function formatAuthUser(user) {
    return {
      id: user.id,
      email: user.email,
      user_metadata: { full_name: user.full_name },
      factors: (user.totpFactors || []).map((f) => ({
        id: f.id,
        factor_type: "totp",
        status: f.status,
        friendly_name: f.friendly_name,
        created_at: f.created_at
      })),
      recovery_codes_remaining: (user.recoveryCodeHashes || []).length
    };
  }

  function formatPublicProfile(user) {
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone || null,
      role: user.role,
      can_edit_price: user.role === "admin" || (user.role === "manager" && Boolean(user.can_edit_price)),
      is_active: Boolean(user.is_active),
      has_2fa: (user.totpFactors || []).some((f) => f.status === "verified"),
      recovery_codes_remaining: (user.recoveryCodeHashes || []).length,
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  }

  function formatCatalogProduct(p) {
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      price: Number(p.price) || 0,
      stock_quantity: Math.max(0, Number(p.stock_quantity) || 0),
      is_available: Boolean(p.is_available),
      badge_text: p.badge_text || "",
      updated_at: p.updated_at
    };
  }

  function issueSessionTokens(user, existingSessionId = null, aal = "aal1") {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = 1800;
    const expiresAt = nowSec + expiresIn;
    const sid = existingSessionId || crypto.randomUUID();
    const refreshToken = crypto.randomBytes(32).toString("hex");

    store.sessions = store.sessions.filter((s) => s.id !== sid && s.expiresAt > nowSec - 60);
    store.sessions.push({
      id: sid,
      userId: user.id,
      aal,
      refreshToken,
      expiresAt: nowSec + 7 * 24 * 3600,
      createdAt: new Date().toISOString()
    });

    const accessToken = signJwtHs256(
      {
        sub: user.id,
        email: user.email,
        role: "authenticated",
        app_role: user.role,
        aal,
        sid,
        iat: nowSec,
        exp: expiresAt
      },
      secrets.jwtSecret
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: expiresIn,
      expires_at: expiresAt,
      user: formatAuthUser(user),
      cookieHeader: buildSessionCookieHeader(sid, secrets.jwtSecret, expiresIn)
    };
  }

  function resolveAuthActor(req) {
    const authHeader = String(req.headers.authorization || "");
    if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice(7).trim();
    if (!token || token === "local-secure-anon") return null;

    const payload = verifyJwtHs256(token, secrets.jwtSecret);
    if (!payload) {
      throw Object.assign(new Error("Phiên đăng nhập không hợp lệ hoặc đã hết hạn."), {
        status: 401,
        code: "INVALID_SESSION"
      });
    }

    const session = store.sessions.find((s) => s.id === payload.sid && s.userId === payload.sub);
    if (!session || session.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw Object.assign(new Error("Phiên đăng nhập đã hết hạn hoặc đã đăng xuất."), {
        status: 401,
        code: "INVALID_SESSION"
      });
    }

    const user = store.users.find((u) => u.id === payload.sub);
    if (!user) {
      throw Object.assign(new Error("Không tìm thấy tài khoản."), { status: 401, code: "INVALID_SESSION" });
    }
    if (!user.is_active) {
      throw Object.assign(new Error("Tài khoản này đã bị tạm khóa bởi quản trị viên."), {
        status: 403,
        code: "ACCOUNT_DISABLED"
      });
    }

    return { user, session, aal: session.aal || "aal1" };
  }

  function enforceAdminMfaGate(actor, targetPath, ipHash) {
    const hasVerified2fa = (actor.user.totpFactors || []).some((f) => f.status === "verified");
    const requirePolicy = Boolean(store.securityPolicy?.requireAdminMfa);
    if ((hasVerified2fa || requirePolicy) && actor.aal !== "aal2") {
      appendAuditLog({
        actorId: actor.user.id,
        actorEmail: actor.user.email,
        actorRole: actor.user.role,
        action: "access.denied",
        targetType: "edge_function",
        targetId: targetPath,
        details: { reason: "mfa_required_aal2", currentAal: actor.aal, requirePolicy, hasVerified2fa },
        ipHash
      });
      persistStore();
      throw Object.assign(
        new Error("Tài khoản quản trị/quản lý/nhân viên bắt buộc xác thực 2 yếu tố (2FA – AAL2) trước khi truy cập."),
        { status: 403, code: "MFA_REQUIRED" }
      );
    }
  }

  function restoreOrderStockIfCancelled(order, prevStatus, nextStatus) {
    if (prevStatus !== "cancelled" && nextStatus === "cancelled") {
      if (Array.isArray(order.items)) {
        order.items.forEach((line) => {
          const prod = store.catalog.find((p) => p.id === line.id);
          if (prod) {
            prod.stock_quantity = Math.min(10000, (Number(prod.stock_quantity) || 0) + (Number(line.quantity) || 0));
            prod.updated_at = new Date().toISOString();
          }
        });
      }
      if (order.voucher_code && Array.isArray(store.vouchers)) {
        const voucher = store.vouchers.find((v) => v.code === order.voucher_code);
        if (voucher) {
          voucher.used_count = Math.max(0, (Number(voucher.used_count) || 0) - 1);
          voucher.updated_at = new Date().toISOString();
        }
      }
    }
  }

  function buildSanitizedBackupPayload(reason = "manual") {
    const exportedAt = new Date().toISOString();
    const sanitizedProfiles = store.users.map(formatPublicProfile);
    return {
      exportedAt,
      version: "Rang Mây Coffee Web v2.3 (3-Portal + Voucher Hardened)",
      mode: "local-secure",
      reason,
      recordCounts: {
        orders: store.orders.length,
        contacts: store.contacts.length,
        profiles: sanitizedProfiles.length,
        vouchers: (store.vouchers || []).length,
        auditLogs: store.auditLogs.length
      },
      catalog: (store.catalog || []).map(formatCatalogProduct),
      vouchers: (store.vouchers || []).map(formatVoucherAdmin),
      orders: store.orders,
      contacts: store.contacts,
      profiles: sanitizedProfiles,
      auditLogs: store.auditLogs.slice(0, 200),
      checklist: store.checklist,
      securityPolicy: store.securityPolicy
    };
  }

  function createEncryptedBackupInternal(actorUser, { reason = "manual", ipHash = "" } = {}) {
    fs.mkdirSync(backupsDir, { recursive: true });
    const now = new Date();
    let filename = "";
    let destPath = "";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const stampDate = new Date(now.getTime() + attempt * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${stampDate.getUTCFullYear()}${pad(stampDate.getUTCMonth() + 1)}${pad(stampDate.getUTCDate())}-${pad(stampDate.getUTCHours())}${pad(stampDate.getUTCMinutes())}${pad(stampDate.getUTCSeconds())}`;
      const candidate = `rangmay-backup-${stamp}.enc.json`;
      const candidatePath = path.join(backupsDir, candidate);
      if (!fs.existsSync(candidatePath)) {
        filename = candidate;
        destPath = candidatePath;
        break;
      }
    }
    if (!filename) {
      throw Object.assign(new Error("Không tạo được tên tệp sao lưu duy nhất."), { status: 500 });
    }

    const payload = buildSanitizedBackupPayload(reason);
    const plaintextUtf8 = JSON.stringify(payload, null, 2);
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(secrets.backupKeyHex, "hex");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintextUtf8, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encryptedEnvelope = {
      format: "rangmay-encrypted-backup-v1",
      algorithm: "aes-256-gcm",
      exportedAt: payload.exportedAt,
      filename,
      reason,
      recordCounts: payload.recordCounts,
      ivHex: iv.toString("hex"),
      authTagHex: authTag.toString("hex"),
      ciphertextBase64: encrypted.toString("base64")
    };

    const envelopeText = JSON.stringify(encryptedEnvelope, null, 2);
    const checksumSha256 = crypto.createHash("sha256").update(envelopeText, "utf8").digest("hex");
    const sizeBytes = Buffer.byteLength(envelopeText, "utf8");
    fs.writeFileSync(destPath, envelopeText, "utf8");

    const snapshot = {
      id: crypto.randomUUID(),
      filename,
      is_encrypted: true,
      encryption_alg: "AES-256-GCM",
      checksum_sha256: checksumSha256,
      record_counts: payload.recordCounts,
      size_bytes: sizeBytes,
      created_by_email: actorUser.email,
      created_at: payload.exportedAt
    };

    store.backups = [snapshot, ...(store.backups || [])].slice(0, 50);
    appendAuditLog({
      actorId: actorUser.id,
      actorEmail: actorUser.email,
      actorRole: actorUser.role,
      action: "security.backup_created",
      targetType: "backup_snapshot",
      targetId: filename,
      details: { checksum_sha256: checksumSha256, size_bytes: sizeBytes, encryption: "AES-256-GCM", reason },
      ipHash
    });

    return { snapshot, encryptedEnvelope };
  }

  function decryptAndVerifyBackupFile(filename) {
    if (typeof filename !== "string" || !/^rangmay-backup-\d{8}-\d{6}\.(?:enc\.)?json$/.test(filename)) {
      throw Object.assign(new Error("Tên tệp sao lưu không hợp lệ."), { status: 400 });
    }
    const targetPath = path.resolve(backupsDir, filename);
    if (!targetPath.startsWith(path.resolve(backupsDir) + path.sep) || !fs.existsSync(targetPath)) {
      throw Object.assign(new Error("Không tìm thấy tệp sao lưu trên máy chủ."), { status: 404 });
    }

    const rawContent = fs.readFileSync(targetPath, "utf8");
    const actualSha256 = crypto.createHash("sha256").update(rawContent, "utf8").digest("hex");
    const recorded = (store.backups || []).find((b) => b.filename === filename);
    if (recorded && recorded.checksum_sha256 && recorded.checksum_sha256 !== actualSha256) {
      throw Object.assign(new Error("Cảnh báo toàn vẹn: Mã SHA-256 của tệp sao lưu không khớp (tệp có thể đã bị chỉnh sửa)."), {
        status: 422
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      throw Object.assign(new Error("Tệp sao lưu bị hỏng định dạng JSON."), { status: 422 });
    }

    let payload = parsed;
    let encrypted = false;
    if (parsed && parsed.format === "rangmay-encrypted-backup-v1") {
      if (parsed.algorithm !== "aes-256-gcm" || !parsed.ivHex || !parsed.authTagHex || !parsed.ciphertextBase64) {
        throw Object.assign(new Error("Tệp sao lưu mã hóa thiếu thông tin IV/AuthTag."), { status: 422 });
      }
      try {
        const key = Buffer.from(secrets.backupKeyHex, "hex");
        const iv = Buffer.from(parsed.ivHex, "hex");
        const authTag = Buffer.from(parsed.authTagHex, "hex");
        const ciphertext = Buffer.from(parsed.ciphertextBase64, "base64");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        const decryptedText = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
        payload = JSON.parse(decryptedText);
        encrypted = true;
      } catch {
        throw Object.assign(new Error("Giải mã AES-256-GCM thất bại hoặc AuthTag không hợp lệ."), { status: 422 });
      }
    }

    if (!payload || !Array.isArray(payload.orders) || !Array.isArray(payload.contacts) || !Array.isArray(payload.profiles)) {
      throw Object.assign(new Error("Cấu trúc dữ liệu bên trong bản sao lưu không đầy đủ."), { status: 422 });
    }

    return { payload, checksumValid: true, actualSha256, encrypted };
  }

  function buildSecurityCenter() {
    const activeUsers = store.users.filter((u) => u.is_active);
    const adminStaff = activeUsers.filter((u) => PRIVILEGED_ROLES.has(u.role));
    const adminStaffWith2fa = adminStaff.filter((u) =>
      (u.totpFactors || []).some((f) => f.status === "verified")
    );
    const allStrong = store.users.every((u) => typeof u.passwordHash === "string" && u.passwordHash.length === 128);
    const port = getActualHttpsPort();
    const requireAdminMfa = Boolean(store.securityPolicy?.requireAdminMfa);

    const healthChecks = [
      {
        key: "https_tls",
        label: "Chứng chỉ SSL/TLS 1.2+ & Chuyển hướng HTTP 301",
        status: certInfo ? "pass" : "warn",
        detail: `HTTPS bật tại localhost:${port} (TLS >= 1.2, X.509 RSA 2048-bit SHA-256), HTTP chuyển hướng 301`
      },
      {
        key: "security_headers",
        label: "HTTP Security Headers, HttpOnly Cookie & Strict CSP",
        status: "pass",
        detail: "HSTS, X-Frame-Options: DENY, nosniff, cookie HttpOnly; Secure; SameSite=Strict & script-src 'self'"
      },
      {
        key: "password_hashing",
        label: "Chính sách mật khẩu theo vai trò & băm scrypt",
        status: allStrong ? "pass" : "warn",
        detail: "Chủ cửa hàng/Quản lý/Nhân viên >= 14 ký tự, Khách hàng >= 10 ký tự; băm scrypt + salt riêng"
      },
      {
        key: "mfa_coverage",
        label: "Xác thực 2FA TOTP, Recovery Codes & Chính sách AAL2",
        status: adminStaffWith2fa.length === adminStaff.length && adminStaff.length > 0 && requireAdminMfa ? "pass" : "warn",
        detail: `${adminStaffWith2fa.length}/${adminStaff.length} tài khoản nội bộ có 2FA; ép AAL2: ${requireAdminMfa ? "BẬT" : "Khuyến nghị"}`
      },
      {
        key: "rbac_audit",
        label: "3 Trang vận hành riêng (Admin / Manager / Staff) & Audit Log",
        status: "pass",
        detail: `Admin (admin.html) · Manager (manager.html) · Staff (staff.html); đã ghi ${store.auditLogs.length} sự kiện Audit Log`
      },
      {
        key: "backup_321",
        label: "Sao lưu 3-2-1 Mã hóa AES-256-GCM + SHA-256",
        status: store.backups.length > 0 ? "pass" : "warn",
        detail:
          store.backups.length > 0
            ? `Đã có ${store.backups.length} bản Snapshot mã hóa (mới nhất: ${store.backups[0].filename})`
            : "Chưa tạo bản Snapshot mã hóa nào — nhấn Tạo Snapshot Mã hóa ngay bên dưới"
      }
    ];

    const depsList = Object.entries(packageDeps).map(([k, v]) => `${k}@${v}`).join(", ") || "none";

    return {
      healthChecks,
      securityPolicy: {
        requireAdminMfa,
        updatedAt: store.securityPolicy?.updatedAt || null,
        updatedByEmail: store.securityPolicy?.updatedByEmail || null
      },
      lockoutSummary: {
        activeLockouts: countActiveLockouts()
      },
      checklist: {
        items: CHECKLIST_ITEMS,
        checkedIds: Array.isArray(store.checklist?.checkedIds) ? store.checklist.checkedIds : [],
        updatedAt: store.checklist?.updatedAt || null,
        updatedByEmail: store.checklist?.updatedByEmail || null
      },
      backups: (store.backups || []).slice(0, 20),
      versionInfo: {
        appVersion: "Rang Mây Coffee Web v2.2 (3-Portal Hardened)",
        backendMode: "local-secure",
        runtime: `Node.js ${process.version} (Dependencies: ${depsList})`,
        tlsAlgorithm: "TLS 1.2 / 1.3 + X.509 RSA 2048-bit SHA-256",
        keyRotationNote: "JWT HS256 (30p) + Cookie HttpOnly Strict + Backup AES-256-GCM + SHA-256"
      }
    };
  }

  function computeBusinessSummary(orders, contacts, catalog) {
    const totalOrders = orders.length;
    const pendingOrders = orders.filter((o) => o.status === "pending").length;
    const confirmedOrders = orders.filter((o) => o.status === "confirmed").length;
    const shippedOrders = orders.filter((o) => o.status === "shipped").length;
    const completedOrders = orders.filter((o) => o.status === "completed").length;
    const cancelledOrders = orders.filter((o) => o.status === "cancelled").length;
    const activeOrders = orders.filter((o) => o.status !== "cancelled");
    const totalRevenue = activeOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const avgOrderValue = activeOrders.length > 0 ? Math.round(totalRevenue / activeOrders.length) : 0;
    const completionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
    const newContacts = contacts.filter((c) => (c.status || "new") === "new").length;
    const totalStock = (catalog || []).reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity) || 0), 0);

    return {
      totalOrders,
      pendingOrders,
      confirmedOrders,
      shippedOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
      avgOrderValue,
      completionRate,
      newContacts,
      totalStock
    };
  }

  function sendJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, {
      ...buildSecurityHeaders(true),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    });
    res.end(JSON.stringify(body));
  }

  function sendText(res, status, text, isSensitive = true) {
    res.writeHead(status, {
      ...buildSecurityHeaders(isSensitive),
      "Content-Type": "text/plain; charset=utf-8"
    });
    res.end(text);
  }

  function checkOriginHeader(req) {
    const method = (req.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
    const origin = req.headers.origin;
    if (!origin) return true;
    const port = getActualHttpsPort();
    return origin === `https://localhost:${port}` || origin === `https://127.0.0.1:${port}`;
  }

  async function handleApiRequest(req, res, reqUrl) {
    const pathname = reqUrl.pathname;
    const method = (req.method || "GET").toUpperCase();

    if (!checkOriginHeader(req)) {
      sendJson(res, 403, { error: "Origin không được phép." });
      return;
    }

    const ipHash = getClientIpHash(req);

    if (pathname === "/api/health" && method === "GET") {
      sendJson(res, 200, {
        ok: true,
        mode: "local-secure",
        https: true,
        httpRedirectPort: getActualHttpPort(),
        httpsPort: getActualHttpsPort(),
        tlsCert: {
          subject: "CN=localhost, O=Rang May Coffee Web",
          algorithm: "RSA-2048 / SHA-256",
          minTlsVersion: "TLSv1.2",
          validDays: 365
        },
        headersEnforced: true,
        requireAdminMfa: Boolean(store.securityPolicy?.requireAdminMfa)
      });
      return;
    }

    if (pathname === "/api/functions/store-catalog" && method === "GET") {
      const nowMs = Date.now();
      const publicVouchers = (store.vouchers || [])
        .filter(
          (v) =>
            v.is_active &&
            (Number(v.used_count) || 0) < (Number(v.usage_limit) || 0) &&
            (!v.expires_at || Date.parse(v.expires_at) > nowMs)
        )
        .map(formatVoucherPublic);
      sendJson(res, 200, {
        products: (store.catalog || []).map(formatCatalogProduct),
        vouchers: publicVouchers
      });
      return;
    }

    if (pathname === "/api/functions/validate-voucher" && method === "POST") {
      const rate = checkSlidingWindow(windowBuckets, `voucher:${ipHash}`, 30, 5 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Bạn kiểm tra mã giảm giá quá nhanh. Vui lòng thử lại sau." }, { "Retry-After": String(rate.retryAfterSec) });
        return;
      }
      const body = await readJsonBody(req);
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const subtotal = Number(body.subtotal);
      if (!/^[A-Z0-9_-]{3,24}$/.test(code) || !Number.isFinite(subtotal) || subtotal < 1000) {
        sendJson(res, 400, { error: "Mã giảm giá hoặc tạm tính đơn hàng không hợp lệ." });
        return;
      }
      const matched = (store.vouchers || []).find((v) => v.code === code) || null;
      const evaluated = evaluateVoucher(matched, subtotal);
      if (!evaluated.ok) {
        sendJson(res, evaluated.status, { error: evaluated.error });
        return;
      }
      sendJson(res, 200, {
        valid: true,
        voucher: formatVoucherPublic(matched),
        discountAmount: evaluated.discountAmount,
        finalTotal: evaluated.finalTotal
      });
      return;
    }

    if (pathname === "/api/functions/barista-ai" && method === "POST") {
      const rate = checkSlidingWindow(windowBuckets, `barista:${ipHash}`, 35, 5 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(
          res,
          429,
          { error: "Barista AI đang pha chế nhiều câu trả lời, bạn chờ vài giây rồi hỏi tiếp nhé!" },
          { "Retry-After": String(rate.retryAfterSec) }
        );
        return;
      }

      const body = await readJsonBody(req);
      if (body.mode === "gift_card") {
        const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
        const occasion = typeof body.occasion === "string" ? body.occasion.trim() : "dịp đặc biệt";
        const style = typeof body.style === "string" ? body.style.trim() : "poetic";
        if (!recipient || recipient.length > 80) {
          sendJson(res, 400, { error: "Vui lòng nhập tên người nhận hợp lệ." });
          return;
        }
        sendJson(res, 200, { giftMessage: generateSmartGiftCard(recipient, occasion, style) });
        return;
      }

      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 600) {
        sendJson(res, 400, { error: "Câu hỏi vui lòng từ 1 đến 600 ký tự." });
        return;
      }

      const rawHistory = Array.isArray(body.history) ? body.history : [];
      const history = rawHistory
        .filter((item) => Boolean(item && typeof item === "object"))
        .slice(-6);

      const products = (store.catalog && store.catalog.length > 0 ? store.catalog : DEFAULT_CATALOG).map(
        formatCatalogProduct
      );

      const nowMs = Date.now();
      const vouchers = (store.vouchers || [])
        .filter(
          (v) =>
            v.is_active &&
            v.used_count < v.usage_limit &&
            (!v.expires_at || Date.parse(v.expires_at) > nowMs)
        )
        .sort((a, b) => Number(a.min_order_amount || 0) - Number(b.min_order_amount || 0))
        .map(formatVoucherPublic);

      const codeMatch = message.toUpperCase().match(/\bRM-\d{4,8}-\d{4,6}\b/);
      const askedOrderCode = codeMatch ? codeMatch[0] : null;
      let orderMatch = null;
      if (askedOrderCode) {
        const ord = (store.orders || []).find((o) => o.order_number === askedOrderCode);
        if (ord) {
          orderMatch = {
            order_number: ord.order_number,
            status: ord.status,
            total_amount: ord.total_amount,
            discount_amount: ord.discount_amount || 0,
            voucher_code: ord.voucher_code || null,
            created_at: ord.created_at
          };
        }
      }

      const deterministic = buildGroundedBaristaResponse(
        message,
        products,
        vouchers,
        orderMatch,
        askedOrderCode
      );

      const geminiKey = process.env.GEMINI_API_KEY || "";
      if (geminiKey) {
        const llmReply = await tryGeminiBaristaReplyNode(
          geminiKey,
          message,
          history,
          products,
          vouchers,
          orderMatch
        );
        if (llmReply) {
          sendJson(res, 200, {
            reply: llmReply,
            actions: deterministic.actions,
            suggestions: deterministic.suggestions,
            engine: "gemini-2.5-flash"
          });
          return;
        }
      }

      sendJson(res, 200, {
        reply: deterministic.reply,
        actions: deterministic.actions,
        suggestions: deterministic.suggestions,
        engine: "rangmay-smart-nlu"
      });
      return;
    }

    if (pathname === "/api/auth/signup" && method === "POST") {
      const rate = checkSlidingWindow(windowBuckets, `signup:${ipHash}`, 10, 15 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Bạn thao tác đăng ký quá nhanh. Vui lòng thử lại sau." }, { "Retry-After": String(rate.retryAfterSec) });
        return;
      }

      const body = await readJsonBody(req);
      if (isHoneypotTripped(body)) {
        appendAuditLog({
          actorEmail: typeof body.email === "string" ? body.email.trim().toLowerCase() : "bot",
          action: "security.honeypot_triggered",
          targetType: "signup",
          ipHash
        });
        persistStore();
        sendJson(res, 400, { error: "Yêu cầu bị từ chối bởi bộ lọc chống spam." });
        return;
      }

      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const fullName = typeof body.data?.full_name === "string" ? body.data.full_name.trim() : "";

      if (!isValidEmail(email) || !validText(fullName, 2, 100)) {
        sendJson(res, 400, { error: "Thông tin đăng ký chưa hợp lệ." });
        return;
      }
      if (!evaluatePasswordStrength(password, email, { minLength: 10 })) {
        sendJson(res, 400, {
          error: "Mật khẩu chưa đạt đủ yêu cầu bảo mật (tối thiểu 10 ký tự, đủ chữ hoa, chữ thường, số và ký tự đặc biệt)."
        });
        return;
      }

      if (store.users.some((u) => u.email.toLowerCase() === email)) {
        sendJson(res, 400, { error: "Không thể hoàn tất đăng ký lúc này. Vui lòng kiểm tra thông tin và thử lại." });
        return;
      }

      const now = new Date().toISOString();
      const { salt, hash } = hashPasswordScrypt(password);
      const newUser = {
        id: crypto.randomUUID(),
        email,
        full_name: fullName,
        phone: null,
        default_address: null,
        role: "customer",
        is_active: true,
        passwordHash: hash,
        passwordSalt: salt,
        totpFactors: [],
        recoveryCodeHashes: [],
        created_at: now,
        updated_at: now
      };
      store.users.push(newUser);
      appendAuditLog({
        actorId: newUser.id,
        actorEmail: newUser.email,
        actorRole: "customer",
        action: "auth.signup",
        targetType: "profile",
        targetId: newUser.id,
        ipHash
      });
      persistStore();
      sendJson(res, 201, { user: formatAuthUser(newUser) });
      return;
    }

    if (pathname === "/api/auth/token" && method === "POST") {
      const grantType = reqUrl.searchParams.get("grant_type");
      const body = await readJsonBody(req);

      if (grantType === "password") {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";

        const userLimit = checkSlidingWindow(loginFailBuckets, `login:${ipHash}:${email}`, 5, 15 * 60 * 1000, false);
        const ipLimit = checkSlidingWindow(loginFailBuckets, `login-ip:${ipHash}`, 12, 15 * 60 * 1000, false);
        if (!userLimit.allowed || !ipLimit.allowed) {
          const retryAfter = Math.max(userLimit.retryAfterSec, ipLimit.retryAfterSec);
          appendAuditLog({
            actorEmail: email || "unknown",
            action: "auth.login_locked",
            targetType: "auth",
            details: { reason: "brute_force_threshold_reached" },
            ipHash
          });
          persistStore();
          sendJson(
            res,
            429,
            {
              error: `Tạm khóa đăng nhập do nhập sai quá nhiều lần. Vui lòng thử lại sau ${retryAfter} giây.`,
              error_code: "RATE_LIMITED"
            },
            { "Retry-After": String(retryAfter) }
          );
          return;
        }

        const user = store.users.find((u) => u.email.toLowerCase() === email);
        const validPwd =
          user && verifyPasswordScrypt(password, user.passwordSalt, user.passwordHash);

        if (!user || !validPwd) {
          recordSlidingFailure(loginFailBuckets, `login:${ipHash}:${email}`, 15 * 60 * 1000);
          recordSlidingFailure(loginFailBuckets, `login-ip:${ipHash}`, 15 * 60 * 1000);
          appendAuditLog({
            actorId: user ? user.id : null,
            actorEmail: email || "unknown",
            actorRole: user ? user.role : null,
            action: "auth.login_failed",
            targetType: "auth",
            details: { reason: "invalid_credentials" },
            ipHash
          });
          persistStore();
          sendJson(res, 400, { error: "Invalid login credentials", error_code: "invalid_credentials" });
          return;
        }

        if (!user.is_active) {
          appendAuditLog({
            actorId: user.id,
            actorEmail: user.email,
            actorRole: user.role,
            action: "auth.login_blocked_disabled",
            targetType: "profile",
            targetId: user.id,
            ipHash
          });
          persistStore();
          sendJson(res, 403, { error: "Tài khoản này đã bị tạm khóa bởi quản trị viên.", error_code: "ACCOUNT_DISABLED" });
          return;
        }

        loginFailBuckets.delete(`login:${ipHash}:${email}`);
        const { cookieHeader, ...sessionBundle } = issueSessionTokens(user, null, "aal1");
        appendAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          action: "auth.login_success",
          targetType: "session",
          details: { aal: "aal1" },
          ipHash
        });
        persistStore();
        sendJson(res, 200, sessionBundle, { "Set-Cookie": cookieHeader });
        return;
      }

      if (grantType === "refresh_token") {
        const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
        const nowSec = Math.floor(Date.now() / 1000);
        const session = store.sessions.find((s) => s.refreshToken === refreshToken && s.expiresAt > nowSec);
        if (!session) {
          sendJson(res, 401, { error: "Refresh token không hợp lệ hoặc đã hết hạn." });
          return;
        }
        const user = store.users.find((u) => u.id === session.userId && u.is_active);
        if (!user) {
          sendJson(res, 403, { error: "Tài khoản đã bị vô hiệu hóa." });
          return;
        }
        const { cookieHeader, ...sessionBundle } = issueSessionTokens(user, session.id, session.aal || "aal1");
        persistStore();
        sendJson(res, 200, sessionBundle, { "Set-Cookie": cookieHeader });
        return;
      }

      sendJson(res, 400, { error: "Loại grant_type không được hỗ trợ." });
      return;
    }

    if (pathname === "/api/auth/recover" && method === "POST") {
      const body = await readJsonBody(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      appendAuditLog({
        actorEmail: email || "unknown",
        action: "auth.recovery_requested",
        targetType: "auth",
        ipHash
      });
      persistStore();
      sendJson(res, 200, { sent: true });
      return;
    }

    if (pathname === "/api/auth/user" && method === "GET") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập." });
        return;
      }
      sendJson(res, 200, formatAuthUser(actor.user));
      return;
    }

    if (pathname === "/api/auth/user" && method === "PUT") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập lại." });
        return;
      }
      const body = await readJsonBody(req);
      const newPassword = typeof body.password === "string" ? body.password : "";
      const minLength = minPasswordLengthForRole(actor.user.role);
      if (!evaluatePasswordStrength(newPassword, actor.user.email, { minLength })) {
        sendJson(res, 400, {
          error: `Mật khẩu mới phải tối thiểu ${minLength} ký tự và đáp ứng đủ tiêu chuẩn bảo mật.`
        });
        return;
      }
      const { salt, hash } = hashPasswordScrypt(newPassword);
      actor.user.passwordSalt = salt;
      actor.user.passwordHash = hash;
      actor.user.updated_at = new Date().toISOString();
      appendAuditLog({
        actorId: actor.user.id,
        actorEmail: actor.user.email,
        actorRole: actor.user.role,
        action: "auth.password_updated",
        targetType: "profile",
        targetId: actor.user.id,
        ipHash
      });
      persistStore();
      sendJson(res, 200, formatAuthUser(actor.user));
      return;
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      const clearCookie = buildSessionCookieHeader("", secrets.jwtSecret, 0);
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 200, { signedOut: true }, { "Set-Cookie": clearCookie });
        return;
      }
      const scope = reqUrl.searchParams.get("scope") || "local";
      if (scope === "global") {
        store.sessions = store.sessions.filter((s) => s.userId !== actor.user.id);
      } else {
        store.sessions = store.sessions.filter((s) => s.id !== actor.session.id);
      }
      appendAuditLog({
        actorId: actor.user.id,
        actorEmail: actor.user.email,
        actorRole: actor.user.role,
        action: "auth.logout",
        targetType: "session",
        details: { scope },
        ipHash
      });
      persistStore();
      sendJson(res, 200, { signedOut: true, scope }, { "Set-Cookie": clearCookie });
      return;
    }

    if (pathname === "/api/auth/factors" && method === "POST") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập để thiết lập 2FA." });
        return;
      }
      const body = await readJsonBody(req);
      const friendlyName = validText(body.friendly_name, 1, 60)
        ? body.friendly_name.trim()
        : "Rang May Authenticator";

      actor.user.totpFactors = (actor.user.totpFactors || []).filter((f) => f.status === "verified");

      const factorId = crypto.randomUUID();
      const secret = generateBase32Secret(20);
      const uri = buildOtpAuthUri({
        issuer: "Rang May Coffee",
        accountName: actor.user.email,
        secret
      });
      const svg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 180 });
      const qrCodeDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

      const factor = {
        id: factorId,
        factor_type: "totp",
        status: "unverified",
        friendly_name: friendlyName,
        secret,
        lastUsedStep: null,
        created_at: new Date().toISOString()
      };
      actor.user.totpFactors.push(factor);
      persistStore();

      sendJson(res, 200, {
        id: factor.id,
        type: "totp",
        factor_type: "totp",
        status: factor.status,
        friendly_name: factor.friendly_name,
        totp: {
          qr_code: qrCodeDataUrl,
          secret,
          uri
        }
      });
      return;
    }

    const challengeMatch = pathname.match(/^\/api\/auth\/factors\/([^/]+)\/challenge$/);
    if (challengeMatch && method === "POST") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập lại." });
        return;
      }
      const factorId = decodeURIComponent(challengeMatch[1]);
      const factor = (actor.user.totpFactors || []).find((f) => f.id === factorId);
      if (!factor) {
        sendJson(res, 404, { error: "Không tìm thấy thiết bị 2FA." });
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      store.mfaChallenges = store.mfaChallenges.filter((c) => c.expiresAt > nowSec);
      const challengeId = crypto.randomUUID();
      const expiresAt = nowSec + 300;
      store.mfaChallenges.push({
        id: challengeId,
        userId: actor.user.id,
        factorId: factor.id,
        expiresAt
      });
      persistStore();
      sendJson(res, 200, { id: challengeId, expires_at: expiresAt });
      return;
    }

    const verifyMatch = pathname.match(/^\/api\/auth\/factors\/([^/]+)\/verify$/);
    if (verifyMatch && method === "POST") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập lại." });
        return;
      }
      const factorId = decodeURIComponent(verifyMatch[1]);
      const factor = (actor.user.totpFactors || []).find((f) => f.id === factorId);
      if (!factor) {
        sendJson(res, 404, { error: "Không tìm thấy thiết bị 2FA." });
        return;
      }

      const body = await readJsonBody(req);
      const challengeId = typeof body.challenge_id === "string" ? body.challenge_id : "";
      const code = typeof body.code === "string" ? body.code.trim() : "";

      const nowSec = Math.floor(Date.now() / 1000);
      const challengeIndex = store.mfaChallenges.findIndex(
        (c) => c.id === challengeId && c.userId === actor.user.id && c.factorId === factor.id && c.expiresAt > nowSec
      );
      if (challengeIndex === -1) {
        sendJson(res, 400, { error: "Phiên thử thách 2FA đã hết hạn." });
        return;
      }

      const verifyRes = verifyTotpCode(factor.secret, code, {
        window: 1,
        lastUsedStep: factor.lastUsedStep ?? null
      });
      if (!verifyRes.valid) {
        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "auth.mfa_failed",
          targetType: "mfa_factor",
          targetId: factor.id,
          ipHash
        });
        persistStore();
        sendJson(res, 422, { error: "Mã TOTP 2FA không hợp lệ hoặc đã được sử dụng." });
        return;
      }

      store.mfaChallenges.splice(challengeIndex, 1);
      const isInitialActivation = factor.status !== "verified";
      factor.status = "verified";
      factor.lastUsedStep = verifyRes.step;

      let generatedCodes = null;
      if (isInitialActivation) {
        const rec = generateRecoveryCodesAndHashes(secrets.rateLimitSalt, 8);
        actor.user.recoveryCodeHashes = rec.hashes;
        generatedCodes = rec.codes;
      }

      const { cookieHeader, ...elevatedSession } = issueSessionTokens(actor.user, actor.session.id, "aal2");
      appendAuditLog({
        actorId: actor.user.id,
        actorEmail: actor.user.email,
        actorRole: actor.user.role,
        action: "auth.mfa_verified",
        targetType: "mfa_factor",
        targetId: factor.id,
        details: { aal: "aal2", initialActivation: isInitialActivation },
        ipHash
      });
      persistStore();
      sendJson(
        res,
        200,
        generatedCodes ? { ...elevatedSession, recovery_codes: generatedCodes } : elevatedSession,
        { "Set-Cookie": cookieHeader }
      );
      return;
    }

    if (pathname === "/api/auth/recovery-codes" && method === "POST") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập lại." });
        return;
      }
      const hasVerified = (actor.user.totpFactors || []).some((f) => f.status === "verified");
      if (!hasVerified || actor.aal !== "aal2") {
        sendJson(res, 403, { error: "Cần xác thực 2FA (AAL2) trước khi tạo lại mã khôi phục." });
        return;
      }
      const rec = generateRecoveryCodesAndHashes(secrets.rateLimitSalt, 8);
      actor.user.recoveryCodeHashes = rec.hashes;
      appendAuditLog({
        actorId: actor.user.id,
        actorEmail: actor.user.email,
        actorRole: actor.user.role,
        action: "auth.recovery_codes_rotated",
        targetType: "profile",
        targetId: actor.user.id,
        ipHash
      });
      persistStore();
      sendJson(res, 200, { recovery_codes: rec.codes });
      return;
    }

    if (pathname === "/api/auth/recovery-verify" && method === "POST") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập lại." });
        return;
      }
      const hasVerified = (actor.user.totpFactors || []).some((f) => f.status === "verified");
      if (!hasVerified) {
        sendJson(res, 400, { error: "Tài khoản chưa kích hoạt 2FA." });
        return;
      }
      const body = await readJsonBody(req);
      const rawCode = normalizeRecoveryCode(body.code);
      if (!/^[A-Z0-9]{8}$/.test(rawCode)) {
        sendJson(res, 422, { error: "Định dạng mã khôi phục không hợp lệ (8 ký tự XXXX-XXXX)." });
        return;
      }
      const candidateHash = crypto.createHash("sha256").update(`${rawCode}:${secrets.rateLimitSalt}`, "utf8").digest("hex");
      const candidateBuf = Buffer.from(candidateHash, "hex");
      const existingHashes = Array.isArray(actor.user.recoveryCodeHashes) ? actor.user.recoveryCodeHashes : [];
      const matchIdx = existingHashes.findIndex((h) => {
        try {
          const b = Buffer.from(h, "hex");
          return b.length === candidateBuf.length && crypto.timingSafeEqual(b, candidateBuf);
        } catch {
          return false;
        }
      });

      if (matchIdx === -1) {
        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "auth.mfa_recovery_failed",
          targetType: "mfa_recovery",
          ipHash
        });
        persistStore();
        sendJson(res, 422, { error: "Mã khôi phục không đúng hoặc đã được sử dụng." });
        return;
      }

      actor.user.recoveryCodeHashes.splice(matchIdx, 1);
      const { cookieHeader, ...elevatedSession } = issueSessionTokens(actor.user, actor.session.id, "aal2");
      appendAuditLog({
        actorId: actor.user.id,
        actorEmail: actor.user.email,
        actorRole: actor.user.role,
        action: "auth.mfa_recovery_used",
        targetType: "mfa_recovery",
        details: { remaining: actor.user.recoveryCodeHashes.length },
        ipHash
      });
      persistStore();
      sendJson(
        res,
        200,
        { ...elevatedSession, remaining_recovery_codes: actor.user.recoveryCodeHashes.length },
        { "Set-Cookie": cookieHeader }
      );
      return;
    }

    const factorDeleteMatch = pathname.match(/^\/api\/auth\/factors\/([^/]+)$/);
    if (factorDeleteMatch && method === "DELETE") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập lại." });
        return;
      }
      const factorId = decodeURIComponent(factorDeleteMatch[1]);
      const idx = (actor.user.totpFactors || []).findIndex((f) => f.id === factorId);
      if (idx === -1) {
        sendJson(res, 404, { error: "Không tìm thấy thiết bị 2FA." });
        return;
      }
      const target = actor.user.totpFactors[idx];
      if (target.status === "verified" && actor.aal !== "aal2") {
        sendJson(res, 403, { error: "Cần xác thực 2FA trước khi tắt yếu tố bảo mật này." });
        return;
      }

      actor.user.totpFactors.splice(idx, 1);
      const stillVerified = actor.user.totpFactors.some((f) => f.status === "verified");
      if (!stillVerified) {
        actor.session.aal = "aal1";
        actor.user.recoveryCodeHashes = [];
      }

      appendAuditLog({
        actorId: actor.user.id,
        actorEmail: actor.user.email,
        actorRole: actor.user.role,
        action: "auth.mfa_unenrolled",
        targetType: "mfa_factor",
        targetId: factorId,
        ipHash
      });
      persistStore();
      sendJson(res, 200, { id: factorId, deleted: true });
      return;
    }

    // EDGE FUNCTION EQUIVALENTS
    if (pathname === "/api/functions/create-order" && method === "POST") {
      const rate = checkSlidingWindow(windowBuckets, `order:${ipHash}`, 10, 10 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Bạn thao tác đặt hàng quá nhanh. Vui lòng thử lại sau ít phút." });
        return;
      }

      let optionalActor = null;
      if (req.headers.authorization && req.headers.authorization.toLowerCase().startsWith("bearer ")) {
        const token = req.headers.authorization.slice(7).trim();
        if (token && token !== "local-secure-anon") {
          optionalActor = resolveAuthActor(req);
        }
      }

      const body = await readJsonBody(req);
      if (isHoneypotTripped(body)) {
        appendAuditLog({
          actorEmail: typeof body.customer?.email === "string" ? body.customer.email : "bot",
          action: "security.honeypot_triggered",
          targetType: "create_order",
          ipHash
        });
        persistStore();
        sendJson(res, 400, { error: "Yêu cầu bị từ chối bởi bộ lọc chống spam." });
        return;
      }

      const customer = body.customer;
      const items = body.items;
      const paymentMethod = body.paymentMethod;
      const giftMessage = body.giftMessage;

      if (
        !customer ||
        !validText(customer.name, 2, 100) ||
        !validText(customer.phone, 10, 13) ||
        !isValidVietnamesePhone(customer.phone) ||
        (customer.email !== "" &&
          customer.email !== null &&
          customer.email !== undefined &&
          (typeof customer.email !== "string" || !isValidEmail(customer.email.trim()))) ||
        !validText(customer.address, 5, 500)
      ) {
        sendJson(res, 400, { error: "Thông tin người nhận chưa hợp lệ." });
        return;
      }

      if (
        !Array.isArray(items) ||
        items.length < 1 ||
        items.length > 10 ||
        paymentMethod !== "COD" ||
        (giftMessage !== undefined &&
          giftMessage !== "" &&
          (typeof giftMessage !== "string" || giftMessage.length > 1000))
      ) {
        sendJson(res, 400, { error: "Thông tin đơn hàng hoặc phương thức thanh toán chưa hợp lệ." });
        return;
      }

      const consolidatedQty = new Map();
      for (const rawItem of items) {
        const id = rawItem && typeof rawItem.id === "string" ? rawItem.id.trim() : "";
        const qty = rawItem && rawItem.quantity;
        if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) {
          sendJson(res, 400, { error: "Sản phẩm hoặc số lượng không hợp lệ." });
          return;
        }
        const nextQty = (consolidatedQty.get(id) || 0) + qty;
        if (nextQty > 99) {
          sendJson(res, 400, { error: "Số lượng mỗi dòng sản phẩm tối đa 99 hộp/đơn." });
          return;
        }
        consolidatedQty.set(id, nextQty);
      }

      const validatedOrderItems = [];
      const productsToDeduct = [];
      let subtotal = 0;

      for (const [id, quantity] of consolidatedQty.entries()) {
        const product = (store.catalog || []).find((p) => p.id === id);
        if (!product) {
          sendJson(res, 400, { error: "Sản phẩm hoặc số lượng không hợp lệ." });
          return;
        }
        if (!product.is_available || product.stock_quantity < quantity) {
          sendJson(res, 400, {
            error: product.is_available
              ? `Sản phẩm "${product.name}" hiện chỉ còn ${product.stock_quantity} hộp trong kho.`
              : `Sản phẩm "${product.name}" hiện đang tạm hết hàng.`
          });
          return;
        }
        const unitPrice = Number(product.price);
        validatedOrderItems.push({ id, name: product.name, quantity, unit_price: unitPrice });
        productsToDeduct.push({ product, quantity });
        subtotal += unitPrice * quantity;
      }

      const rawVoucherCode = typeof body.voucherCode === "string" ? body.voucherCode.trim().toUpperCase() : "";
      let matchedVoucher = null;
      let discountAmount = 0;

      if (rawVoucherCode) {
        if (!/^[A-Z0-9_-]{3,24}$/.test(rawVoucherCode)) {
          sendJson(res, 400, { error: "Định dạng mã giảm giá không hợp lệ." });
          return;
        }
        matchedVoucher = (store.vouchers || []).find((v) => v.code === rawVoucherCode) || null;
        const evaluated = evaluateVoucher(matchedVoucher, subtotal);
        if (!evaluated.ok) {
          sendJson(res, 400, { error: evaluated.error });
          return;
        }
        discountAmount = evaluated.discountAmount;
      }

      const deductStamp = new Date().toISOString();
      for (const entry of productsToDeduct) {
        entry.product.stock_quantity -= entry.quantity;
        entry.product.updated_at = deductStamp;
      }
      if (matchedVoucher) {
        matchedVoucher.used_count = (Number(matchedVoucher.used_count) || 0) + 1;
        matchedVoucher.updated_at = deductStamp;
      }

      store.orderSeq = (Number(store.orderSeq) || 0) + 1;
      const orderNumber = `RM-${new Date().getFullYear()}-${String(store.orderSeq).padStart(4, "0")}`;
      const now = new Date().toISOString();
      const newOrder = {
        id: crypto.randomUUID(),
        order_number: orderNumber,
        user_id: optionalActor ? optionalActor.user.id : null,
        customer_name: customer.name.trim(),
        customer_phone: customer.phone,
        customer_email:
          typeof customer.email === "string" && customer.email.trim()
            ? customer.email.trim()
            : optionalActor
              ? optionalActor.user.email
              : null,
        shipping_address: customer.address.trim(),
        items: validatedOrderItems,
        subtotal_amount: subtotal,
        voucher_code: matchedVoucher ? matchedVoucher.code : null,
        discount_amount: discountAmount,
        total_amount: subtotal - discountAmount,
        payment_method: "COD",
        status: "pending",
        gift_message: typeof giftMessage === "string" && giftMessage.trim() ? giftMessage.trim() : null,
        internal_note: null,
        updated_by: null,
        created_at: now,
        updated_at: now
      };
      store.orders.unshift(newOrder);
      appendAuditLog({
        actorId: optionalActor ? optionalActor.user.id : null,
        actorEmail: optionalActor ? optionalActor.user.email : newOrder.customer_email,
        actorRole: optionalActor ? optionalActor.user.role : "guest",
        action: "order.created",
        targetType: "order",
        targetId: newOrder.id,
        details: {
          orderNumber,
          subtotalAmount: subtotal,
          voucherCode: newOrder.voucher_code,
          discountAmount,
          totalAmount: newOrder.total_amount
        },
        ipHash
      });
      persistStore();
      sendJson(res, 201, {
        orderNumber,
        subtotalAmount: subtotal,
        discountAmount,
        totalAmount: newOrder.total_amount,
        voucherCode: newOrder.voucher_code || "",
        giftMessage: newOrder.gift_message || ""
      });
      return;
    }

    if (pathname === "/api/functions/create-contact" && method === "POST") {
      const rate = checkSlidingWindow(windowBuckets, `contact:${ipHash}`, 5, 10 * 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Bạn gửi liên hệ quá nhanh. Vui lòng thử lại sau ít phút." });
        return;
      }

      let optionalActor = null;
      if (req.headers.authorization && req.headers.authorization.toLowerCase().startsWith("bearer ")) {
        const token = req.headers.authorization.slice(7).trim();
        if (token && token !== "local-secure-anon") {
          optionalActor = resolveAuthActor(req);
        }
      }

      const body = await readJsonBody(req);
      if (isHoneypotTripped(body)) {
        appendAuditLog({
          actorEmail: typeof body.email === "string" ? body.email : "bot",
          action: "security.honeypot_triggered",
          targetType: "create_contact",
          ipHash
        });
        persistStore();
        sendJson(res, 400, { error: "Yêu cầu bị từ chối bởi bộ lọc chống spam." });
        return;
      }

      if (
        !validText(body.name, 2, 100) ||
        typeof body.email !== "string" ||
        !isValidEmail(body.email.trim()) ||
        !validText(body.message, 2, 2000) ||
        (body.phone !== "" &&
          body.phone !== null &&
          body.phone !== undefined &&
          (typeof body.phone !== "string" ||
            body.phone.length > 16 ||
            !isValidVietnamesePhone(body.phone.replace(/\s/g, ""))))
      ) {
        sendJson(res, 400, { error: "Thông tin liên hệ chưa hợp lệ." });
        return;
      }

      const now = new Date().toISOString();
      const contact = {
        id: crypto.randomUUID(),
        user_id: optionalActor ? optionalActor.user.id : null,
        name: body.name.trim(),
        email: body.email.trim(),
        phone: typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null,
        message: body.message.trim(),
        status: "new",
        handled_by: null,
        created_at: now,
        updated_at: now
      };
      store.contacts.unshift(contact);
      appendAuditLog({
        actorId: optionalActor ? optionalActor.user.id : null,
        actorEmail: contact.email,
        actorRole: optionalActor ? optionalActor.user.role : "guest",
        action: "contact.created",
        targetType: "contact_message",
        targetId: contact.id,
        ipHash
      });
      persistStore();
      sendJson(res, 201, { received: true });
      return;
    }

    if (pathname === "/api/functions/account-api") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập để tiếp tục.", code: "AUTH_REQUIRED" });
        return;
      }
      const rate = checkSlidingWindow(windowBuckets, `account:${actor.user.id}`, 60, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Quá nhiều yêu cầu. Vui lòng thử lại sau giây lát." });
        return;
      }

      if (method === "GET") {
        const myOrders = store.orders
          .filter((o) => o.user_id === actor.user.id)
          .slice(0, 50)
          .map((o) => ({
            id: o.id,
            order_number: o.order_number,
            customer_name: o.customer_name,
            customer_phone: o.customer_phone,
            shipping_address: o.shipping_address,
            items: o.items,
            total_amount: o.total_amount,
            payment_method: o.payment_method,
            status: o.status,
            gift_message: o.gift_message,
            created_at: o.created_at
          }));

        sendJson(res, 200, {
          profile: {
            id: actor.user.id,
            email: actor.user.email,
            fullName: actor.user.full_name,
            phone: actor.user.phone || "",
            defaultAddress: actor.user.default_address || "",
            role: actor.user.role,
            isActive: actor.user.is_active,
            recoveryCodesRemaining: (actor.user.recoveryCodeHashes || []).length
          },
          security: {
            aal: actor.aal,
            requireAdminMfa: Boolean(store.securityPolicy?.requireAdminMfa),
            minPasswordLength: minPasswordLengthForRole(actor.user.role),
            recoveryCodesRemaining: (actor.user.recoveryCodeHashes || []).length
          },
          orders: myOrders
        });
        return;
      }

      if (method === "PATCH") {
        const body = await readJsonBody(req);
        if (!validText(body.fullName, 2, 100)) {
          sendJson(res, 400, { error: "Họ và tên phải từ 2 đến 100 ký tự." });
          return;
        }
        let normalizedPhone = null;
        if (body.phone !== undefined && body.phone !== null && body.phone !== "") {
          if (typeof body.phone !== "string" || body.phone.trim().length > 16) {
            sendJson(res, 400, { error: "Số điện thoại chưa hợp lệ." });
            return;
          }
          const compact = body.phone.replace(/\s/g, "");
          if (!isValidVietnamesePhone(compact)) {
            sendJson(res, 400, { error: "Số điện thoại phải đúng định dạng Việt Nam (0... hoặc +84...)." });
            return;
          }
          normalizedPhone = compact;
        }
        let normalizedAddress = null;
        if (body.defaultAddress !== undefined && body.defaultAddress !== null && body.defaultAddress !== "") {
          if (!validText(body.defaultAddress, 5, 500)) {
            sendJson(res, 400, { error: "Địa chỉ mặc định phải từ 5 đến 500 ký tự." });
            return;
          }
          normalizedAddress = body.defaultAddress.trim();
        }

        actor.user.full_name = body.fullName.trim();
        actor.user.phone = normalizedPhone;
        actor.user.default_address = normalizedAddress;
        actor.user.updated_at = new Date().toISOString();
        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "profile.updated",
          targetType: "profile",
          targetId: actor.user.id,
          ipHash
        });
        persistStore();
        sendJson(res, 200, {
          profile: {
            id: actor.user.id,
            email: actor.user.email,
            fullName: actor.user.full_name,
            phone: actor.user.phone || "",
            defaultAddress: actor.user.default_address || "",
            role: actor.user.role,
            isActive: actor.user.is_active,
            recoveryCodesRemaining: (actor.user.recoveryCodeHashes || []).length
          }
        });
        return;
      }

      sendJson(res, 405, { error: "Phương thức không được hỗ trợ." });
      return;
    }

    // PORTAL 1: ADMIN / OWNER ONLY (/api/functions/admin-api)
    if (pathname === "/api/functions/admin-api") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập để tiếp tục.", code: "AUTH_REQUIRED" });
        return;
      }
      if (actor.user.role !== "admin") {
        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "access.denied",
          targetType: "edge_function",
          targetId: pathname,
          details: { requiredRoles: ["admin"] },
          ipHash
        });
        persistStore();
        sendJson(res, 403, { error: "Chỉ Chủ cửa hàng (Admin) mới có quyền truy cập trang quản trị hệ thống.", code: "FORBIDDEN_ROLE" });
        return;
      }

      enforceAdminMfaGate(actor, pathname, ipHash);

      const rate = checkSlidingWindow(windowBuckets, `admin:${actor.user.id}`, 120, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Quá nhiều thao tác quản trị. Vui lòng thử lại sau." });
        return;
      }

      if (method === "GET") {
        const biz = computeBusinessSummary(store.orders, store.contacts, store.catalog);
        sendJson(res, 200, {
          actor: {
            id: actor.user.id,
            email: actor.user.email,
            fullName: actor.user.full_name,
            role: actor.user.role,
            canEditPrice: actor.user.role === "admin" || Boolean(actor.user.can_edit_price),
            aal: actor.aal,
            requireAdminMfa: Boolean(store.securityPolicy?.requireAdminMfa)
          },
          summary: {
            ...biz,
            totalUsers: store.users.length
          },
          orders: store.orders.slice(0, 100),
          contacts: store.contacts.slice(0, 100),
          catalog: (store.catalog || []).map(formatCatalogProduct),
          users: store.users.map(formatPublicProfile),
          auditLogs: store.auditLogs.slice(0, 50),
          securityCenter: buildSecurityCenter()
        });
        return;
      }

      if (method === "PATCH") {
        const body = await readJsonBody(req);
        const action = body.action;

        if (action === "update_order") {
          const { orderId, status, internalNote } = body;
          if (
            !isValidUuid(orderId) ||
            typeof status !== "string" ||
            !ORDER_STATUSES.has(status) ||
            (internalNote !== undefined &&
              internalNote !== null &&
              (typeof internalNote !== "string" || internalNote.length > 1000))
          ) {
            sendJson(res, 400, { error: "Dữ liệu cập nhật đơn hàng không hợp lệ." });
            return;
          }
          const order = store.orders.find((o) => o.id === orderId);
          if (!order) {
            sendJson(res, 404, { error: "Không tìm thấy đơn hàng." });
            return;
          }
          const prevStatus = order.status;
          restoreOrderStockIfCancelled(order, prevStatus, status);
          order.status = status;
          order.internal_note = typeof internalNote === "string" && internalNote.trim() ? internalNote.trim() : null;
          order.updated_by = actor.user.id;
          order.updated_at = new Date().toISOString();

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "order.status_updated",
            targetType: "order",
            targetId: order.id,
            details: { orderNumber: order.order_number, previousStatus: prevStatus, nextStatus: status },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { order });
          return;
        }

        if (action === "update_contact") {
          const { contactId, status } = body;
          if (!isValidUuid(contactId) || typeof status !== "string" || !CONTACT_STATUSES.has(status)) {
            sendJson(res, 400, { error: "Dữ liệu cập nhật liên hệ không hợp lệ." });
            return;
          }
          const contact = store.contacts.find((c) => c.id === contactId);
          if (!contact) {
            sendJson(res, 404, { error: "Không tìm thấy tin nhắn liên hệ." });
            return;
          }
          const prevStatus = contact.status;
          contact.status = status;
          contact.handled_by = actor.user.id;
          contact.updated_at = new Date().toISOString();

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "contact.status_updated",
            targetType: "contact_message",
            targetId: contact.id,
            details: { previousStatus: prevStatus, nextStatus: status },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { contact });
          return;
        }

        if (action === "create_user") {
          const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
          const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          const password = typeof body.password === "string" ? body.password : "";
          const role = body.role;

          if (!validText(fullName, 2, 100) || !isValidEmail(email) || typeof role !== "string" || !USER_ROLES.has(role)) {
            sendJson(res, 400, { error: "Thông tin tạo tài khoản nhân sự chưa hợp lệ." });
            return;
          }
          const requiredMinLen = minPasswordLengthForRole(role);
          if (!evaluatePasswordStrength(password, email, { minLength: requiredMinLen })) {
            sendJson(res, 400, {
              error: `Mật khẩu cho vai trò ${role} phải tối thiểu ${requiredMinLen} ký tự, đủ chữ hoa/thường/số/ký tự đặc biệt và không dễ đoán.`
            });
            return;
          }
          if (store.users.some((u) => u.email.toLowerCase() === email)) {
            sendJson(res, 409, { error: "Email tài khoản đã tồn tại trong hệ thống." });
            return;
          }

          const now = new Date().toISOString();
          const { salt, hash } = hashPasswordScrypt(password);
          const canEditPrice = role === "admin" ? true : role === "manager" ? Boolean(body.canEditPrice) : false;
          const created = {
            id: crypto.randomUUID(),
            email,
            full_name: fullName,
            phone: null,
            default_address: null,
            role,
            can_edit_price: canEditPrice,
            is_active: true,
            passwordHash: hash,
            passwordSalt: salt,
            totpFactors: [],
            recoveryCodeHashes: [],
            created_at: now,
            updated_at: now
          };
          store.users.unshift(created);
          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "user.created",
            targetType: "profile",
            targetId: created.id,
            details: { targetEmail: created.email, role: created.role, canEditPrice },
            ipHash
          });
          persistStore();
          sendJson(res, 201, { user: formatPublicProfile(created) });
          return;
        }

        if (action === "update_product") {
          const { productId, price, stockQuantity, isAvailable, badgeText } = body;
          const prod = (store.catalog || []).find((p) => p.id === productId);
          if (!prod) {
            sendJson(res, 404, { error: "Không tìm thấy sản phẩm trong danh mục." });
            return;
          }
          if (
            !Number.isInteger(price) || price < 10000 || price > 5000000 ||
            !Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 10000 ||
            typeof isAvailable !== "boolean" ||
            (badgeText !== undefined && badgeText !== null && (typeof badgeText !== "string" || badgeText.trim().length > 120))
          ) {
            sendJson(res, 400, { error: "Giá bán (10.000–5.000.000đ), tồn kho (0–10.000) hoặc trạng thái bán chưa hợp lệ." });
            return;
          }
          const prevPrice = prod.price;
          const prevStock = prod.stock_quantity;
          prod.price = price;
          prod.stock_quantity = stockQuantity;
          prod.is_available = isAvailable;
          if (typeof badgeText === "string") {
            prod.badge_text = badgeText.trim();
          }
          prod.updated_at = new Date().toISOString();
          prod.updated_by = actor.user.email;

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: prevPrice !== price ? "product.price_updated" : "product.updated",
            targetType: "store_product",
            targetId: prod.id,
            details: { prevPrice, nextPrice: price, prevStock, nextStock: stockQuantity, isAvailable },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { product: formatCatalogProduct(prod) });
          return;
        }

        if (action === "update_user") {
          const { userId, role: nextRole, isActive } = body;
          if (!isValidUuid(userId) || typeof nextRole !== "string" || !USER_ROLES.has(nextRole) || typeof isActive !== "boolean") {
            sendJson(res, 400, { error: "Dữ liệu phân quyền tài khoản không hợp lệ." });
            return;
          }
          if (userId === actor.user.id && !isActive) {
            sendJson(res, 400, { error: "Không thể tự khóa tài khoản quản trị đang đăng nhập." });
            return;
          }
          if (userId === actor.user.id && nextRole !== "admin") {
            sendJson(res, 400, { error: "Không thể tự hạ quyền tài khoản quản trị đang đăng nhập." });
            return;
          }
          const targetUser = store.users.find((u) => u.id === userId);
          if (!targetUser) {
            sendJson(res, 404, { error: "Không tìm thấy tài khoản người dùng." });
            return;
          }
          if (targetUser.role === "admin" && targetUser.is_active && (nextRole !== "admin" || !isActive)) {
            const otherAdmins = store.users.filter((u) => u.role === "admin" && u.is_active && u.id !== userId).length;
            if (otherAdmins === 0) {
              sendJson(res, 400, { error: "Hệ thống cần duy trì ít nhất một Quản trị viên đang hoạt động." });
              return;
            }
          }

          const prevRole = targetUser.role;
          const prevActive = targetUser.is_active;
          const prevCanEditPrice = targetUser.role === "admin" || Boolean(targetUser.can_edit_price);
          const nextCanEditPrice =
            nextRole === "admin"
              ? true
              : nextRole === "manager"
                ? typeof body.canEditPrice === "boolean"
                  ? body.canEditPrice
                  : Boolean(targetUser.can_edit_price)
                : false;

          targetUser.role = nextRole;
          targetUser.is_active = isActive;
          targetUser.can_edit_price = nextCanEditPrice;
          targetUser.updated_at = new Date().toISOString();

          if (!isActive || prevRole !== nextRole) {
            store.sessions = store.sessions.filter((s) => s.userId !== userId);
          }

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "user.permissions_updated",
            targetType: "profile",
            targetId: userId,
            details: {
              targetEmail: targetUser.email,
              previousRole: prevRole,
              nextRole,
              previousActive: prevActive,
              nextActive: isActive,
              previousCanEditPrice: prevCanEditPrice,
              nextCanEditPrice
            },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { user: formatPublicProfile(targetUser) });
          return;
        }

        if (action === "revoke_user_sessions") {
          const { userId } = body;
          if (!isValidUuid(userId)) {
            sendJson(res, 400, { error: "Mã tài khoản không hợp lệ." });
            return;
          }
          if (userId === actor.user.id) {
            sendJson(res, 400, { error: "Dùng nút Đăng xuất để kết thúc phiên hiện tại của chính bạn." });
            return;
          }
          const targetUser = store.users.find((u) => u.id === userId);
          if (!targetUser) {
            sendJson(res, 404, { error: "Không tìm thấy tài khoản." });
            return;
          }
          const beforeCount = store.sessions.length;
          store.sessions = store.sessions.filter((s) => s.userId !== userId);
          const revokedCount = beforeCount - store.sessions.length;

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "user.sessions_revoked",
            targetType: "profile",
            targetId: userId,
            details: { targetEmail: targetUser.email, revokedSessions: revokedCount },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { revoked: true, count: revokedCount });
          return;
        }

        if (action === "update_security_policy") {
          const requireAdminMfa = body.requireAdminMfa;
          if (typeof requireAdminMfa !== "boolean") {
            sendJson(res, 400, { error: "Giá trị chính sách 2FA không hợp lệ." });
            return;
          }
          const actorHas2fa = (actor.user.totpFactors || []).some((f) => f.status === "verified");
          if (requireAdminMfa && (!actorHas2fa || actor.aal !== "aal2")) {
            sendJson(res, 400, {
              error: "Bạn phải bật 2FA và đăng nhập xác thực AAL2 cho tài khoản Admin hiện tại trước khi bật chế độ bắt buộc toàn hệ thống."
            });
            return;
          }
          store.securityPolicy = {
            requireAdminMfa,
            updatedAt: new Date().toISOString(),
            updatedByEmail: actor.user.email
          };
          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "security.policy_updated",
            targetType: "security_policy",
            targetId: "default",
            details: { requireAdminMfa },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { securityPolicy: store.securityPolicy });
          return;
        }

        if (action === "unlock_lockouts") {
          const targetEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          let cleared = 0;
          if (targetEmail) {
            for (const key of loginFailBuckets.keys()) {
              if (key.endsWith(`:${targetEmail}`)) {
                loginFailBuckets.delete(key);
                cleared += 1;
              }
            }
          } else {
            cleared = loginFailBuckets.size;
            loginFailBuckets.clear();
          }
          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "security.lockouts_cleared",
            targetType: "rate_limit",
            details: { targetEmail: targetEmail || "all", clearedEntries: cleared },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { clearedCount: cleared });
          return;
        }

        if (action === "save_checklist") {
          const rawIds = body.checkedIds;
          if (!Array.isArray(rawIds)) {
            sendJson(res, 400, { error: "Danh sách mục checklist không hợp lệ." });
            return;
          }
          const cleanIds = [...new Set(rawIds.filter((id) => typeof id === "string" && CHECKLIST_ID_SET.has(id)))];
          const now = new Date().toISOString();
          store.checklist = {
            checkedIds: cleanIds,
            updatedAt: now,
            updatedByEmail: actor.user.email
          };
          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "security.checklist_updated",
            targetType: "security_checklist",
            targetId: "default",
            details: { checkedCount: cleanIds.length, totalCount: CHECKLIST_ITEMS.length },
            ipHash
          });
          persistStore();
          sendJson(res, 200, {
            checklist: {
              items: CHECKLIST_ITEMS,
              ...store.checklist
            }
          });
          return;
        }

        if (action === "create_backup") {
          const { snapshot, encryptedEnvelope } = createEncryptedBackupInternal(actor.user, {
            reason: "manual_snapshot",
            ipHash
          });
          persistStore();
          sendJson(res, 200, { snapshot, encryptedEnvelope, payload: encryptedEnvelope });
          return;
        }

        if (action === "restore_drill") {
          const startMs = Date.now();
          const filename = typeof body.filename === "string" ? body.filename.trim() : "";
          const verified = decryptAndVerifyBackupFile(filename);
          const rtoMs = Math.max(1, Date.now() - startMs);

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "security.restore_drill_passed",
            targetType: "backup_snapshot",
            targetId: filename,
            details: { rtoMs, checksumValid: verified.checksumValid, decrypted: verified.encrypted },
            ipHash
          });
          persistStore();
          sendJson(res, 200, {
            ok: true,
            filename,
            rtoMs,
            checksumValid: verified.checksumValid,
            decrypted: verified.encrypted,
            backupCounts: verified.payload.recordCounts || {
              orders: verified.payload.orders.length,
              contacts: verified.payload.contacts.length,
              profiles: verified.payload.profiles.length
            },
            currentCounts: {
              orders: store.orders.length,
              contacts: store.contacts.length,
              profiles: store.users.length
            }
          });
          return;
        }

        if (action === "restore_backup") {
          const filename = typeof body.filename === "string" ? body.filename.trim() : "";
          const verified = decryptAndVerifyBackupFile(filename);
          const { snapshot: safetySnapshot } = createEncryptedBackupInternal(actor.user, {
            reason: "pre_restore_safety",
            ipHash
          });

          const payload = verified.payload;
          store.orders = JSON.parse(JSON.stringify(payload.orders));
          store.contacts = JSON.parse(JSON.stringify(payload.contacts));
          if (Array.isArray(payload.catalog) && payload.catalog.length > 0) {
            store.catalog = JSON.parse(JSON.stringify(payload.catalog));
          }
          if (Array.isArray(payload.vouchers)) {
            store.vouchers = JSON.parse(JSON.stringify(payload.vouchers));
          }
          if (payload.checklist && Array.isArray(payload.checklist.checkedIds)) {
            store.checklist = {
              checkedIds: payload.checklist.checkedIds.filter((id) => CHECKLIST_ID_SET.has(id)),
              updatedAt: new Date().toISOString(),
              updatedByEmail: actor.user.email
            };
          }
          const maxSeq = store.orders.reduce((max, o) => {
            const m = String(o.order_number || "").match(/(\d+)$/);
            return Math.max(max, m ? Number.parseInt(m[1], 10) : 0);
          }, 0);
          store.orderSeq = Math.max(store.orderSeq || 0, maxSeq);

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "security.backup_restored",
            targetType: "backup_snapshot",
            targetId: filename,
            details: {
              safetySnapshot: safetySnapshot.filename,
              restoredOrders: store.orders.length,
              restoredContacts: store.contacts.length
            },
            ipHash
          });
          persistStore();
          sendJson(res, 200, {
            ok: true,
            restoredFilename: filename,
            safetySnapshot,
            restoredCounts: {
              orders: store.orders.length,
              contacts: store.contacts.length
            }
          });
          return;
        }

        sendJson(res, 400, { error: "Hành động quản trị không hợp lệ." });
        return;
      }

      sendJson(res, 405, { error: "Phương thức không được hỗ trợ." });
      return;
    }

    // PORTAL 2: SHOP MANAGER & OWNER (/api/functions/manager-api)
    if (pathname === "/api/functions/manager-api") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập để tiếp tục.", code: "AUTH_REQUIRED" });
        return;
      }
      if (actor.user.role !== "admin" && actor.user.role !== "manager") {
        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "access.denied",
          targetType: "edge_function",
          targetId: pathname,
          details: { requiredRoles: ["admin", "manager"] },
          ipHash
        });
        persistStore();
        sendJson(res, 403, { error: "Chỉ Quản lý cửa hàng hoặc Chủ cửa hàng mới được truy cập trang này.", code: "FORBIDDEN_ROLE" });
        return;
      }

      enforceAdminMfaGate(actor, pathname, ipHash);

      const rate = checkSlidingWindow(windowBuckets, `manager:${actor.user.id}`, 120, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Quá nhiều thao tác. Vui lòng thử lại sau." });
        return;
      }

      if (method === "GET") {
        const staffRoster = store.users
          .filter((u) => u.role === "staff")
          .map((u) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            is_active: Boolean(u.is_active),
            has_2fa: (u.totpFactors || []).some((f) => f.status === "verified")
          }));

        sendJson(res, 200, {
          actor: {
            id: actor.user.id,
            email: actor.user.email,
            fullName: actor.user.full_name,
            role: actor.user.role,
            canEditPrice: actor.user.role === "admin" || Boolean(actor.user.can_edit_price),
            aal: actor.aal,
            requireAdminMfa: Boolean(store.securityPolicy?.requireAdminMfa)
          },
          summary: computeBusinessSummary(store.orders, store.contacts, store.catalog),
          catalog: (store.catalog || []).map(formatCatalogProduct),
          vouchers: (store.vouchers || []).map(formatVoucherAdmin),
          orders: store.orders.slice(0, 100),
          contacts: store.contacts.slice(0, 100),
          staffRoster
        });
        return;
      }

      if (method === "PATCH") {
        const body = await readJsonBody(req);
        const action = body.action;

        if (action === "update_order") {
          const { orderId, status, internalNote } = body;
          if (
            !isValidUuid(orderId) ||
            typeof status !== "string" ||
            !ORDER_STATUSES.has(status) ||
            (internalNote !== undefined &&
              internalNote !== null &&
              (typeof internalNote !== "string" || internalNote.length > 1000))
          ) {
            sendJson(res, 400, { error: "Dữ liệu cập nhật đơn hàng không hợp lệ." });
            return;
          }
          const order = store.orders.find((o) => o.id === orderId);
          if (!order) {
            sendJson(res, 404, { error: "Không tìm thấy đơn hàng." });
            return;
          }
          const prevStatus = order.status;
          restoreOrderStockIfCancelled(order, prevStatus, status);
          order.status = status;
          order.internal_note = typeof internalNote === "string" && internalNote.trim() ? internalNote.trim() : null;
          order.updated_by = actor.user.id;
          order.updated_at = new Date().toISOString();

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "order.status_updated",
            targetType: "order",
            targetId: order.id,
            details: { orderNumber: order.order_number, previousStatus: prevStatus, nextStatus: status },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { order });
          return;
        }

        if (action === "update_contact") {
          const { contactId, status } = body;
          if (!isValidUuid(contactId) || typeof status !== "string" || !CONTACT_STATUSES.has(status)) {
            sendJson(res, 400, { error: "Dữ liệu cập nhật liên hệ không hợp lệ." });
            return;
          }
          const contact = store.contacts.find((c) => c.id === contactId);
          if (!contact) {
            sendJson(res, 404, { error: "Không tìm thấy tin nhắn liên hệ." });
            return;
          }
          const prevStatus = contact.status;
          contact.status = status;
          contact.handled_by = actor.user.id;
          contact.updated_at = new Date().toISOString();

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "contact.status_updated",
            targetType: "contact_message",
            targetId: contact.id,
            details: { previousStatus: prevStatus, nextStatus: status },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { contact });
          return;
        }

        if (action === "update_product") {
          const { productId, stockQuantity, isAvailable, badgeText } = body;
          const prod = (store.catalog || []).find((p) => p.id === productId);
          if (!prod) {
            sendJson(res, 404, { error: "Không tìm thấy sản phẩm trong danh mục." });
            return;
          }
          const price = body.price === undefined ? prod.price : body.price;
          if (
            !Number.isInteger(price) || price < 10000 || price > 5000000 ||
            !Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 10000 ||
            typeof isAvailable !== "boolean" ||
            (badgeText !== undefined && badgeText !== null && (typeof badgeText !== "string" || badgeText.trim().length > 120))
          ) {
            sendJson(res, 400, { error: "Giá bán (10.000–5.000.000đ), tồn kho (0–10.000) hoặc trạng thái bán chưa hợp lệ." });
            return;
          }

          const hasPricePerm = actor.user.role === "admin" || Boolean(actor.user.can_edit_price);
          if (price !== prod.price && !hasPricePerm) {
            appendAuditLog({
              actorId: actor.user.id,
              actorEmail: actor.user.email,
              actorRole: actor.user.role,
              action: "access.denied",
              targetType: "store_product",
              targetId: prod.id,
              details: { reason: "missing_can_edit_price", currentPrice: prod.price, attemptedPrice: price },
              ipHash
            });
            persistStore();
            sendJson(res, 403, {
              error: "Tài khoản Quản lý của bạn chưa được Chủ cửa hàng cấp quyền sửa giá bán. Bạn chỉ được phép cập nhật tồn kho và trạng thái mở bán.",
              code: "FORBIDDEN_PRICE_EDIT"
            });
            return;
          }

          const prevPrice = prod.price;
          const prevStock = prod.stock_quantity;
          prod.price = price;
          prod.stock_quantity = stockQuantity;
          prod.is_available = isAvailable;
          if (typeof badgeText === "string") {
            prod.badge_text = badgeText.trim();
          }
          prod.updated_at = new Date().toISOString();
          prod.updated_by = actor.user.email;

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: prevPrice !== price ? "product.price_updated" : "product.updated",
            targetType: "store_product",
            targetId: prod.id,
            details: { prevPrice, nextPrice: price, prevStock, nextStock: stockQuantity, isAvailable },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { product: formatCatalogProduct(prod) });
          return;
        }

        if (action === "upsert_voucher") {
          const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
          const discountType = body.discountType;
          const discountValue = body.discountValue;
          const minOrderAmount = body.minOrderAmount ?? 0;
          const maxDiscountAmount =
            body.maxDiscountAmount === null || body.maxDiscountAmount === "" || body.maxDiscountAmount === undefined
              ? null
              : Number(body.maxDiscountAmount);
          const usageLimit = body.usageLimit ?? 100;
          const description = typeof body.description === "string" ? body.description.trim() : "";
          const isActive = body.isActive !== false;

          const validValue =
            discountType === "percent"
              ? Number.isInteger(discountValue) && discountValue >= 1 && discountValue <= 90
              : discountType === "fixed" && Number.isInteger(discountValue) && discountValue >= 1000 && discountValue <= 2000000;

          if (
            !/^[A-Z0-9_-]{3,24}$/.test(code) ||
            !validValue ||
            !Number.isInteger(minOrderAmount) ||
            minOrderAmount < 0 ||
            minOrderAmount > 10000000 ||
            (maxDiscountAmount !== null &&
              (!Number.isInteger(maxDiscountAmount) || maxDiscountAmount < 1000 || maxDiscountAmount > 2000000)) ||
            !Number.isInteger(usageLimit) ||
            usageLimit < 1 ||
            usageLimit > 100000 ||
            description.length > 160
          ) {
            sendJson(res, 400, { error: "Thông tin mã giảm giá chưa hợp lệ (mã 3–24 ký tự A-Z/0-9, mức giảm % 1–90 hoặc VND >=1.000đ)." });
            return;
          }

          if (!Array.isArray(store.vouchers)) store.vouchers = [];
          const now = new Date().toISOString();
          let target = store.vouchers.find((v) => v.code === code);
          const isNew = !target;
          if (!target) {
            target = {
              code,
              used_count: 0,
              expires_at: null,
              created_at: now
            };
            store.vouchers.unshift(target);
          }
          target.description = description;
          target.discount_type = discountType;
          target.discount_value = discountValue;
          target.min_order_amount = minOrderAmount;
          target.max_discount_amount = discountType === "percent" ? maxDiscountAmount : null;
          target.usage_limit = usageLimit;
          target.is_active = Boolean(isActive);
          target.updated_by = actor.user.email;
          target.updated_at = now;

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: isNew ? "voucher.created" : "voucher.updated",
            targetType: "store_voucher",
            targetId: code,
            details: { discountType, discountValue, minOrderAmount, usageLimit, isActive: target.is_active },
            ipHash
          });
          persistStore();
          sendJson(res, isNew ? 201 : 200, { voucher: formatVoucherAdmin(target) });
          return;
        }

        if (action === "toggle_voucher") {
          const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
          const isActive = body.isActive;
          if (!/^[A-Z0-9_-]{3,24}$/.test(code) || typeof isActive !== "boolean") {
            sendJson(res, 400, { error: "Dữ liệu bật/tắt mã giảm giá không hợp lệ." });
            return;
          }
          const target = (store.vouchers || []).find((v) => v.code === code);
          if (!target) {
            sendJson(res, 404, { error: "Không tìm thấy mã giảm giá." });
            return;
          }
          target.is_active = isActive;
          target.updated_by = actor.user.email;
          target.updated_at = new Date().toISOString();

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "voucher.toggled",
            targetType: "store_voucher",
            targetId: code,
            details: { isActive },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { voucher: formatVoucherAdmin(target) });
          return;
        }

        if (action === "delete_voucher") {
          const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
          const idx = (store.vouchers || []).findIndex((v) => v.code === code);
          if (idx === -1) {
            sendJson(res, 404, { error: "Không tìm thấy mã giảm giá để xóa." });
            return;
          }
          store.vouchers.splice(idx, 1);
          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "voucher.deleted",
            targetType: "store_voucher",
            targetId: code,
            details: {},
            ipHash
          });
          persistStore();
          sendJson(res, 200, { deleted: code });
          return;
        }

        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "access.denied",
          targetType: "manager_api",
          targetId: typeof action === "string" ? action : "unknown",
          details: { attemptedAction: action },
          ipHash
        });
        persistStore();
        sendJson(res, 403, { error: "Thao tác phân quyền hoặc bảo mật hệ thống chỉ thuộc về Chủ cửa hàng (Admin)." });
        return;
      }

      sendJson(res, 405, { error: "Phương thức không được hỗ trợ." });
      return;
    }

    // PORTAL 3: ORDER FULFILLMENT STAFF + SUPERVISORS (/api/functions/staff-api)
    if (pathname === "/api/functions/staff-api") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập để tiếp tục.", code: "AUTH_REQUIRED" });
        return;
      }
      if (!PRIVILEGED_ROLES.has(actor.user.role)) {
        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "access.denied",
          targetType: "edge_function",
          targetId: pathname,
          details: { requiredRoles: ["admin", "manager", "staff"] },
          ipHash
        });
        persistStore();
        sendJson(res, 403, { error: "Tài khoản khách hàng không được phép truy cập bàn làm việc nhân viên.", code: "FORBIDDEN_ROLE" });
        return;
      }

      enforceAdminMfaGate(actor, pathname, ipHash);

      const rate = checkSlidingWindow(windowBuckets, `staff:${actor.user.id}`, 120, 60 * 1000);
      if (!rate.allowed) {
        sendJson(res, 429, { error: "Quá nhiều thao tác. Vui lòng thử lại sau." });
        return;
      }

      if (method === "GET") {
        const pendingOrders = store.orders.filter((o) => o.status === "pending").length;
        const confirmedOrders = store.orders.filter((o) => o.status === "confirmed").length;
        const shippedOrders = store.orders.filter((o) => o.status === "shipped").length;
        const completedOrders = store.orders.filter((o) => o.status === "completed").length;
        const newContacts = store.contacts.filter((c) => (c.status || "new") === "new").length;

        sendJson(res, 200, {
          actor: {
            id: actor.user.id,
            email: actor.user.email,
            fullName: actor.user.full_name,
            role: actor.user.role,
            canEditPrice: actor.user.role === "admin" || Boolean(actor.user.can_edit_price),
            aal: actor.aal,
            requireAdminMfa: Boolean(store.securityPolicy?.requireAdminMfa)
          },
          summary: {
            pendingOrders,
            confirmedOrders,
            shippedOrders,
            completedOrders,
            newContacts
          },
          orders: store.orders.slice(0, 100),
          contacts: store.contacts.slice(0, 100)
        });
        return;
      }

      if (method === "PATCH") {
        const body = await readJsonBody(req);
        const action = body.action;

        if (action === "update_order") {
          const { orderId, status, internalNote } = body;
          if (
            !isValidUuid(orderId) ||
            typeof status !== "string" ||
            !ORDER_STATUSES.has(status) ||
            (internalNote !== undefined &&
              internalNote !== null &&
              (typeof internalNote !== "string" || internalNote.length > 1000))
          ) {
            sendJson(res, 400, { error: "Dữ liệu cập nhật đơn hàng không hợp lệ." });
            return;
          }

          const order = store.orders.find((o) => o.id === orderId);
          if (!order) {
            sendJson(res, 404, { error: "Không tìm thấy đơn hàng." });
            return;
          }

          if (actor.user.role === "staff" && (!STAFF_ORDER_STATUSES.has(status) || order.status === "cancelled")) {
            appendAuditLog({
              actorId: actor.user.id,
              actorEmail: actor.user.email,
              actorRole: actor.user.role,
              action: "access.denied",
              targetType: "order",
              targetId: order.id,
              details: { reason: "staff_cannot_cancel_or_reopen_cancelled", currentStatus: order.status, requestedStatus: status },
              ipHash
            });
            persistStore();
            sendJson(res, 403, {
              error: "Nhân viên không có quyền hủy hoặc sửa đơn đã hủy. Vui lòng báo Quản lý cửa hàng hoặc Chủ cửa hàng.",
              code: "FORBIDDEN_ORDER_CANCEL"
            });
            return;
          }

          const prevStatus = order.status;
          restoreOrderStockIfCancelled(order, prevStatus, status);
          order.status = status;
          order.internal_note = typeof internalNote === "string" && internalNote.trim() ? internalNote.trim() : null;
          order.updated_by = actor.user.id;
          order.updated_at = new Date().toISOString();

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "order.status_updated",
            targetType: "order",
            targetId: order.id,
            details: { orderNumber: order.order_number, previousStatus: prevStatus, nextStatus: status },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { order });
          return;
        }

        if (action === "update_contact") {
          const { contactId, status } = body;
          if (!isValidUuid(contactId) || typeof status !== "string" || !CONTACT_STATUSES.has(status)) {
            sendJson(res, 400, { error: "Dữ liệu cập nhật liên hệ không hợp lệ." });
            return;
          }
          const contact = store.contacts.find((c) => c.id === contactId);
          if (!contact) {
            sendJson(res, 404, { error: "Không tìm thấy tin nhắn liên hệ." });
            return;
          }
          const prevStatus = contact.status;
          contact.status = status;
          contact.handled_by = actor.user.id;
          contact.updated_at = new Date().toISOString();

          appendAuditLog({
            actorId: actor.user.id,
            actorEmail: actor.user.email,
            actorRole: actor.user.role,
            action: "contact.status_updated",
            targetType: "contact_message",
            targetId: contact.id,
            details: { previousStatus: prevStatus, nextStatus: status },
            ipHash
          });
          persistStore();
          sendJson(res, 200, { contact });
          return;
        }

        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "access.denied",
          targetType: "staff_api",
          targetId: typeof action === "string" ? action : "unknown",
          details: { attemptedAction: action },
          ipHash
        });
        persistStore();
        sendJson(res, 403, { error: "Nhân viên chỉ được cập nhật tiến độ xử lý đơn và phản hồi liên hệ." });
        return;
      }

      sendJson(res, 405, { error: "Phương thức không được hỗ trợ." });
      return;
    }

    if (pathname === "/api/functions/admin-backup" && method === "GET") {
      const actor = resolveAuthActor(req);
      if (!actor) {
        sendJson(res, 401, { error: "Vui lòng đăng nhập để tải bản sao lưu.", code: "AUTH_REQUIRED" });
        return;
      }
      if (actor.user.role !== "admin") {
        appendAuditLog({
          actorId: actor.user.id,
          actorEmail: actor.user.email,
          actorRole: actor.user.role,
          action: "access.denied",
          targetType: "backup_download",
          targetId: reqUrl.searchParams.get("file") || "",
          ipHash
        });
        persistStore();
        sendJson(res, 403, { error: "Chỉ Chủ cửa hàng (Admin) mới được tải bản sao lưu." });
        return;
      }

      enforceAdminMfaGate(actor, pathname, ipHash);

      const file = reqUrl.searchParams.get("file") || "";
      if (!/^rangmay-backup-\d{8}-\d{6}\.(?:enc\.)?json$/.test(file)) {
        sendJson(res, 400, { error: "Tên tệp sao lưu không hợp lệ." });
        return;
      }
      const targetPath = path.resolve(backupsDir, file);
      if (!targetPath.startsWith(path.resolve(backupsDir) + path.sep) || !fs.existsSync(targetPath)) {
        sendJson(res, 404, { error: "Không tìm thấy tệp sao lưu." });
        return;
      }

      const content = fs.readFileSync(targetPath, "utf8");
      const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");
      res.writeHead(200, {
        ...buildSecurityHeaders(true),
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file}"`,
        "X-Backup-SHA256": sha256
      });
      res.end(content);
      return;
    }

    sendJson(res, 404, { error: "API endpoint không tồn tại." });
  }

  function handleStaticRequest(req, res, reqUrl) {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(reqUrl.pathname || "/");
    } catch {
      sendText(res, 400, "Bad Request");
      return;
    }

    if (decodedPath.includes("\0") || decodedPath.includes("\\") || decodedPath.includes("..")) {
      sendText(res, 403, "Forbidden");
      return;
    }

    let relPath = null;
    if (STATIC_ROOT_ALLOWLIST.has(decodedPath)) {
      relPath = STATIC_ROOT_ALLOWLIST.get(decodedPath);
    } else if (STATIC_PREFIX_ALLOWLIST.some((prefix) => decodedPath.startsWith(prefix))) {
      relPath = decodedPath.slice(1);
    } else {
      sendText(res, 403, "Forbidden");
      return;
    }

    const segments = relPath.split("/");
    if (segments.some((seg, idx) => seg.startsWith(".") && !(idx === 0 && seg === ".well-known"))) {
      sendText(res, 403, "Forbidden");
      return;
    }

    const fullPath = path.resolve(rootDir, relPath);
    if (!fullPath.startsWith(rootDir + path.sep)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    if (!fs.existsSync(fullPath)) {
      sendText(res, 404, "Not Found", false);
      return;
    }

    let realFile;
    let stat;
    try {
      realFile = fs.realpathSync(fullPath);
      stat = fs.statSync(realFile);
    } catch {
      sendText(res, 404, "Not Found", false);
      return;
    }

    if (!realFile.startsWith(realRootDir + path.sep) || !stat.isFile()) {
      sendText(res, 403, "Forbidden");
      return;
    }

    const isSensitiveHtml = SENSITIVE_HTML_FILES.has(relPath);
    const ext = path.extname(realFile).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      ...buildSecurityHeaders(isSensitiveHtml),
      "Content-Type": contentType,
      "Content-Length": stat.size
    });

    if (method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(realFile).pipe(res);
  }

  async function start() {
    realRootDir = fs.realpathSync(rootDir);
    packageDeps = readPackageDeps(rootDir);
    fs.mkdirSync(backupsDir, { recursive: true });
    certInfo = await ensureTlsCert(certsDir);
    secrets = loadOrCreateSecrets(dataDir);
    const loaded = loadOrCreateStore(dataDir);
    store = loaded.store;
    storePath = loaded.storePath;

    httpsServer = https.createServer(
      { key: certInfo.key, cert: certInfo.cert, minVersion: "TLSv1.2" },
      async (req, res) => {
        try {
          const reqUrl = new URL(req.url || "/", `https://localhost:${getActualHttpsPort()}`);
          if (reqUrl.pathname.startsWith("/api/")) {
            await handleApiRequest(req, res, reqUrl);
          } else {
            handleStaticRequest(req, res, reqUrl);
          }
        } catch (err) {
          if (err && typeof err.status === "number") {
            sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
          } else {
            sendJson(res, 500, { error: "Lỗi máy chủ nội bộ." });
          }
        }
      }
    );

    httpServer = http.createServer((req, res) => {
      const targetUrl = `https://localhost:${getActualHttpsPort()}${req.url || "/"}`;
      res.writeHead(301, {
        Location: targetUrl,
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end(`Redirecting to ${targetUrl}`);
    });

    await new Promise((resolve, reject) => {
      httpsServer.once("error", reject);
      httpsServer.listen(httpsPort, host, () => resolve());
    });

    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(httpPort, host, () => resolve());
    });

    return {
      httpPort: getActualHttpPort(),
      httpsPort: getActualHttpsPort()
    };
  }

  async function stop() {
    await Promise.all([
      new Promise((resolve) => (httpsServer ? httpsServer.close(() => resolve()) : resolve())),
      new Promise((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()))
    ]);
  }

  return {
    start,
    stop,
    getPorts: () => ({ httpPort: getActualHttpPort(), httpsPort: getActualHttpsPort() }),
    getStorePath: () => storePath,
    getBackupsDir: () => backupsDir,
    getCertInfo: () => certInfo
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srv = createSecureServer();
  srv
    .start()
    .then(({ httpPort, httpsPort }) => {
      console.log("");
      console.log("===============================================================");
      console.log(" RANG MÂY COFFEE — 4 CỔNG VẬN HÀNH PHÂN QUYỀN RBAC (HTTPS)");
      console.log("===============================================================");
      console.log(` - Trang chủ cửa hàng:        https://localhost:${httpsPort}/`);
      console.log(` - Chuyển hướng HTTP -> 301:  http://localhost:${httpPort}/`);
      console.log(` - Cổng đăng nhập (2FA):      https://localhost:${httpsPort}/login.html`);
      console.log(` - Chủ cửa hàng (Admin):      https://localhost:${httpsPort}/admin.html`);
      console.log(` - Quản lý cửa hàng (Manager):https://localhost:${httpsPort}/manager.html`);
      console.log(` - Nhân viên xử lý đơn (Staff):https://localhost:${httpsPort}/staff.html`);
      console.log(` - Khách hàng (Customer):     https://localhost:${httpsPort}/account.html`);
      console.log("---------------------------------------------------------------");
      console.log(" Tài khoản RBAC mặc định:");
      console.log("   [Admin]    admin@rangmaycoffee.vn      / RmAdmin@2026#Sec!");
      console.log("   [Manager]  manager@rangmaycoffee.vn    / RmManager@2026#Sec!");
      console.log("   [Staff]    staff@rangmaycoffee.vn      / RmStaff@2026#Sec!");
      console.log("   [Customer] khachhang@rangmaycoffee.vn  / RmKhach@2026#Sec!");
      console.log("===============================================================");
    })
    .catch((err) => {
      console.error("Không thể khởi động server bảo mật:", err);
      process.exit(1);
    });
}
