(function initStorefront() {
  "use strict";

  const GIFT_DEFAULT_PLACEHOLDER = "Lời chúc của bạn từ đại ngàn sương mù sẽ được dệt viết tại đây...";
  const IMAGE_FALLBACKS = {
    logo: "hinhanh/logo.webp",
    banner: "hinhanh/product.webp",
    productBox: "hinhanh/product.webp",
    daiNgan: "hinhanh/rangmay-dai-ngan.webp",
    suongSom: "hinhanh/rangmay-suong-som.webp",
    hopQua: "hinhanh/hop-qua-tinh-hoa.webp",
    dripPack: "hinhanh/sanpham1.webp",
    dripBrew: "hinhanh/drip-brew.webp",
    coffeeIce: "hinhanh/coffee-ice.webp",
    story: "hinhanh/mangden.jpg"
  };

  const PRODUCT_META = {
    "drip-pack-001": {
      defaultName: "Rang Mây Bản Giao Hưởng",
      defaultPrice: 119000,
      defaultStock: 50,
      defaultBadge: "Best Seller • Cân bằng êm dịu",
      image: "hinhanh/product.webp",
      imageType: "productBox",
      gallery: [
        { src: "hinhanh/product.webp", fallback: "productBox", alt: "Hộp Rang Mây Bản Giao Hưởng" },
        { src: "hinhanh/sanpham1.webp", fallback: "dripPack", alt: "Gói phin giấy 12g" },
        { src: "hinhanh/drip-brew.webp", fallback: "dripBrew", alt: "Pha nóng phin giấy" },
        { src: "hinhanh/banner1.webp", fallback: "banner", alt: "Không gian thưởng thức Măng Đen" }
      ],
      subtitle: "Êm dịu hài hòa • Chocolate đen & Caramel ngọt hậu",
      description: "Dòng Signature phối trộn cân bằng từ đại ngàn Măng Đen, nổi bật nốt hương chocolate đen và caramel ngọt hậu, không chua gắt. Phù hợp thưởng thức nóng hoặc đá mỗi sáng.",
      specPack: "Hộp 10 gói tiện lợi",
      specWeight: "12g/gói (120g/hộp)",
      specBean: "Arabica & Fine Robusta",
      specTaste: "Chocolate đen, Caramel"
    },
    "drip-pack-002": {
      defaultName: "Rang Mây Đại Ngàn (Gu Đậm Sữa Đá)",
      defaultPrice: 109000,
      defaultStock: 45,
      defaultBadge: "Đậm đà • Chuyên Sữa đá & Bạc xỉu",
      image: "hinhanh/rangmay-dai-ngan.webp",
      imageType: "daiNgan",
      gallery: [
        { src: "hinhanh/rangmay-dai-ngan.webp", fallback: "daiNgan", alt: "Hộp Rang Mây Đại Ngàn Gu Đậm Sữa Đá" },
        { src: "hinhanh/rangmay-dam-da.webp", fallback: "daiNgan", alt: "Phiên bản Đậm Đà Bản Sắc" },
        { src: "hinhanh/coffee-ice.webp", fallback: "coffeeIce", alt: "Ly cà phê đá sánh đậm" },
        { src: "hinhanh/drip-brew.webp", fallback: "dripBrew", alt: "Chiết xuất phin giấy đậm vị" }
      ],
      subtitle: "Cốt sánh đậm • Dậy hương bơ cacao khi quyện sữa đặc",
      description: "Tăng cường tỷ lệ hạt Fine Robusta Tây Nguyên chín mọng kết hợp Arabica Măng Đen rang vừa–đậm. Cho cốt cà phê sánh dày, bùng vị mạnh mẽ không bị nhạt khi pha cùng đá và sữa đặc.",
      specPack: "Hộp 10 gói đậm vị",
      specWeight: "12g/gói (120g/hộp)",
      specBean: "Fine Robusta & Arabica",
      specTaste: "Cacao đắng dịu, Hạt dẻ rang"
    },
    "drip-pack-003": {
      defaultName: "Rang Mây Sương Sớm (100% Arabica)",
      defaultPrice: 145000,
      defaultStock: 35,
      defaultBadge: "Specialty 1.200m • Hợp Cold Brew",
      image: "hinhanh/rangmay-suong-som.webp",
      imageType: "suongSom",
      gallery: [
        { src: "hinhanh/rangmay-suong-som.webp", fallback: "suongSom", alt: "Hộp Rang Mây Sương Sớm 100% Arabica" },
        { src: "hinhanh/drip-brew.webp", fallback: "dripBrew", alt: "Chiết xuất Pour-over thanh tao" },
        { src: "hinhanh/sanpham1.webp", fallback: "dripPack", alt: "Túi lọc giấy giữ trọn hương hoa" },
        { src: "hinhanh/mangden.jpg", fallback: "story", alt: "Sương sớm cao nguyên Măng Đen 1.200m" }
      ],
      subtitle: "Thanh tao tinh tế • Hương hoa trắng & Trái cây chín",
      description: "Tuyển chọn 100% hạt Arabica vùng cao Măng Đen ở độ cao 1.200m quanh năm mây phủ. Rang vừa sáng giữ trọn hương hoa tinh tế, vị thanh nhẹ, lượng caffeine êm ái cho cả buổi chiều.",
      specPack: "Hộp 10 gói Specialty",
      specWeight: "12g/gói (120g/hộp)",
      specBean: "100% Arabica Măng Đen",
      specTaste: "Hoa trắng, Mơ chín, Mật ong"
    },
    "gift-box-004": {
      defaultName: "Hộp Quà Tinh Hoa Măng Đen (Mix 3 Vị)",
      defaultPrice: 269000,
      defaultStock: 25,
      defaultBadge: "Quà biếu cao cấp • 24 gói đủ 3 vị",
      image: "hinhanh/hop-qua-tinh-hoa.webp",
      imageType: "hopQua",
      gallery: [
        { src: "hinhanh/hop-qua-tinh-hoa.webp", fallback: "hopQua", alt: "Hộp Quà Tinh Hoa Măng Đen 24 gói kèm thiệp" },
        { src: "hinhanh/product.webp", fallback: "productBox", alt: "8 gói Bản Giao Hưởng trong hộp quà" },
        { src: "hinhanh/rangmay-dai-ngan.webp", fallback: "daiNgan", alt: "8 gói Đại Ngàn trong hộp quà" },
        { src: "hinhanh/rangmay-suong-som.webp", fallback: "suongSom", alt: "8 gói Sương Sớm trong hộp quà" }
      ],
      subtitle: "Hộp cứng sang trọng 24 gói (8×3 vị) • Áp ngay mã VIP50K",
      description: "Bộ quà tặng hội tụ trọn vẹn 3 sắc thái hương vị Măng Đen (8 gói Bản Giao Hưởng + 8 gói Đại Ngàn + 8 gói Sương Sớm) kèm thiệp chúc mừng viết riêng bằng AI hoàn toàn miễn phí.",
      specPack: "Hộp quà cứng 24 gói",
      specWeight: "12g × 24 gói (288g)",
      specBean: "Trọn bộ 3 dòng đặc sản",
      specTaste: "Trải nghiệm đủ 3 tầng vị"
    }
  };

  let catalogProducts = Object.entries(PRODUCT_META).map(([id, m]) => ({
    id,
    name: m.defaultName,
    price: m.defaultPrice,
    stock_quantity: m.defaultStock,
    is_available: true,
    badge_text: m.defaultBadge
  }));

  let selectedProductId = "drip-pack-001";

  function getProductById(id) {
    return catalogProducts.find((p) => p.id === id) || catalogProducts[0];
  }

  let cart = [];
  try {
    const storedCart = JSON.parse(localStorage.getItem("rangMayCart") || "[]");
    if (Array.isArray(storedCart)) {
      cart = storedCart
        .filter((item) => item && typeof item.id === "string" && Boolean(PRODUCT_META[item.id]))
        .map((item) => {
          const prod = getProductById(item.id);
          const meta = PRODUCT_META[item.id];
          return {
            id: prod.id,
            name: prod.name,
            price: prod.price,
            qty: Math.min(99, Math.max(1, Number.parseInt(item.qty, 10) || 1)),
            image: meta.image,
            imageType: meta.imageType
          };
        });
    }
  } catch {
    localStorage.removeItem("rangMayCart");
  }

  let selectedPayment = "COD";
  let availableVouchers = [];
  let appliedVoucher = null;
  let toastTimer = null;

  function applyImageFallback(imgElement) {
    if (!imgElement || imgElement.dataset.fallbackApplied === "true") return;
    imgElement.dataset.fallbackApplied = "true";
    const type = imgElement.dataset.fallback || "dripBrew";
    imgElement.src = IMAGE_FALLBACKS[type] || IMAGE_FALLBACKS.dripBrew;
    if (imgElement.dataset.noFilterOnError === "true") {
      imgElement.classList.add("no-filter");
    }
  }

  document.addEventListener("error", (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.dataset.fallback) {
      applyImageFallback(target);
    }
  }, true);

  document.querySelectorAll("img[data-fallback]").forEach((img) => {
    if (img.complete && img.naturalWidth === 0) {
      applyImageFallback(img);
    }
  });

  function fmtPrice(num) {
    return Number(num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function showToast(msg) {
    const toast = document.getElementById("toast-box");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // Product Gallery (event delegation so dynamic per-SKU thumbnails always work)
  document.getElementById("productThumbnailsRow")?.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest(".thumb-btn") : null;
    if (!btn) return;
    const mainImg = document.getElementById("mainProductImg");
    const thumbSrc = btn.dataset.thumbSrc;
    const fallback = btn.dataset.fallback || "productBox";
    if (mainImg && thumbSrc) {
      delete mainImg.dataset.fallbackApplied;
      mainImg.dataset.fallback = fallback;
      mainImg.src = thumbSrc;
    }
    document.querySelectorAll("#productThumbnailsRow .thumb-btn").forEach((item) => item.classList.remove("active"));
    btn.classList.add("active");
  });

  // Mobile Navbar Toggle
  const menuToggle = document.getElementById("menuToggle");
  const navbar = document.getElementById("navbar");
  const navLinks = document.querySelectorAll(".navbar a");

  if (menuToggle && navbar) {
    menuToggle.addEventListener("click", () => navbar.classList.toggle("show"));
  }
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.forEach(item => item.classList.remove("active"));
      link.classList.add("active");
      if (navbar) navbar.classList.remove("show");
    });
  });

  // Cart Drawer Functions
  function openCart() {
    document.getElementById("cart-overlay")?.classList.add("open");
    document.getElementById("cart-sidebar")?.classList.add("open");
  }

  function closeCart() {
    document.getElementById("cart-overlay")?.classList.remove("open");
    document.getElementById("cart-sidebar")?.classList.remove("open");
  }

  function addToCart(targetProductId) {
    const id = typeof targetProductId === "string" && targetProductId ? targetProductId : selectedProductId;
    const prod = getProductById(id);
    const meta = PRODUCT_META[prod.id] || PRODUCT_META["drip-pack-001"];
    if (!prod.is_available || prod.stock_quantity <= 0) {
      showToast("⚠️ Dòng \"" + prod.name + "\" hiện tạm hết hàng.");
      return;
    }
    const maxCap = Math.min(99, Math.max(1, prod.stock_quantity));
    const existing = cart.find((i) => i.id === prod.id);
    if (existing) {
      existing.name = prod.name;
      existing.price = prod.price;
      existing.qty = Math.min(maxCap, existing.qty + 1);
    } else {
      cart.push({
        id: prod.id,
        name: prod.name,
        price: prod.price,
        qty: 1,
        image: meta.image,
        imageType: meta.imageType
      });
    }
    updateCartUI();
    openCart();
    showToast("🛒 Đã thêm \"" + prod.name + "\" vào giỏ hàng!");
  }

  function updateCartItemQty(id, change) {
    const item = cart.find((i) => i.id === id);
    if (item) {
      const prod = getProductById(id);
      const maxCap = Math.min(99, Math.max(1, prod ? prod.stock_quantity : 99));
      if (prod) item.price = prod.price;
      item.qty = Math.min(maxCap, item.qty + change);
      if (item.qty <= 0) {
        cart = cart.filter((i) => i.id !== id);
      }
    }
    updateCartUI();
  }

  function removeCartItem(id) {
    cart = cart.filter(i => i.id !== id);
    updateCartUI();
    showToast("🗑️ Đã xóa sản phẩm khỏi giỏ hàng.");
  }

  function updateCartUI() {
    const count = cart.reduce((acc, item) => acc + item.qty, 0);
    const cartCountEl = document.getElementById("cartCount");
    if (cartCountEl) cartCountEl.textContent = String(count);

    try {
      localStorage.setItem("rangMayCart", JSON.stringify(cart));
    } catch {
      // Ignore storage quota issues
    }

    const cartBody = document.getElementById("cartBody");
    const cartFooter = document.getElementById("cartFooter");
    if (!cartBody || !cartFooter) return;

    cartBody.replaceChildren();

    if (cart.length === 0) {
      const emptyWrap = createEl("div", "cart-empty-state");
      emptyWrap.appendChild(createEl("span", "cart-empty-icon", "☕"));
      emptyWrap.appendChild(createEl("p", "", "Giỏ hàng của bạn đang trống"));
      cartBody.appendChild(emptyWrap);
      cartFooter.hidden = true;
      return;
    }

    let subtotal = 0;
    cart.forEach((item) => {
      const itemTotal = item.price * item.qty;
      subtotal += itemTotal;

      const row = createEl("div", "cart-item-row");
      const imgWrap = createEl("div", "cart-item-img-mini");
      const img = document.createElement("img");
      img.src = item.image;
      img.alt = item.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.dataset.fallback = item.imageType;
      imgWrap.appendChild(img);

      const info = createEl("div", "cart-item-info");
      info.appendChild(createEl("h4", "", item.name));
      info.appendChild(createEl("p", "", fmtPrice(item.price) + "đ"));

      const qtyCtrl = createEl("div", "cart-qty-control");
      const decBtn = createEl("button", "qty-btn", "−");
      decBtn.type = "button";
      decBtn.addEventListener("click", () => updateCartItemQty(item.id, -1));

      const qtyVal = createEl("span", "qty-val", String(item.qty));

      const incBtn = createEl("button", "qty-btn", "+");
      incBtn.type = "button";
      incBtn.addEventListener("click", () => updateCartItemQty(item.id, 1));

      qtyCtrl.append(decBtn, qtyVal, incBtn);
      info.appendChild(qtyCtrl);

      const removeBtn = createEl("button", "cart-item-remove", "Xóa khỏi giỏ");
      removeBtn.type = "button";
      removeBtn.addEventListener("click", () => removeCartItem(item.id));
      info.appendChild(removeBtn);

      const totalEl = createEl("div", "cart-item-total", fmtPrice(itemTotal) + "đ");
      row.append(imgWrap, info, totalEl);
      cartBody.appendChild(row);
    });

    const subtotalEl = document.getElementById("cartSubtotal");
    const totalEl = document.getElementById("cartTotal");
    if (subtotalEl) subtotalEl.textContent = fmtPrice(subtotal) + "đ";
    if (totalEl) totalEl.textContent = fmtPrice(subtotal) + "đ";
    cartFooter.hidden = false;
  }

  // Checkout Modal
  function renderCheckoutAuthBanner() {
    const banner = document.getElementById("checkoutAuthBanner");
    if (!banner) return;
    banner.replaceChildren();

    const auth = window.RangMayAuth;
    const session = auth && auth.getSession();
    const profile = auth && auth.getCachedProfile();

    if (session) {
      const email = (profile && profile.email) || (session.user && session.user.email) || "Tài khoản đã đăng nhập";
      banner.appendChild(createEl("span", "", "Đặt hàng dưới tài khoản: " + email + " (đơn sẽ lưu vào lịch sử)."));
      const accLink = createEl("a", "", "Xem tài khoản");
      accLink.href = "account.html";
      banner.appendChild(accLink);

      if (profile) {
        const nameEl = document.getElementById("coName");
        const phoneEl = document.getElementById("coPhone");
        const emailEl = document.getElementById("coEmail");
        const addrEl = document.getElementById("coAddress");
        if (nameEl && !nameEl.value && profile.fullName) nameEl.value = profile.fullName;
        if (phoneEl && !phoneEl.value && profile.phone) phoneEl.value = profile.phone;
        if (emailEl && !emailEl.value && profile.email) emailEl.value = profile.email;
        if (addrEl && !addrEl.value && profile.defaultAddress) addrEl.value = profile.defaultAddress;
      }
    } else {
      banner.appendChild(createEl("span", "", "Đăng nhập để lưu đơn hàng và theo dõi trạng thái giao hàng."));
      const loginLink = createEl("a", "", "Đăng nhập ngay");
      loginLink.href = "login.html?next=index.html";
      banner.appendChild(loginLink);
    }
  }

  function computeVoucherDiscountPreview(voucherObj, subtotal) {
    if (!voucherObj || subtotal <= 0) return 0;
    let raw = voucherObj.discount_type === "percent"
      ? Math.round((subtotal * Number(voucherObj.discount_value || 0)) / 100)
      : Number(voucherObj.discount_value || 0);
    if (voucherObj.discount_type === "percent" && voucherObj.max_discount_amount && Number(voucherObj.max_discount_amount) > 0) {
      raw = Math.min(raw, Number(voucherObj.max_discount_amount));
    }
    return Math.min(raw, Math.max(0, Math.floor(subtotal) - 1000));
  }

  function setVoucherFeedback(kind, message) {
    const msgEl = document.getElementById("voucherStatusMsg");
    if (!msgEl) return;
    if (!message) {
      msgEl.hidden = true;
      msgEl.textContent = "";
      msgEl.className = "voucher-status-msg";
      return;
    }
    msgEl.className = "voucher-status-msg " + kind;
    msgEl.textContent = message;
    msgEl.hidden = false;
  }

  function renderVoucherHints() {
    const hintsEl = document.getElementById("voucherHintsRow");
    if (!hintsEl) return;
    hintsEl.replaceChildren();
    if (!Array.isArray(availableVouchers) || availableVouchers.length === 0) {
      hintsEl.hidden = true;
      return;
    }
    availableVouchers.forEach((v) => {
      const labelSuffix = v.discount_type === "percent"
        ? " (-" + String(v.discount_value) + "%)"
        : " (-" + fmtPrice(v.discount_value) + "đ)";
      const chip = createEl("button", "voucher-chip", "🏷️ " + v.code + labelSuffix);
      chip.type = "button";
      if (v.description) chip.title = v.description;
      if (appliedVoucher && appliedVoucher.code === v.code) {
        chip.classList.add("active");
      }
      chip.addEventListener("click", () => {
        const inputEl = document.getElementById("coVoucherInput");
        if (inputEl) inputEl.value = v.code;
        applyCheckoutVoucher();
      });
      hintsEl.appendChild(chip);
    });
    hintsEl.hidden = false;
  }

  function clearAppliedVoucher(silent) {
    appliedVoucher = null;
    const inputEl = document.getElementById("coVoucherInput");
    const clearBtn = document.getElementById("clearVoucherBtn");
    if (inputEl) inputEl.value = "";
    if (clearBtn) clearBtn.hidden = true;
    setVoucherFeedback("", "");
    renderVoucherHints();
    updateCheckoutSummary();
    if (!silent) {
      showToast("Đã gỡ mã giảm giá khỏi đơn hàng.");
    }
  }

  async function applyCheckoutVoucher() {
    const inputEl = document.getElementById("coVoucherInput");
    const applyBtn = document.getElementById("applyVoucherBtn");
    const clearBtn = document.getElementById("clearVoucherBtn");
    const code = (inputEl?.value || "").trim().toUpperCase();
    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

    if (!code) {
      setVoucherFeedback("error", "Vui lòng nhập hoặc chọn một mã giảm giá.");
      return;
    }
    if (subtotal <= 0) {
      setVoucherFeedback("error", "Giỏ hàng trống, chưa thể áp dụng mã giảm giá.");
      return;
    }
    if (!window.RangMayAuth || typeof window.RangMayAuth.apiRequest !== "function") {
      setVoucherFeedback("error", "Chưa kết nối được máy chủ để kiểm tra mã giảm giá.");
      return;
    }

    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = "Đang kiểm tra...";
    }
    try {
      const res = await window.RangMayAuth.apiRequest("validate-voucher", {
        method: "POST",
        body: { code, subtotal }
      });
      appliedVoucher = res.voucher;
      if (inputEl) inputEl.value = res.voucher.code;
      if (clearBtn) clearBtn.hidden = false;
      setVoucherFeedback(
        "success",
        "✓ Áp dụng mã " + res.voucher.code + " thành công: giảm " + fmtPrice(res.discountAmount) + "đ!"
      );
      renderVoucherHints();
      updateCheckoutSummary();
      showToast("🎉 Đã áp dụng voucher " + res.voucher.code + " (-" + fmtPrice(res.discountAmount) + "đ)!");
    } catch (error) {
      appliedVoucher = null;
      if (clearBtn) clearBtn.hidden = true;
      setVoucherFeedback("error", error instanceof Error ? error.message : "Mã giảm giá không hợp lệ.");
      renderVoucherHints();
      updateCheckoutSummary();
    } finally {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = "Áp dụng";
      }
    }
  }

  function updateCheckoutSummary() {
    const summaryEl = document.getElementById("checkoutOrderSummary");
    if (!summaryEl) return;
    summaryEl.replaceChildren();

    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
    let discountAmount = 0;

    if (appliedVoucher) {
      const minOrder = Number(appliedVoucher.min_order_amount || 0);
      if (subtotal < minOrder) {
        appliedVoucher = null;
        const clearBtn = document.getElementById("clearVoucherBtn");
        if (clearBtn) clearBtn.hidden = true;
        setVoucherFeedback("error", "Tạm tính giảm xuống dưới mức tối thiểu nên mã ưu đãi đã được gỡ.");
        renderVoucherHints();
      } else {
        discountAmount = computeVoucherDiscountPreview(appliedVoucher, subtotal);
      }
    }

    const finalTotal = Math.max(0, subtotal - discountAmount);

    cart.forEach((item) => {
      const itemRow = createEl("div", "summary-item");
      itemRow.append(
        createEl("span", "", item.name + " × " + String(item.qty)),
        createEl("span", "", fmtPrice(item.price * item.qty) + "đ")
      );
      summaryEl.appendChild(itemRow);
    });

    const row1 = createEl("div", "summary-item");
    row1.append(createEl("span", "", "Tạm tính:"), createEl("span", "", fmtPrice(subtotal) + "đ"));
    summaryEl.appendChild(row1);

    const row2 = createEl("div", "summary-item");
    row2.append(createEl("span", "", "Giao hàng:"), createEl("span", "cart-free-shipping", "Miễn phí 🎉"));
    summaryEl.appendChild(row2);

    if (appliedVoucher && discountAmount > 0) {
      const rowDisc = createEl("div", "summary-item discount");
      rowDisc.append(
        createEl("span", "", "Voucher (" + appliedVoucher.code + "):"),
        createEl("span", "", "−" + fmtPrice(discountAmount) + "đ")
      );
      summaryEl.appendChild(rowDisc);
    }

    const row3 = createEl("div", "summary-item grand-total");
    row3.append(createEl("span", "", "Tổng thanh toán:"), createEl("span", "", fmtPrice(finalTotal) + "đ"));
    summaryEl.appendChild(row3);
  }

  function openCheckout() {
    if (cart.length === 0) {
      showToast("⚠️ Giỏ hàng trống!");
      return;
    }
    closeCart();
    renderCheckoutAuthBanner();
    renderVoucherHints();
    updateCheckoutSummary();
    document.getElementById("checkout-overlay")?.classList.add("open");
  }

  function closeCheckout() {
    document.getElementById("checkout-overlay")?.classList.remove("open");
  }

  function closeSuccess() {
    document.getElementById("success-overlay")?.classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleAiGiftCard() {
    const toggle = document.getElementById("aiGiftToggle");
    const genBox = document.getElementById("aiGiftGenerator");
    if (!toggle || !genBox) return;
    toggle.checked = !toggle.checked;
    genBox.classList.toggle("active", toggle.checked);
  }

  document.querySelectorAll(".pay-method-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.getAttribute("aria-disabled") === "true") return;
      document.querySelectorAll(".pay-method-card").forEach(item => item.classList.remove("selected"));
      card.classList.add("selected");
      selectedPayment = card.dataset.method || "COD";
    });
  });

  async function submitOrder() {
    const submitButton = document.getElementById("submitOrderBtn");
    if (!submitButton || submitButton.disabled) return;

    const name = (document.getElementById("coName")?.value || "").trim();
    const phone = (document.getElementById("coPhone")?.value || "").trim();
    const email = (document.getElementById("coEmail")?.value || "").trim();
    const address = (document.getElementById("coAddress")?.value || "").trim();

    if (!name || !phone || !address) {
      showToast("⚠️ Vui lòng điền đủ thông tin!");
      return;
    }
    if (!/^(0|\+84)[0-9]{9,10}$/.test(phone.replace(/\s/g, ""))) {
      showToast("⚠️ Số điện thoại chưa đúng định dạng!");
      return;
    }
    if (selectedPayment !== "COD") {
      showToast("⚠️ Phương thức thanh toán này chưa được hỗ trợ.");
      return;
    }

    const giftToggle = Boolean(document.getElementById("aiGiftToggle")?.checked);
    const giftText = document.getElementById("aiGiftOutput")?.textContent || "";

    submitButton.disabled = true;
    submitButton.textContent = "ĐANG GỬI ĐƠN...";

    try {
      const order = await window.RangMayAuth.apiRequest("create-order", {
        method: "POST",
        body: {
          customer: {
            name,
            phone: phone.replace(/\s/g, ""),
            email,
            address
          },
          items: cart.map(item => ({ id: item.id, quantity: item.qty })),
          paymentMethod: selectedPayment,
          voucherCode: appliedVoucher ? appliedVoucher.code : "",
          giftMessage: giftToggle && giftText !== GIFT_DEFAULT_PLACEHOLDER ? giftText : "",
          website: document.getElementById("coWebsite")?.value || ""
        }
      });

      if (typeof order.orderNumber !== "string" || !order.orderNumber) {
        throw new Error("Máy chủ chưa xác nhận mã đơn hàng. Vui lòng liên hệ cửa hàng.");
      }

      const orderIdEl = document.getElementById("order-id");
      if (orderIdEl) orderIdEl.textContent = order.orderNumber;

      const voucherNoteEl = document.getElementById("success-voucher-note");
      if (voucherNoteEl) {
        if (order.discountAmount && Number(order.discountAmount) > 0) {
          voucherNoteEl.hidden = false;
          voucherNoteEl.textContent =
            "🏷️ Đã áp mã " +
            (order.voucherCode || "") +
            ": tiết kiệm " +
            fmtPrice(order.discountAmount) +
            "đ — Còn thanh toán: " +
            fmtPrice(order.totalAmount) +
            "đ";
        } else {
          voucherNoteEl.hidden = true;
          voucherNoteEl.textContent = "";
        }
      }

      const successGiftCard = document.getElementById("success-gift-card");
      const successGiftText = document.getElementById("success-gift-text");
      if (successGiftCard && successGiftText) {
        if (order.giftMessage) {
          successGiftCard.hidden = false;
          successGiftText.textContent = order.giftMessage;
        } else {
          successGiftCard.hidden = true;
          successGiftText.textContent = "";
        }
      }

      closeCheckout();
      clearAppliedVoucher(true);
      cart = [];
      updateCartUI();
      syncStoreCatalog();

      ["coName", "coPhone", "coEmail", "coAddress"].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
      const toggle = document.getElementById("aiGiftToggle");
      if (toggle) toggle.checked = false;
      document.getElementById("aiGiftGenerator")?.classList.remove("active");
      const giftOut = document.getElementById("aiGiftOutput");
      if (giftOut) giftOut.textContent = GIFT_DEFAULT_PLACEHOLDER;

      document.getElementById("success-overlay")?.classList.add("open");
    } catch (error) {
      showToast("⚠️ " + (error instanceof Error ? error.message : "Đặt hàng thất bại."));
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "XÁC NHẬN ĐẶT HÀNG";
    }
  }

  // Contact Form
  const contactForm = document.getElementById("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = contactForm.querySelector('button[type="submit"]');
      const name = (document.getElementById("contactName")?.value || "").trim();
      if (submitButton) submitButton.disabled = true;

      try {
        await window.RangMayAuth.apiRequest("create-contact", {
          method: "POST",
          body: {
            name,
            email: (document.getElementById("contactEmail")?.value || "").trim(),
            phone: (document.getElementById("contactPhone")?.value || "").trim(),
            message: (document.getElementById("contactMsg")?.value || "").trim(),
            website: document.getElementById("contactWebsite")?.value || ""
          }
        });
        contactForm.reset();
        showToast("📝 Cảm ơn bạn " + name + "! Rang Mây đã nhận thông tin.");
      } catch (error) {
        showToast("⚠️ " + (error instanceof Error ? error.message : "Không gửi được liên hệ."));
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  // Smart Real-time Grounded Barista AI & Gift Writer (strict CSP compliant, pure DOM API)
  const inPageChatHistory = [];
  const floatingChatHistory = [];
  const chatLocks = { inPage: false, floating: false };

  function foldViLocal(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function generateLocalBaristaReply(prompt) {
    const q = foldViLocal(prompt);
    const pSig = getProductById("drip-pack-001");
    const pStrong = getProductById("drip-pack-002");
    const pArabica = getProductById("drip-pack-003");
    const pGift = getProductById("gift-box-004");
    const actions = [];

    if (["gia", "bao nhieu", "ton kho", "con hang", "1 hop", "2 hop", "may loai", "cac dong", "mua"].some(k => q.includes(k))) {
      const lines = catalogProducts.map((p) => {
        const st = p.is_available && p.stock_quantity > 0 ? "còn " + String(p.stock_quantity) + " hộp" : "tạm hết";
        return "• " + p.name + ": " + fmtPrice(p.price) + "đ (" + st + ")";
      });
      if (pSig.is_available && pSig.stock_quantity > 0) {
        actions.push({ type: "add_to_cart", productId: pSig.id, label: "🛒 Thêm Bản Giao Hưởng (" + fmtPrice(pSig.price) + "đ)" });
      }
      return {
        reply: "☕ Bộ sưu tập 4 dòng Cà phê Phin Giấy Rang Mây (Freeship toàn quốc):\n" + lines.join("\n"),
        actions,
        suggestions: ["Tư vấn chọn dòng hợp gu", "Cho mình xin mã Voucher", "Cách pha Cà phê Sữa đá"]
      };
    }

    if (["voucher", "ma giam", "khuyen mai", "uu dai", "giam gia", "code"].some(k => q.includes(k))) {
      if (availableVouchers.length > 0) {
        const lines = availableVouchers.slice(0, 3).map((v) => {
          const desc = v.discount_type === "percent"
            ? "giảm " + String(v.discount_value) + "%"
            : "giảm " + fmtPrice(v.discount_value) + "đ";
          return "• " + v.code + ": " + desc + " (đơn từ " + fmtPrice(v.min_order_amount) + "đ)";
        });
        availableVouchers.slice(0, 2).forEach((v) => {
          actions.push({ type: "apply_voucher", label: "🏷️ Áp mã " + v.code, code: v.code, productId: pSig.id });
        });
        return {
          reply: "🏷️ Các mã Voucher đang mở:\n" + lines.join("\n") + "\nBấm nút bên dưới để áp mã tự động nhé!",
          actions,
          suggestions: ["Xem bảng giá 4 dòng", "Cách pha Sữa đá ngon"]
        };
      }
    }

    if (q.includes("cold brew") || q.includes("coldbrew") || q.includes("u lanh")) {
      if (pArabica.is_available && pArabica.stock_quantity > 0) {
        actions.push({ type: "add_to_cart", productId: pArabica.id, label: "🛒 Thêm Sương Sớm Arabica (" + fmtPrice(pArabica.price) + "đ)" });
      }
      return {
        reply:
          "❄️ Công thức Cold Brew thanh mát (hợp nhất với dòng " + pArabica.name + "):\n" +
          "1. Ngâm 1–2 túi phin giấy với 180–220ml nước lọc mát trong bình kín.\n" +
          "2. Ủ ngăn mát tủ lạnh 8–12 giờ qua đêm.\n" +
          "3. Nhấc túi ra, thêm đá và lát cam vàng để mở nốt hương thanh ngọt!",
        actions,
        suggestions: ["Cách pha Sữa đá đậm đà", "Cho xin mã giảm giá"]
      };
    }

    if (q.includes("sua da") || q.includes("bac xiu") || q.includes("pha sua")) {
      if (pStrong.is_available && pStrong.stock_quantity > 0) {
        actions.push({ type: "add_to_cart", productId: pStrong.id, label: "🛒 Thêm Đại Ngàn Sữa Đá (" + fmtPrice(pStrong.price) + "đ)" });
      }
      return {
        reply:
          "🥛 Bí quyết pha Cà phê Sữa đá đậm đà (chuẩn nhất với dòng " + pStrong.name + "):\n" +
          "1. Cho 20–25ml sữa đặc dưới đáy ly.\n" +
          "2. Ủ phin giấy với 25ml nước nóng 92–95°C trong 25 giây, sau đó rót chậm thêm 70ml nước nóng.\n" +
          "3. Khuấy tan cốt cà phê nóng cùng sữa đặc rồi thêm đá già đầy ly!",
        actions,
        suggestions: ["Bảng giá 4 dòng cà phê", "Săn mã Voucher giảm giá"]
      };
    }

    return {
      reply:
        "☕ Rang Mây hiện có 4 dòng đặc sản Măng Đen: " + pSig.name + " (" + fmtPrice(pSig.price) + "đ), " +
        pStrong.name + " (" + fmtPrice(pStrong.price) + "đ), " + pArabica.name + " (" + fmtPrice(pArabica.price) + "đ) và " +
        pGift.name + " (" + fmtPrice(pGift.price) + "đ). Bạn thích vị cân bằng, đậm sữa đá hay thanh nhẹ để mình gợi ý nhé?",
      actions: [{ type: "scroll_section", label: "☕ Xem bộ sưu tập 4 vị", target: "#product" }],
      suggestions: ["Cho mình xin mã Voucher", "Cách pha Cà phê Sữa đá", "Chính sách Freeship & COD"]
    };
  }

  async function askBaristaServer(message, history) {
    if (window.RangMayAuth && typeof window.RangMayAuth.apiRequest === "function") {
      try {
        const res = await window.RangMayAuth.apiRequest("barista-ai", {
          method: "POST",
          body: {
            message,
            history: history.slice(-6)
          }
        });
        if (res && typeof res.reply === "string" && res.reply.trim()) {
          return {
            reply: res.reply,
            actions: Array.isArray(res.actions) ? res.actions : [],
            suggestions: Array.isArray(res.suggestions) ? res.suggestions : []
          };
        }
      } catch {
        // Fallback to smart local grounded engine if offline
      }
    }
    return generateLocalBaristaReply(message);
  }

  function handleChatAction(act) {
    if (!act || typeof act !== "object") return;
    if (act.type === "add_to_cart") {
      addToCart(act.productId || selectedProductId);
      return;
    }
    if (act.type === "apply_voucher" && act.code) {
      const targetProd = getProductById(act.productId || selectedProductId);
      const meta = PRODUCT_META[targetProd.id] || PRODUCT_META["drip-pack-001"];
      if (!targetProd.is_available || targetProd.stock_quantity <= 0) {
        showToast("⚠️ Sản phẩm hiện tạm hết hàng nên chưa thể áp dụng mã.");
        return;
      }
      const vObj = availableVouchers.find((v) => v.code === act.code);
      const minOrder = vObj ? Number(vObj.min_order_amount || 0) : 0;
      const currentSubtotal = cart.reduce((acc, i) => acc + i.price * i.qty, 0);

      if (currentSubtotal < minOrder || cart.length === 0) {
        const deficit = Math.max(targetProd.price, minOrder - currentSubtotal);
        const addQty = Math.min(targetProd.stock_quantity, Math.max(1, Math.ceil(deficit / targetProd.price)));
        const existing = cart.find((i) => i.id === targetProd.id);
        if (existing) {
          existing.name = targetProd.name;
          existing.price = targetProd.price;
          existing.qty = Math.min(targetProd.stock_quantity, existing.qty + addQty);
        } else {
          cart.push({
            id: targetProd.id,
            name: targetProd.name,
            price: targetProd.price,
            qty: addQty,
            image: meta.image,
            imageType: meta.imageType
          });
        }
      }
      updateCartUI();
      floatingChatBox?.classList.remove("open");
      openCheckout();
      const vInput = document.getElementById("coVoucherInput");
      if (vInput) vInput.value = act.code;
      applyCheckoutVoucher();
      return;
    }
    if (act.type === "scroll_section" && act.target) {
      floatingChatBox?.classList.remove("open");
      const targetEl = document.querySelector(act.target);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function appendChatBubble(containerId, text, sender) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const bubble = createEl("div", "msg-bubble " + sender, text);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }

  function appendRichAiTurn(containerId, payload, onPickSuggestion) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Remove older suggestion chips so the chat thread stays clean
    container.querySelectorAll(".chat-suggestions-row").forEach((el) => el.remove());

    const bubble = createEl("div", "msg-bubble ai");
    bubble.appendChild(createEl("div", "msg-text", payload.reply));

    if (Array.isArray(payload.actions) && payload.actions.length > 0) {
      const actRow = createEl("div", "chat-actions-row");
      payload.actions.slice(0, 3).forEach((act) => {
        if (!act || typeof act.label !== "string") return;
        const btn = createEl("button", "chat-action-btn", act.label);
        btn.type = "button";
        btn.addEventListener("click", () => handleChatAction(act));
        actRow.appendChild(btn);
      });
      if (actRow.childNodes.length > 0) {
        bubble.appendChild(actRow);
      }
    }

    container.appendChild(bubble);

    if (Array.isArray(payload.suggestions) && payload.suggestions.length > 0) {
      const sugRow = createEl("div", "chat-suggestions-row");
      payload.suggestions.slice(0, 3).forEach((sug) => {
        if (typeof sug !== "string" || !sug.trim()) return;
        const chip = createEl("button", "chat-suggest-chip", sug);
        chip.type = "button";
        chip.addEventListener("click", () => onPickSuggestion(sug));
        sugRow.appendChild(chip);
      });
      if (sugRow.childNodes.length > 0) {
        container.appendChild(sugRow);
      }
    }

    container.scrollTop = container.scrollHeight;
  }

  function appendChatLoading(containerId, labelText) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const bubble = createEl("div", "msg-bubble loading");
    bubble.appendChild(createEl("span", "", labelText));
    bubble.append(createEl("div", "dot"), createEl("div", "dot"), createEl("div", "dot"));
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  async function runChatExchange(opts) {
    const { containerId, inputEl, sendBtn, history, loadingLabel, textOverride, lockKey } = opts;
    if (chatLocks[lockKey]) return;
    const raw = typeof textOverride === "string" ? textOverride : (inputEl ? inputEl.value : "");
    const text = raw.trim();
    if (!text) return;

    chatLocks[lockKey] = true;
    if (inputEl && typeof textOverride !== "string") inputEl.value = "";
    if (sendBtn) sendBtn.disabled = true;

    appendChatBubble(containerId, text, "user");
    const loadingEl = appendChatLoading(containerId, loadingLabel);

    try {
      const result = await askBaristaServer(text, history);
      history.push({ role: "user", text }, { role: "ai", text: result.reply });
      if (history.length > 8) history.splice(0, history.length - 8);
      if (loadingEl) loadingEl.remove();
      appendRichAiTurn(containerId, result, (pickedQuestion) => {
        runChatExchange({ ...opts, textOverride: pickedQuestion });
      });
    } finally {
      if (loadingEl && loadingEl.parentNode) loadingEl.remove();
      if (sendBtn) sendBtn.disabled = false;
      chatLocks[lockKey] = false;
    }
  }

  function sendInPageChatMessage(presetText) {
    runChatExchange({
      containerId: "chatMessages",
      inputEl: document.getElementById("chatInput"),
      sendBtn: document.getElementById("sendChatBtn"),
      history: inPageChatHistory,
      loadingLabel: "Barista AI đang pha chế câu trả lời",
      textOverride: typeof presetText === "string" ? presetText : undefined,
      lockKey: "inPage"
    });
  }

  function sendFloatingMessage(presetText) {
    runChatExchange({
      containerId: "floatingChatMessages",
      inputEl: document.getElementById("floatingChatInput"),
      sendBtn: document.getElementById("floatingChatSendBtn"),
      history: floatingChatHistory,
      loadingLabel: "Đang tra cứu & tư vấn",
      textOverride: typeof presetText === "string" ? presetText : undefined,
      lockKey: "floating"
    });
  }

  async function generateGiftCardMessage() {
    const recipient = (document.getElementById("giftRecipient")?.value || "").trim();
    const occasion = document.getElementById("giftOccasion")?.value || "dịp đặc biệt";
    const style = document.getElementById("giftStyle")?.value || "poetic";
    const outputEl = document.getElementById("aiGiftOutput");
    const genBtn = document.getElementById("generateAiCardBtn");
    if (!recipient) {
      showToast("⚠️ Nhập tên người nhận!");
      return;
    }

    if (genBtn) genBtn.disabled = true;
    try {
      if (window.RangMayAuth && typeof window.RangMayAuth.apiRequest === "function") {
        const res = await window.RangMayAuth.apiRequest("barista-ai", {
          method: "POST",
          body: { mode: "gift_card", recipient, occasion, style }
        });
        if (res && typeof res.giftMessage === "string" && res.giftMessage.trim()) {
          if (outputEl) outputEl.textContent = res.giftMessage;
          showToast("✨ Barista AI đã viết xong thiệp chúc mừng!");
          return;
        }
      }
    } catch {
      // Fallback to local poetic template below
    } finally {
      if (genBtn) genBtn.disabled = false;
    }

    let message = "";
    if (style === "warm") {
      message = "Gửi " + recipient + " nhân " + occasion.toLowerCase() + ": Mong rằng mỗi buổi sáng bên ly cà phê Rang Mây sẽ mang lại cho bạn sự ấm áp, bình yên và thật nhiều năng lượng tích cực.";
    } else if (style === "gentle") {
      message = "Thân gửi " + recipient + " nhân " + occasion.toLowerCase() + ". Chúc bạn luôn giữ được nhịp sống dịu êm, tinh tế và tận hưởng trọn vẹn từng khoảnh khắc đáng nhớ.";
    } else {
      message = "Gửi " + recipient + " giữa những tầng mây Măng Đen nhân " + occasion.toLowerCase() + ". Chúc hương thơm cà phê phin giấy sẽ ủ ấm tâm hồn bạn và mở ra một ngày mới thật an lành.";
    }

    if (outputEl) outputEl.textContent = message;
    showToast("✨ Viết thiệp hoàn tất!");
  }

  // Event Bindings
  document.getElementById("cartOpenBtn")?.addEventListener("click", openCart);
  document.getElementById("cartOverlay")?.addEventListener("click", closeCart);
  document.getElementById("cart-overlay")?.addEventListener("click", closeCart);
  document.getElementById("cartCloseBtn")?.addEventListener("click", closeCart);
  document.getElementById("addToCartBtn")?.addEventListener("click", () => addToCart(selectedProductId));
  document.getElementById("openCheckoutBtn")?.addEventListener("click", openCheckout);
  document.getElementById("checkoutCloseBtn")?.addEventListener("click", closeCheckout);
  document.getElementById("aiGiftToggleWrap")?.addEventListener("click", toggleAiGiftCard);
  document.getElementById("generateAiCardBtn")?.addEventListener("click", generateGiftCardMessage);
  document.getElementById("applyVoucherBtn")?.addEventListener("click", applyCheckoutVoucher);
  document.getElementById("clearVoucherBtn")?.addEventListener("click", () => clearAppliedVoucher(false));
  document.getElementById("coVoucherInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyCheckoutVoucher();
    }
  });
  document.getElementById("submitOrderBtn")?.addEventListener("click", submitOrder);
  document.getElementById("closeSuccessBtn")?.addEventListener("click", closeSuccess);

  document.getElementById("checkout-overlay")?.addEventListener("click", (event) => {
    if (event.target && event.target.id === "checkout-overlay") closeCheckout();
  });
  document.getElementById("success-overlay")?.addEventListener("click", (event) => {
    if (event.target && event.target.id === "success-overlay") closeSuccess();
  });

  document.querySelectorAll(".ai-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (preset) sendInPageChatMessage(preset);
    });
  });

  document.querySelectorAll(".floating-chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.floatPreset;
      if (preset) sendFloatingMessage(preset);
    });
  });

  document.getElementById("sendChatBtn")?.addEventListener("click", () => sendInPageChatMessage());
  document.getElementById("chatInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendInPageChatMessage();
    }
  });

  const floatingChatBox = document.getElementById("floating-chat-box");
  function toggleFloatingChat() {
    if (!floatingChatBox) return;
    const isOpen = floatingChatBox.classList.toggle("open");
    if (isOpen) {
      const msgContainer = document.getElementById("floatingChatMessages");
      if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
    }
  }

  document.getElementById("floatingChatToggleBtn")?.addEventListener("click", toggleFloatingChat);
  document.getElementById("floatingChatCloseBtn")?.addEventListener("click", toggleFloatingChat);
  document.getElementById("floatingChatSendBtn")?.addEventListener("click", () => sendFloatingMessage());
  document.getElementById("floatingChatInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendFloatingMessage();
    }
  });

  // Intersection Observer for active nav link
  const observedSections = document.querySelectorAll("main section[id], section[id]");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === "#" + visible.target.id);
      });
    }, { rootMargin: "-20% 0px -65% 0px", threshold: [0.05, 0.25, 0.5] });
    observedSections.forEach(section => observer.observe(section));
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeCart();
    closeCheckout();
    closeSuccess();
    floatingChatBox?.classList.remove("open");
  });

  function renderSpotlightProduct() {
    const prod = getProductById(selectedProductId);
    if (!prod) return;
    const meta = PRODUCT_META[prod.id] || PRODUCT_META["drip-pack-001"];
    const canBuy = prod.is_available && prod.stock_quantity > 0;

    const mainImg = document.getElementById("mainProductImg");
    if (mainImg) {
      delete mainImg.dataset.fallbackApplied;
      mainImg.dataset.fallback = meta.imageType;
      mainImg.src = meta.image;
      mainImg.alt = prod.name;
    }
    const thumbsRow = document.getElementById("productThumbnailsRow");
    if (thumbsRow && Array.isArray(meta.gallery)) {
      thumbsRow.replaceChildren();
      meta.gallery.forEach((g, idx) => {
        const tBtn = createEl("button", "thumb-btn" + (idx === 0 ? " active" : ""));
        tBtn.type = "button";
        tBtn.dataset.thumbSrc = g.src;
        tBtn.dataset.fallback = g.fallback;
        const tImg = document.createElement("img");
        tImg.src = g.src;
        tImg.alt = g.alt;
        tImg.loading = "lazy";
        tImg.decoding = "async";
        tImg.dataset.fallback = g.fallback;
        tBtn.appendChild(tImg);
        thumbsRow.appendChild(tBtn);
      });
    }

    const badgeEl = document.getElementById("productBadge");
    if (badgeEl) badgeEl.textContent = prod.badge_text || meta.defaultBadge;

    const titleEl = document.getElementById("productTitle");
    if (titleEl) titleEl.textContent = prod.name;

    const descEl = document.getElementById("productDesc");
    if (descEl) descEl.textContent = meta.description;

    const priceEl = document.getElementById("productPrice");
    if (priceEl) priceEl.textContent = fmtPrice(prod.price) + "đ";

    const specPackEl = document.getElementById("specPack");
    const specWeightEl = document.getElementById("specWeight");
    const specBeanEl = document.getElementById("specBean");
    const specTasteEl = document.getElementById("specTaste");
    if (specPackEl) specPackEl.textContent = meta.specPack;
    if (specWeightEl) specWeightEl.textContent = meta.specWeight;
    if (specBeanEl) specBeanEl.textContent = meta.specBean;
    if (specTasteEl) specTasteEl.textContent = meta.specTaste;

    const stockEl = document.getElementById("productStockInfo");
    if (stockEl) {
      stockEl.textContent = canBuy
        ? "Tình trạng kho: Còn " + String(prod.stock_quantity) + " hộp sẵn sàng giao ngay"
        : "Tình trạng kho: Tạm hết hàng / đang chuẩn bị mẻ rang mới";
      stockEl.classList.toggle("out-of-stock", !canBuy);
    }

    const addBtn = document.getElementById("addToCartBtn");
    if (addBtn) {
      addBtn.disabled = !canBuy;
      addBtn.textContent = canBuy
        ? "THÊM \"" + prod.name.toUpperCase() + "\" (" + fmtPrice(prod.price) + "Đ)"
        : "TẠM HẾT HÀNG";
    }
  }

  function renderCollectionGrid() {
    const grid = document.getElementById("productCollectionGrid");
    if (!grid) return;
    grid.replaceChildren();

    catalogProducts.forEach((prod) => {
      const meta = PRODUCT_META[prod.id] || PRODUCT_META["drip-pack-001"];
      const canBuy = prod.is_available && prod.stock_quantity > 0;
      const isSelected = prod.id === selectedProductId;

      const card = createEl("article", "collection-card" + (isSelected ? " active" : ""));

      const imgWrap = createEl("div", "collection-card-media");
      const img = document.createElement("img");
      img.src = meta.image;
      img.alt = prod.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.dataset.fallback = meta.imageType;
      imgWrap.appendChild(img);
      imgWrap.appendChild(createEl("span", "collection-card-badge", prod.badge_text || meta.defaultBadge));
      imgWrap.addEventListener("click", () => {
        selectedProductId = prod.id;
        renderCollectionGrid();
        renderSpotlightProduct();
      });

      const body = createEl("div", "collection-card-body");
      const title = createEl("h3", "collection-card-title", prod.name);
      const sub = createEl("p", "collection-card-sub", meta.subtitle);
      const spec = createEl("div", "collection-card-spec", meta.specPack + " • " + meta.specBean);

      const priceRow = createEl("div", "collection-card-price-row");
      priceRow.appendChild(createEl("span", "collection-card-price", fmtPrice(prod.price) + "đ"));
      priceRow.appendChild(
        createEl(
          "span",
          "collection-card-stock" + (canBuy ? "" : " out"),
          canBuy ? "Còn " + String(prod.stock_quantity) + " hộp" : "Tạm hết"
        )
      );

      const actions = createEl("div", "collection-card-actions");
      const detailBtn = createEl("button", "btn-card-detail", isSelected ? "Đang xem" : "Chi tiết");
      detailBtn.type = "button";
      detailBtn.addEventListener("click", () => {
        selectedProductId = prod.id;
        renderCollectionGrid();
        renderSpotlightProduct();
        document.getElementById("productSpotlightBox")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });

      const buyBtn = createEl("button", "btn-card-buy", canBuy ? "🛒 Thêm giỏ" : "Hết hàng");
      buyBtn.type = "button";
      buyBtn.disabled = !canBuy;
      buyBtn.addEventListener("click", () => addToCart(prod.id));

      actions.append(detailBtn, buyBtn);
      body.append(title, sub, spec, priceRow, actions);
      card.append(imgWrap, body);
      grid.appendChild(card);
    });
  }

  function applyLiveCatalogList(productsFromApi) {
    if (!Array.isArray(productsFromApi) || productsFromApi.length === 0) return;
    const byId = new Map();
    productsFromApi.forEach((p) => {
      if (p && typeof p.id === "string") byId.set(p.id, p);
    });

    catalogProducts = Object.entries(PRODUCT_META).map(([id, meta]) => {
      const row = byId.get(id);
      if (!row) {
        const prev = catalogProducts.find((c) => c.id === id);
        return prev || {
          id,
          name: meta.defaultName,
          price: meta.defaultPrice,
          stock_quantity: meta.defaultStock,
          is_available: true,
          badge_text: meta.defaultBadge
        };
      }
      const nextPrice = Number.parseInt(row.price, 10);
      const nextStock = Number.parseInt(row.stock_quantity, 10);
      return {
        id,
        name: row.name || meta.defaultName,
        price: Number.isInteger(nextPrice) && nextPrice > 0 ? nextPrice : meta.defaultPrice,
        stock_quantity: Number.isInteger(nextStock) && nextStock >= 0 ? nextStock : meta.defaultStock,
        is_available: row.is_available !== false,
        badge_text: typeof row.badge_text === "string" && row.badge_text ? row.badge_text : meta.defaultBadge
      };
    });

    if (cart.length > 0) {
      cart = cart
        .map((item) => {
          const live = getProductById(item.id);
          if (!live) return item;
          const canBuy = live.is_available && live.stock_quantity > 0;
          return {
            ...item,
            name: live.name,
            price: live.price,
            qty: canBuy ? Math.min(live.stock_quantity, item.qty) : item.qty
          };
        });
      updateCartUI();
    }

    renderCollectionGrid();
    renderSpotlightProduct();
  }

  async function syncStoreCatalog() {
    if (!window.RangMayAuth || typeof window.RangMayAuth.apiRequest !== "function") return;
    try {
      const data = await window.RangMayAuth.apiRequest("store-catalog", { method: "GET" });
      if (data && Array.isArray(data.products)) {
        applyLiveCatalogList(data.products);
      }
      if (data && Array.isArray(data.vouchers)) {
        availableVouchers = data.vouchers;
        renderVoucherHints();
      }
    } catch {
      // Fallback to default 4-product collection when offline
    }
  }

  // Initialize UI & Auth header
  renderCollectionGrid();
  renderSpotlightProduct();
  updateCartUI();
  (async function initHeaderAuth() {
    if (!window.RangMayAuth) return;
    if (typeof window.RangMayAuth.initBackendMode === "function") {
      await window.RangMayAuth.initBackendMode();
    }
    await syncStoreCatalog();
    window.RangMayAuth.renderHeaderAuthState("headerAuthArea");
  })();
})();
