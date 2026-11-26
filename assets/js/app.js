(function initStorefront() {
  "use strict";

  const GIFT_DEFAULT_PLACEHOLDER = "Lời chúc của bạn từ đại ngàn sương mù sẽ được dệt viết tại đây...";
  const IMAGE_FALLBACKS = {
    logo: "hinhanh/logo.webp",
    banner: "hinhanh/product.webp",
    dripPack: "hinhanh/sanpham1.webp",
    dripBrew: "hinhanh/drip-brew.webp",
    coffeeIce: "hinhanh/coffee-ice.webp",
    story: "hinhanh/mangden.jpg"
  };

  let liveProduct = {
    id: "drip-pack-001",
    name: "Cà phê phin giấy Rang Mây",
    price: 119000,
    stock_quantity: 50,
    is_available: true,
    badge_text: "Phin giấy tiện lợi, minh bạch lô sản xuất"
  };

  let cart = [];
  try {
    const storedCart = JSON.parse(localStorage.getItem("rangMayCart") || "[]");
    if (Array.isArray(storedCart)) {
      cart = storedCart
        .filter(item => item && item.id === "drip-pack-001")
        .map(item => ({
          id: liveProduct.id,
          name: liveProduct.name,
          price: liveProduct.price,
          qty: Math.min(99, Math.max(1, Number.parseInt(item.qty, 10) || 1)),
          image: "hinhanh/sanpham1.webp",
          imageType: "dripPack"
        }));
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

  // Product Gallery
  document.querySelectorAll(".thumb-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mainImg = document.getElementById("mainProductImg");
      const thumbSrc = btn.dataset.thumbSrc;
      const fallback = btn.dataset.fallback || "dripPack";
      if (mainImg && thumbSrc) {
        delete mainImg.dataset.fallbackApplied;
        mainImg.dataset.fallback = fallback;
        mainImg.src = thumbSrc;
      }
      document.querySelectorAll(".thumb-btn").forEach(item => item.classList.remove("active"));
      btn.classList.add("active");
    });
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

  function addToCart() {
    if (!liveProduct.is_available || liveProduct.stock_quantity <= 0) {
      showToast("⚠️ Sản phẩm hiện tạm hết hàng hoặc đang tạm ngưng bán.");
      return;
    }
    const maxCap = Math.min(99, Math.max(1, liveProduct.stock_quantity));
    const existing = cart.find(i => i.id === liveProduct.id);
    if (existing) {
      existing.name = liveProduct.name;
      existing.price = liveProduct.price;
      existing.qty = Math.min(maxCap, existing.qty + 1);
    } else {
      cart.push({
        id: liveProduct.id,
        name: liveProduct.name,
        price: liveProduct.price,
        qty: 1,
        image: "hinhanh/sanpham1.webp",
        imageType: "dripPack"
      });
    }
    updateCartUI();
    openCart();
    showToast("🛒 Đã thêm cà phê Rang Mây vào giỏ hàng!");
  }

  function updateCartItemQty(id, change) {
    const item = cart.find(i => i.id === id);
    if (item) {
      const maxCap = Math.min(99, Math.max(1, liveProduct.stock_quantity || 99));
      item.price = liveProduct.price;
      item.qty = Math.min(maxCap, item.qty + change);
      if (item.qty <= 0) {
        cart = cart.filter(i => i.id !== id);
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

  // Curated AI Barista & Gift Writer (local deterministic replies under strict CSP)
  function generateLocalBaristaReply(prompt) {
    const normalized = (prompt || "").toLowerCase();
    if (normalized.includes("cold brew") || normalized.includes("coldbrew")) {
      return "Dùng 1 túi phin giấy Rang Mây cho khoảng 180–200ml nước lạnh. Ngâm 8–12 giờ trong tủ lạnh, thêm đá và điều chỉnh ngọt theo khẩu vị.";
    }
    if (normalized.includes("âm nhạc") || normalized.includes("món bánh") || normalized.includes("ăn kèm")) {
      return "Ly cà phê Rang Mây rất hợp với nhạc acoustic nhẹ nhàng, bánh bông lan hoặc bánh sữa. Nên nhâm nhi khi cà phê còn ấm và thưởng thức chậm rãi.";
    }
    if (normalized.includes("chocolate") || normalized.includes("caramel") || normalized.includes("nốt hương")) {
      return "Các nốt chocolate và caramel trong ly cà phê xuất phát từ quá trình rang chậm và đặc tính Arabica cao nguyên. Hương vị cụ thể còn phụ thuộc lô rang và nhiệt độ nước.";
    }
    if (normalized.includes("thiệp") || normalized.includes("chúc")) {
      return "Gửi đến bạn một ly cà phê ấm, một khoảnh khắc đủ bình yên và nhiều điều tốt đẹp đang chờ phía trước.";
    }
    return "Với cà phê Rang Mây, bạn nên rót nước khoảng 90–95°C và chờ 3–5 phút để hương vị mở ra dịu êm. Bạn có thể thử pha nóng trước hoặc thêm đá tùy thích.";
  }

  function appendChatBubble(containerId, text, sender) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const bubble = createEl("div", "msg-bubble " + sender, text);
    container.appendChild(bubble);
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

  function sendInPageChatMessage() {
    const inputEl = document.getElementById("chatInput");
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;

    appendChatBubble("chatMessages", text, "user");
    inputEl.value = "";
    const loadingEl = appendChatLoading("chatMessages", "Đang dệt hương câu trả lời");
    window.setTimeout(() => {
      if (loadingEl) loadingEl.remove();
      appendChatBubble("chatMessages", generateLocalBaristaReply(text), "ai");
    }, 260);
  }

  function sendFloatingMessage() {
    const inputEl = document.getElementById("floatingChatInput");
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;

    appendChatBubble("floatingChatMessages", text, "user");
    inputEl.value = "";
    const loadingEl = appendChatLoading("floatingChatMessages", "Đang pha chế câu trả lời");
    window.setTimeout(() => {
      if (loadingEl) loadingEl.remove();
      appendChatBubble("floatingChatMessages", generateLocalBaristaReply(text), "ai");
    }, 240);
  }

  function generateGiftCardMessage() {
    const recipient = (document.getElementById("giftRecipient")?.value || "").trim();
    const occasion = document.getElementById("giftOccasion")?.value || "dịp đặc biệt";
    const style = document.getElementById("giftStyle")?.value || "poetic";
    const outputEl = document.getElementById("aiGiftOutput");
    if (!recipient) {
      showToast("⚠️ Nhập tên người nhận!");
      return;
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
  document.getElementById("addToCartBtn")?.addEventListener("click", addToCart);
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
      const inputEl = document.getElementById("chatInput");
      if (inputEl && preset) {
        inputEl.value = preset;
        sendInPageChatMessage();
      }
    });
  });

  document.getElementById("sendChatBtn")?.addEventListener("click", sendInPageChatMessage);
  document.getElementById("chatInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendInPageChatMessage();
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
  document.getElementById("floatingChatSendBtn")?.addEventListener("click", sendFloatingMessage);
  document.getElementById("floatingChatInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendFloatingMessage();
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

  function applyLiveCatalogToStorefront(product) {
    if (!product || typeof product !== "object") return;
    const nextPrice = Number.parseInt(product.price, 10);
    const nextStock = Number.parseInt(product.stock_quantity, 10);
    liveProduct = {
      id: product.id || "drip-pack-001",
      name: product.name || "Cà phê phin giấy Rang Mây",
      price: Number.isInteger(nextPrice) && nextPrice > 0 ? nextPrice : liveProduct.price,
      stock_quantity: Number.isInteger(nextStock) && nextStock >= 0 ? nextStock : liveProduct.stock_quantity,
      is_available: product.is_available !== false,
      badge_text: typeof product.badge_text === "string" ? product.badge_text : liveProduct.badge_text
    };

    const badgeEl = document.getElementById("productBadge");
    if (badgeEl && liveProduct.badge_text) {
      badgeEl.textContent = liveProduct.badge_text;
    }
    const priceEl = document.getElementById("productPrice");
    if (priceEl) {
      priceEl.textContent = fmtPrice(liveProduct.price) + "đ";
    }
    const stockEl = document.getElementById("productStockInfo");
    const addBtn = document.getElementById("addToCartBtn");
    const canBuy = liveProduct.is_available && liveProduct.stock_quantity > 0;
    if (stockEl) {
      stockEl.textContent = canBuy
        ? "Tình trạng kho: Còn " + String(liveProduct.stock_quantity) + " hộp sẵn sàng giao"
        : "Tình trạng kho: Tạm hết hàng / đang cập nhật lô mới";
      stockEl.classList.toggle("out-of-stock", !canBuy);
    }
    if (addBtn) {
      addBtn.disabled = !canBuy;
      addBtn.textContent = canBuy ? "THÊM VÀO GIỎ HÀNG" : "TẠM HẾT HÀNG";
    }

    if (cart.length > 0) {
      cart = cart.map(item => ({
        ...item,
        name: liveProduct.name,
        price: liveProduct.price,
        qty: canBuy ? Math.min(liveProduct.stock_quantity, item.qty) : item.qty
      }));
      updateCartUI();
    }
  }

  async function syncStoreCatalog() {
    if (!window.RangMayAuth || typeof window.RangMayAuth.apiRequest !== "function") return;
    try {
      const data = await window.RangMayAuth.apiRequest("store-catalog", { method: "GET" });
      if (data && Array.isArray(data.products)) {
        const matched = data.products.find(p => p.id === "drip-pack-001") || data.products[0];
        if (matched) applyLiveCatalogToStorefront(matched);
      }
      if (data && Array.isArray(data.vouchers)) {
        availableVouchers = data.vouchers;
        renderVoucherHints();
      }
    } catch {
      // Fallback to static price cleanly when offline/unconfigured
    }
  }

  // Initialize UI & Auth header
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
