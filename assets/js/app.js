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
    const inStock = liveProduct.is_available && liveProduct.stock_quantity > 0;
    const actions = [];

    if (["gia", "bao nhieu", "ton kho", "con hang", "1 hop", "2 hop", "mua"].some(k => q.includes(k))) {
      if (inStock) {
        actions.push({ type: "add_to_cart", label: "🛒 Thêm vào giỏ (" + fmtPrice(liveProduct.price) + "đ)" });
      }
      return {
        reply:
          "☕ " + liveProduct.name + " (hộp 10 túi phin giấy × 12g):\n" +
          "• Giá hiện tại: " + fmtPrice(liveProduct.price) + "đ/hộp (Miễn phí giao hàng toàn quốc).\n" +
          "• Tồn kho: " + (inStock ? "Còn " + String(liveProduct.stock_quantity) + " hộp sẵn sàng giao ngay." : "Đang tạm hết hàng."),
        actions,
        suggestions: ["Cho mình xin mã Voucher", "Cách pha Cà phê Sữa đá", "Cà phê có chua không?"]
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
          actions.push({ type: "apply_voucher", label: "🏷️ Áp mã " + v.code, code: v.code });
        });
        return {
          reply: "🏷️ Các mã Voucher đang mở:\n" + lines.join("\n") + "\nBấm nút bên dưới để áp mã tự động nhé!",
          actions,
          suggestions: ["Giá 1 hộp bao nhiêu?", "Cách pha Sữa đá ngon"]
        };
      }
    }

    if (q.includes("cold brew") || q.includes("coldbrew") || q.includes("u lanh")) {
      return {
        reply:
          "❄️ Công thức Cold Brew thanh mát:\n" +
          "1. Ngâm 1–2 túi phin giấy Rang Mây với 180–220ml nước lọc mát trong bình kín.\n" +
          "2. Ủ ngăn mát tủ lạnh 8–12 giờ qua đêm.\n" +
          "3. Nhấc túi ra, thêm đá và lát cam vàng để mở nốt hương thanh ngọt!",
        actions: [],
        suggestions: ["Cách pha Sữa đá đậm đà", "Cho xin mã giảm giá"]
      };
    }

    if (q.includes("sua da") || q.includes("bac xiu") || q.includes("pha sua")) {
      return {
        reply:
          "🥛 Bí quyết pha Cà phê Sữa đá đậm đà:\n" +
          "1. Cho 20–25ml sữa đặc dưới đáy ly.\n" +
          "2. Ủ phin giấy với 25ml nước nóng 92–95°C trong 25 giây, sau đó rót chậm thêm 70ml nước nóng.\n" +
          "3. Khuấy tan cốt cà phê nóng cùng sữa đặc rồi thêm đá già đầy ly!",
        actions: [],
        suggestions: ["Giá 1 hộp & tồn kho", "Săn mã Voucher giảm giá"]
      };
    }

    return {
      reply:
        "☕ Với " + liveProduct.name + " (" + fmtPrice(liveProduct.price) + "đ/hộp 10 gói), bạn nên ủ bột 25 giây với 30ml nước 90–95°C rồi rót chậm thêm 120ml nước nóng để nốt hương chocolate & caramel mở ra êm dịu nhất.",
      actions: inStock ? [{ type: "add_to_cart", label: "🛒 Thêm vào giỏ (" + fmtPrice(liveProduct.price) + "đ)" }] : [],
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
      addToCart();
      return;
    }
    if (act.type === "apply_voucher" && act.code) {
      if (!liveProduct.is_available || liveProduct.stock_quantity <= 0) {
        showToast("⚠️ Sản phẩm hiện tạm hết hàng nên chưa thể áp dụng mã.");
        return;
      }
      const vObj = availableVouchers.find((v) => v.code === act.code);
      const minOrder = vObj ? Number(vObj.min_order_amount || 0) : 0;
      const neededQty = minOrder > 0
        ? Math.min(liveProduct.stock_quantity, Math.max(1, Math.ceil(minOrder / liveProduct.price)))
        : 1;

      const existing = cart.find((i) => i.id === liveProduct.id);
      if (existing) {
        existing.name = liveProduct.name;
        existing.price = liveProduct.price;
        existing.qty = Math.max(existing.qty, neededQty);
      } else {
        cart.push({
          id: liveProduct.id,
          name: liveProduct.name,
          price: liveProduct.price,
          qty: neededQty,
          image: "hinhanh/sanpham1.webp",
          imageType: "dripPack"
        });
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
