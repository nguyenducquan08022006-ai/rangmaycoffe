(function initAccountPage() {
  "use strict";

  const auth = window.RangMayAuth;
  if (!auth) return;

  const ROLE_LABELS = {
    admin: "Quản trị viên",
    manager: "Quản lý cửa hàng",
    staff: "Nhân viên",
    customer: "Khách hàng"
  };

  const ORDER_STATUS_LABELS = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    shipped: "Đang giao",
    completed: "Hoàn tất",
    cancelled: "Đã hủy"
  };

  let currentProfile = null;
  let pendingEnrollFactorId = null;
  let activeTotpFactors = [];
  let latestRecoveryCodes = [];

  const banner = document.getElementById("accountBanner");

  function showBanner(kind, message) {
    if (!banner) return;
    banner.className = "portal-banner " + kind;
    banner.textContent = message;
    banner.hidden = false;
  }

  function clearBanner() {
    if (!banner) return;
    banner.hidden = true;
    banner.textContent = "";
  }

  function fmtPrice(num) {
    return Number(num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("vi-VN");
    } catch {
      return iso;
    }
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function renderProfileHeader(profile, security) {
    document.getElementById("accountHeaderCard").hidden = false;
    document.getElementById("accountContentGrid").hidden = false;
    document.getElementById("ordersHistoryCard").hidden = false;

    const heading = document.getElementById("accHeading");
    if (heading) {
      heading.textContent = profile.fullName ? "Xin chào, " + profile.fullName : "Tài khoản của bạn";
    }

    const emailEl = document.getElementById("accEmailText");
    if (emailEl) emailEl.textContent = profile.email;

    const roleBadge = document.getElementById("accRoleBadge");
    if (roleBadge) {
      roleBadge.className = "badge role-" + (profile.role || "customer");
      roleBadge.textContent = ROLE_LABELS[profile.role] || "Khách hàng";
    }

    const aal = (security && security.aal) || "aal1";
    const aalBadge = document.getElementById("accAalBadge");
    if (aalBadge) {
      aalBadge.className = "badge " + (aal === "aal2" ? "aal-2" : "aal-1");
      aalBadge.textContent = aal === "aal2" ? "2FA Đã xác thực (AAL2)" : "Chưa qua 2FA (AAL1)";
    }

    const adminBtn = document.getElementById("adminShortcutBtn");
    const isInternalRole = profile.role === "admin" || profile.role === "manager" || profile.role === "staff";
    if (adminBtn) {
      adminBtn.hidden = !isInternalRole;
      if (isInternalRole) {
        adminBtn.href = auth.getHomePageForRole(profile.role);
        adminBtn.textContent = "Mở " + auth.getWorkspaceLabelForRole(profile.role);
      }
    }

    const pwdLabel = document.getElementById("changePwdLabel");
    if (pwdLabel) {
      pwdLabel.textContent = "Đổi mật khẩu mới (tối thiểu " + (isInternalRole ? "14" : "10") + " ký tự)";
    }

    document.getElementById("profName").value = profile.fullName || "";
    document.getElementById("profPhone").value = profile.phone || "";
    document.getElementById("profAddress").value = profile.defaultAddress || "";
  }

  function renderRecoveryCodes(codes) {
    const box = document.getElementById("mfaRecoveryBox");
    const grid = document.getElementById("mfaRecoveryGrid");
    if (!box || !grid) return;
    latestRecoveryCodes = Array.isArray(codes) ? codes : [];
    grid.replaceChildren();
    latestRecoveryCodes.forEach((code) => {
      grid.appendChild(createEl("div", "recovery-code-item", code));
    });
    box.hidden = latestRecoveryCodes.length === 0;
  }

  function renderOrders(orders) {
    const emptyEl = document.getElementById("ordersEmptyState");
    const tableWrap = document.getElementById("ordersTableWrap");
    const tbody = document.getElementById("ordersTableBody");
    if (!emptyEl || !tableWrap || !tbody) return;

    tbody.replaceChildren();
    if (!Array.isArray(orders) || orders.length === 0) {
      emptyEl.hidden = false;
      tableWrap.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    tableWrap.hidden = false;

    orders.forEach((order) => {
      const tr = document.createElement("tr");

      const tdCode = createEl("td");
      tdCode.appendChild(createEl("strong", "", order.order_number || ""));
      tdCode.appendChild(createEl("span", "table-subtext", order.shipping_address || ""));

      const tdDate = createEl("td", "", fmtDate(order.created_at));

      const itemsSummary = Array.isArray(order.items)
        ? order.items.map(i => (i.name || i.id) + " × " + i.quantity).join(", ")
        : "";
      const tdItems = createEl("td", "", itemsSummary);

      const tdTotal = createEl("td");
      tdTotal.appendChild(createEl("strong", "", fmtPrice(order.total_amount) + "đ"));
      if (order.voucher_code && Number(order.discount_amount) > 0) {
        tdTotal.appendChild(
          createEl("span", "table-subtext", "Mã " + order.voucher_code + " (-" + fmtPrice(order.discount_amount) + "đ)")
        );
      }
      const tdPay = createEl("td", "", order.payment_method || "COD");

      const tdStatus = createEl("td");
      const st = order.status || "pending";
      const statusStack = createEl("div", "inline-control-stack");
      statusStack.appendChild(createEl("span", "badge status-" + st, ORDER_STATUS_LABELS[st] || st));

      if (st === "pending" && order.id) {
        const cancelBtn = createEl("button", "btn-sm outline", "Hủy đơn");
        cancelBtn.type = "button";
        cancelBtn.addEventListener("click", async () => {
          clearBanner();
          cancelBtn.disabled = true;
          cancelBtn.textContent = "Đang hủy...";
          try {
            await auth.apiRequest("account-api", {
              method: "PATCH",
              authRequired: true,
              body: { action: "cancel_order", orderId: order.id }
            });
            const refreshed = await auth.fetchCurrentAccountData();
            renderOrders(refreshed.orders || []);
            showBanner(
              "info",
              "Đã hủy đơn hàng " + (order.order_number || "") + " và hoàn lại tồn kho / lượt mã giảm giá."
            );
          } catch (error) {
            showBanner("error", error instanceof Error ? error.message : "Không thể hủy đơn hàng lúc này.");
            cancelBtn.disabled = false;
            cancelBtn.textContent = "Hủy đơn";
          }
        });
        statusStack.appendChild(cancelBtn);
      }
      tdStatus.appendChild(statusStack);

      tr.append(tdCode, tdDate, tdItems, tdTotal, tdPay, tdStatus);
      tbody.appendChild(tr);
    });
  }

  async function refreshMfaState() {
    const statusText = document.getElementById("mfaStatusText");
    const startEnrollBtn = document.getElementById("startEnrollMfaBtn");
    const startDisableBtn = document.getElementById("startDisableMfaBtn");
    const regenBtn = document.getElementById("regenRecoveryCodesBtn");
    const enrollArea = document.getElementById("mfaEnrollArea");
    const disableForm = document.getElementById("disableMfaForm");

    try {
      activeTotpFactors = await auth.getVerifiedTotpFactors();
      if (enrollArea) enrollArea.hidden = true;
      if (disableForm) disableForm.hidden = true;

      if (activeTotpFactors.length > 0) {
        const rem = currentProfile && typeof currentProfile.recoveryCodesRemaining === "number"
          ? " — Còn " + currentProfile.recoveryCodesRemaining + " mã khôi phục"
          : "";
        if (statusText) {
          statusText.textContent = "Trạng thái 2FA: Đang bật (" + (activeTotpFactors[0].friendly_name || "Authenticator") + ")" + rem + ".";
        }
        if (startEnrollBtn) startEnrollBtn.hidden = true;
        if (startDisableBtn) startDisableBtn.hidden = false;
        if (regenBtn && auth.getBackendMode && auth.getBackendMode() === "local-secure") {
          regenBtn.hidden = false;
        }
      } else {
        if (statusText) {
          statusText.textContent = "Trạng thái 2FA: Chưa bật. Nên bật ngay để bảo vệ tài khoản của bạn.";
        }
        if (startEnrollBtn) startEnrollBtn.hidden = false;
        if (startDisableBtn) startDisableBtn.hidden = true;
        if (regenBtn) regenBtn.hidden = true;
      }
    } catch {
      if (statusText) statusText.textContent = "Không kiểm tra được cấu hình 2FA lúc này.";
    }
  }

  // Save profile
  document.getElementById("profileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();

    const saveBtn = document.getElementById("saveProfileBtn");
    const fullName = (document.getElementById("profName")?.value || "").trim();
    const phone = (document.getElementById("profPhone")?.value || "").trim();
    const defaultAddress = (document.getElementById("profAddress")?.value || "").trim();

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "ĐANG LƯU...";
    }

    try {
      const result = await auth.apiRequest("account-api", {
        method: "PATCH",
        authRequired: true,
        body: { fullName, phone, defaultAddress }
      });
      if (result && result.profile) {
        currentProfile = result.profile;
        auth.setCachedProfile(result.profile);
        renderProfileHeader(currentProfile, { aal: auth.getSessionAal(auth.getSession()) });
      }
      showBanner("success", "Đã lưu thông tin hồ sơ cá nhân.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không cập nhật được hồ sơ.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "LƯU THÔNG TIN";
      }
    }
  });

  // Change password
  document.getElementById("changePasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();

    const newPwd = document.getElementById("newAccountPassword")?.value || "";
    const confirmPwd = document.getElementById("confirmAccountPassword")?.value || "";
    const btn = document.getElementById("changePwdBtn");

    const isPrivileged = currentProfile && (
      currentProfile.role === "admin" ||
      currentProfile.role === "manager" ||
      currentProfile.role === "staff"
    );
    const minLen = isPrivileged ? 14 : 10;
    const strength = auth.evaluatePasswordStrength(newPwd, currentProfile ? currentProfile.email : "", { minLength: minLen });
    if (!strength.valid) {
      showBanner("warning", "Mật khẩu mới phải dài tối thiểu " + minLen + " ký tự, có chữ hoa, chữ thường, số, ký tự đặc biệt và không chứa từ dễ đoán.");
      return;
    }
    if (newPwd !== confirmPwd) {
      showBanner("warning", "Mật khẩu nhập lại chưa khớp.");
      return;
    }

    if (btn) btn.disabled = true;
    try {
      await auth.updatePassword(newPwd);
      document.getElementById("changePasswordForm").reset();
      showBanner("success", "Đã cập nhật mật khẩu mới thành công.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không đổi được mật khẩu.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Enroll 2FA
  document.getElementById("startEnrollMfaBtn")?.addEventListener("click", async () => {
    clearBanner();
    const startBtn = document.getElementById("startEnrollMfaBtn");
    if (startBtn) startBtn.disabled = true;

    try {
      const enrolled = await auth.enrollTotp("Rang May Authenticator");
      pendingEnrollFactorId = enrolled.id;

      const qrUrl = auth.normalizeTotpQrDataUrl(enrolled.totp && enrolled.totp.qr_code);
      const qrImg = document.getElementById("mfaQrImg");
      const secretText = document.getElementById("mfaSecretText");
      const enrollArea = document.getElementById("mfaEnrollArea");

      if (qrImg) qrImg.src = qrUrl;
      if (secretText) secretText.textContent = (enrolled.totp && enrolled.totp.secret) || "";
      if (enrollArea) enrollArea.hidden = false;
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không khởi tạo được mã QR 2FA.");
    } finally {
      if (startBtn) startBtn.disabled = false;
    }
  });

  document.getElementById("cancelEnrollMfaBtn")?.addEventListener("click", async () => {
    if (pendingEnrollFactorId) {
      try {
        await auth.unenrollFactor(pendingEnrollFactorId);
      } catch {
        // Ignore cleanup failure for unverified factor
      }
      pendingEnrollFactorId = null;
    }
    document.getElementById("mfaEnrollArea").hidden = true;
  });

  document.getElementById("verifyEnrollMfaForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();

    const code = (document.getElementById("mfaEnrollCode")?.value || "").replace(/\s/g, "");
    const btn = document.getElementById("confirmEnrollMfaBtn");
    if (!pendingEnrollFactorId || !/^[0-9]{6}$/.test(code)) {
      showBanner("warning", "Vui lòng nhập chính xác mã OTP gồm 6 chữ số.");
      return;
    }

    if (btn) btn.disabled = true;
    try {
      const verifyResult = await auth.challengeAndVerifyTotp(pendingEnrollFactorId, code);
      pendingEnrollFactorId = null;
      document.getElementById("verifyEnrollMfaForm").reset();
      const accountData = await auth.fetchCurrentAccountData();
      currentProfile = accountData.profile;
      renderProfileHeader(currentProfile, accountData.security);
      await refreshMfaState();
      if (verifyResult && Array.isArray(verifyResult.recovery_codes)) {
        renderRecoveryCodes(verifyResult.recovery_codes);
      }
      showBanner("success", "Đã bật xác thực 2 yếu tố (2FA) thành công! Hãy lưu ngay các mã khôi phục dự phòng.");
    } catch {
      showBanner("error", "Mã OTP không đúng hoặc đã hết hạn. Vui lòng kiểm tra đồng hồ thiết bị và thử lại.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("regenRecoveryCodesBtn")?.addEventListener("click", async () => {
    clearBanner();
    const btn = document.getElementById("regenRecoveryCodesBtn");
    if (btn) btn.disabled = true;
    try {
      const res = await auth.regenerateRecoveryCodes();
      if (res && Array.isArray(res.recovery_codes)) {
        renderRecoveryCodes(res.recovery_codes);
        const accountData = await auth.fetchCurrentAccountData();
        currentProfile = accountData.profile;
        await refreshMfaState();
        showBanner("success", "Đã tạo bộ 8 mã khôi phục mới (bộ cũ đã bị hủy).");
      }
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Vui lòng đăng nhập qua 2FA (AAL2) trước khi tạo lại mã khôi phục.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("downloadRecoveryCodesBtn")?.addEventListener("click", () => {
    if (!latestRecoveryCodes.length) return;
    const text = "RANG MAY COFFEE - MA KHOI PHUC 2FA (DUNG MOT LAN)\nEmail: " +
      (currentProfile?.email || "") + "\n\n" + latestRecoveryCodes.join("\n") + "\n";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rangmay-2fa-recovery-codes.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("hideRecoveryCodesBtn")?.addEventListener("click", () => {
    const box = document.getElementById("mfaRecoveryBox");
    if (box) box.hidden = true;
  });

  // Disable 2FA
  document.getElementById("startDisableMfaBtn")?.addEventListener("click", async () => {
    clearBanner();
    const session = auth.getSession();
    const aal = auth.getSessionAal(session);
    if (aal === "aal2" && activeTotpFactors[0]) {
      try {
        await auth.unenrollFactor(activeTotpFactors[0].id);
        await auth.refreshSession();
        await refreshMfaState();
        const accountData = await auth.fetchCurrentAccountData();
        renderProfileHeader(accountData.profile, accountData.security);
        showBanner("info", "Đã tắt xác thực 2 yếu tố (2FA).");
      } catch (error) {
        showBanner("error", error instanceof Error ? error.message : "Không thể tắt 2FA.");
      }
    } else {
      document.getElementById("disableMfaForm").hidden = false;
    }
  });

  document.getElementById("cancelDisableMfaBtn")?.addEventListener("click", () => {
    document.getElementById("disableMfaForm").hidden = true;
  });

  document.getElementById("disableMfaForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();

    const code = (document.getElementById("disableMfaCode")?.value || "").replace(/\s/g, "");
    if (!activeTotpFactors[0] || !/^[0-9]{6}$/.test(code)) {
      showBanner("warning", "Vui lòng nhập mã 6 chữ số hợp lệ.");
      return;
    }

    const btn = document.getElementById("confirmDisableMfaBtn");
    if (btn) btn.disabled = true;

    try {
      const factorId = activeTotpFactors[0].id;
      await auth.challengeAndVerifyTotp(factorId, code);
      await auth.unenrollFactor(factorId);
      await auth.refreshSession();
      document.getElementById("disableMfaForm").reset();
      await refreshMfaState();
      const accountData = await auth.fetchCurrentAccountData();
      renderProfileHeader(accountData.profile, accountData.security);
      showBanner("info", "Đã xác minh và tắt 2FA.");
    } catch {
      showBanner("error", "Mã xác thực không hợp lệ. Chưa thể tắt 2FA.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Logout actions
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await auth.signOut("local");
    window.location.href = "index.html";
  });

  document.getElementById("logoutAllBtn")?.addEventListener("click", async () => {
    await auth.signOut("global");
    window.location.href = "login.html";
  });

  // Boot
  (async function boot() {
    const guardLoader = document.getElementById("routeGuardLoader");
    auth.bindMobileNavbarToggle();

    const mode = await auth.initBackendMode();
    if (mode === "unconfigured") {
      if (guardLoader) guardLoader.hidden = true;
      showBanner("warning", "Website chưa được cấu hình kết nối Supabase (assets/js/config.js) hoặc máy chủ bảo mật cục bộ.");
      return;
    }

    const token = await auth.getValidAccessToken();
    if (!token) {
      window.location.href = "login.html?next=account.html";
      return;
    }

    auth.renderHeaderAuthState("headerAuthArea");

    try {
      const data = await auth.fetchCurrentAccountData();
      if (guardLoader) guardLoader.hidden = true;
      currentProfile = data.profile;
      renderProfileHeader(data.profile, data.security);
      renderOrders(data.orders || []);
      await refreshMfaState();
    } catch (error) {
      if (guardLoader) guardLoader.hidden = true;
      if (error && error.status === 401) {
        auth.clearSession();
        window.location.href = "login.html?next=account.html";
        return;
      }
      showBanner("error", error instanceof Error ? error.message : "Không tải được thông tin tài khoản.");
    }
  })();
})();
