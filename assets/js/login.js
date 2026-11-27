(function initLoginPage() {
  "use strict";

  const auth = window.RangMayAuth;
  if (!auth) return;

  const statusBanner = document.getElementById("statusBanner");
  const backendNotice = document.getElementById("backendNotice");
  const authTabs = document.getElementById("authTabs");

  const loginForm = document.getElementById("loginForm");
  const mfaChallengeForm = document.getElementById("mfaChallengeForm");
  const registerForm = document.getElementById("registerForm");
  const forgotForm = document.getElementById("forgotForm");
  const recoveryForm = document.getElementById("recoveryForm");

  const rawNext = new URLSearchParams(window.location.search).get("next");
  let failedLoginCount = 0;
  let cooldownUntil = 0;
  let cooldownTimer = null;

  function showStatus(kind, message) {
    if (!statusBanner) return;
    statusBanner.className = "portal-banner " + kind;
    statusBanner.textContent = message;
    statusBanner.hidden = false;
  }

  function clearStatus() {
    if (!statusBanner) return;
    statusBanner.hidden = true;
    statusBanner.textContent = "";
  }

  function switchTab(tabName) {
    clearStatus();
    if (authTabs) authTabs.hidden = false;
    loginForm.hidden = tabName !== "login";
    registerForm.hidden = tabName !== "register";
    forgotForm.hidden = tabName !== "forgot";
    mfaChallengeForm.hidden = true;
    recoveryForm.hidden = true;

    document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.authTab === tabName);
    });
  }

  function updateStrengthMeter(passwordInput, emailInput, labelEl, barsContainer, checklistEl) {
    const email = emailInput ? emailInput.value : "";
    const result = auth.evaluatePasswordStrength(passwordInput.value, email);

    if (labelEl) {
      labelEl.textContent = passwordInput.value ? result.label : "Chưa nhập";
    }

    if (barsContainer) {
      const bars = barsContainer.querySelectorAll(".strength-bar");
      bars.forEach((bar, idx) => {
        bar.className = "strength-bar";
        if (passwordInput.value && idx < result.score) {
          bar.classList.add("level-" + Math.min(4, Math.max(1, result.score)));
        }
      });
    }

    if (checklistEl) {
      const labels = {
        minLength: "Từ 10 ký tự trở lên",
        hasUpper: "Có chữ in hoa (A–Z)",
        hasLower: "Có chữ thường (a–z)",
        hasNumber: "Có chữ số (0–9)",
        hasSpecial: "Có ký tự đặc biệt (!@#$...)",
        notCommon: "Không trùng email / từ dễ đoán"
      };
      checklistEl.querySelectorAll("li[data-rule]").forEach((li) => {
        const rule = li.dataset.rule;
        const ok = Boolean(result.checks[rule]);
        li.classList.toggle("ok", ok);
        li.textContent = (ok ? "✓ " : "✗ ") + (labels[rule] || rule);
      });
    }

    return result;
  }

  async function completeAuthenticatedNavigation() {
    let role = "customer";
    try {
      const accountData = await auth.fetchCurrentAccountData();
      if (accountData && accountData.profile && accountData.profile.role) {
        role = accountData.profile.role;
      }
    } catch {
      // Fallback to account page if profile endpoint temporarily fails
    }

    const defaultDest = auth.getHomePageForRole(role);
    const destination = auth.getSafeRedirect(rawNext, defaultDest);
    window.location.href = destination;
  }

  let mfaUseRecoveryMode = false;

  function setMfaRecoveryMode(useRecovery) {
    mfaUseRecoveryMode = Boolean(useRecovery);
    const totpGroup = document.getElementById("mfaTotpCodeGroup");
    const recGroup = document.getElementById("mfaRecoveryCodeGroup");
    const factorGroup = document.getElementById("mfaFactorGroup");
    const toggleBtn = document.getElementById("toggleRecoveryModeBtn");
    const promptLead = document.getElementById("mfaPromptLead");
    const factorSelect = document.getElementById("mfaFactorSelect");

    if (totpGroup) totpGroup.hidden = mfaUseRecoveryMode;
    if (recGroup) recGroup.hidden = !mfaUseRecoveryMode;
    if (factorGroup) {
      factorGroup.hidden = mfaUseRecoveryMode || !factorSelect || factorSelect.options.length <= 1;
    }
    if (toggleBtn) {
      toggleBtn.textContent = mfaUseRecoveryMode ? "Dùng mã OTP 6 số" : "Dùng mã khôi phục dự phòng";
    }
    if (promptLead) {
      promptLead.textContent = mfaUseRecoveryMode
        ? "Nhập một trong 8 mã khôi phục dự phòng (dạng XXXX-XXXX) để xác minh và nâng cấp phiên."
        : "Mở ứng dụng Authenticator trên điện thoại và nhập mã 6 chữ số để hoàn tất đăng nhập.";
    }
    if (mfaUseRecoveryMode) {
      document.getElementById("mfaRecoveryCodeInput")?.focus();
    } else {
      document.getElementById("mfaChallengeCode")?.focus();
    }
  }

  document.getElementById("toggleRecoveryModeBtn")?.addEventListener("click", () => {
    clearStatus();
    setMfaRecoveryMode(!mfaUseRecoveryMode);
  });

  function startCooldown(seconds) {
    const loginSubmitBtn = document.getElementById("loginSubmitBtn");
    cooldownUntil = Date.now() + seconds * 1000;
    if (cooldownTimer) window.clearInterval(cooldownTimer);

    const tick = () => {
      const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = null;
        if (loginSubmitBtn) {
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.textContent = "ĐĂNG NHẬP";
        }
        return;
      }
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = "VUI LÒNG ĐỢI " + remaining + "s";
      }
    };

    tick();
    cooldownTimer = window.setInterval(tick, 1000);
  }

  // Toggle password visibility buttons
  document.querySelectorAll("[data-toggle-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.toggleTarget);
      if (!target) return;
      const showing = target.type === "text";
      target.type = showing ? "password" : "text";
      btn.textContent = showing ? "Hiện" : "Ẩn";
    });
  });

  // Tab buttons
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.authTab));
  });

  document.getElementById("goForgotBtn")?.addEventListener("click", () => switchTab("forgot"));

  // Live password strength meters
  const regPassword = document.getElementById("regPassword");
  const regEmail = document.getElementById("regEmail");
  const regLabel = document.getElementById("regStrengthLabel");
  const regBars = document.getElementById("regStrengthBars");
  const regChecklist = document.getElementById("regStrengthChecklist");

  if (regPassword) {
    const refreshRegMeter = () => updateStrengthMeter(regPassword, regEmail, regLabel, regBars, regChecklist);
    regPassword.addEventListener("input", refreshRegMeter);
    regEmail?.addEventListener("input", refreshRegMeter);
  }

  const recPassword = document.getElementById("recoveryPassword");
  const recLabel = document.getElementById("recoveryStrengthLabel");
  const recBars = document.getElementById("recoveryStrengthBars");
  const recChecklist = document.getElementById("recoveryStrengthChecklist");

  if (recPassword) {
    recPassword.addEventListener("input", () => {
      updateStrengthMeter(recPassword, null, recLabel, recBars, recChecklist);
    });
  }

  // Login Handler
  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    if (Date.now() < cooldownUntil) return;

    const email = (document.getElementById("loginEmail")?.value || "").trim();
    const password = document.getElementById("loginPassword")?.value || "";
    const remember = Boolean(document.getElementById("rememberLogin")?.checked);
    const submitBtn = document.getElementById("loginSubmitBtn");

    if (!email || !password) {
      showStatus("warning", "Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "ĐANG XÁC THỰC...";
    }

    try {
      const session = await auth.signInWithPassword({ email, password, remember });
      failedLoginCount = 0;

      const factors = await auth.getVerifiedTotpFactors();
      const currentAal = auth.getSessionAal(session);

      if (factors.length > 0 && currentAal !== "aal2") {
        const factorSelect = document.getElementById("mfaFactorSelect");
        const factorGroup = document.getElementById("mfaFactorGroup");
        if (factorSelect && factorGroup) {
          factorSelect.replaceChildren();
          factors.forEach((factor, index) => {
            const option = document.createElement("option");
            option.value = factor.id;
            option.textContent = factor.friendly_name || ("Authenticator #" + (index + 1));
            factorSelect.appendChild(option);
          });
          factorGroup.hidden = factors.length <= 1;
        }
        if (authTabs) authTabs.hidden = true;
        loginForm.hidden = true;
        mfaChallengeForm.hidden = false;
        setMfaRecoveryMode(false);
        return;
      }

      await completeAuthenticatedNavigation();
    } catch (error) {
      failedLoginCount += 1;
      if (error && error.code === "BACKEND_NOT_CONFIGURED") {
        showStatus("warning", error.message);
      } else if (error && error.status === 429) {
        showStatus("error", error.message || "Tạm khóa đăng nhập do nhập sai quá nhiều lần.");
        startCooldown(Number(error.retryAfter) || 60);
      } else {
        showStatus(
          "error",
          "Email hoặc mật khẩu chưa đúng, hoặc tài khoản chưa xác minh email."
        );
      }
      if (failedLoginCount >= 5 && Date.now() >= cooldownUntil) {
        const waitSeconds = Math.min(60, 15 * (failedLoginCount - 4));
        startCooldown(waitSeconds);
      }
    } finally {
      if (submitBtn && Date.now() >= cooldownUntil) {
        submitBtn.disabled = false;
        submitBtn.textContent = "ĐĂNG NHẬP";
      }
    }
  });

  // 2FA Verification Step (TOTP or Single-Use Recovery Code)
  mfaChallengeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    const verifyBtn = document.getElementById("mfaVerifyBtn");

    if (mfaUseRecoveryMode) {
      const recoveryCode = (document.getElementById("mfaRecoveryCodeInput")?.value || "").trim();
      if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(recoveryCode)) {
        showStatus("warning", "Vui lòng nhập đúng mã khôi phục gồm 8 ký tự (ví dụ ABCD-EFGH).");
        return;
      }
      if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.textContent = "ĐANG KIỂM TRA...";
      }
      try {
        await auth.verifyRecoveryCode(recoveryCode);
        await completeAuthenticatedNavigation();
      } catch (error) {
        showStatus("error", error instanceof Error ? error.message : "Mã khôi phục không đúng hoặc đã được sử dụng.");
      } finally {
        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.textContent = "XÁC MINH 2FA";
        }
      }
      return;
    }

    const factorId = document.getElementById("mfaFactorSelect")?.value;
    const code = (document.getElementById("mfaChallengeCode")?.value || "").replace(/\s/g, "");

    if (!factorId || !/^[0-9]{6}$/.test(code)) {
      showStatus("warning", "Vui lòng nhập chính xác mã OTP gồm 6 chữ số.");
      return;
    }

    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = "ĐANG KIỂM TRA...";
    }

    try {
      await auth.challengeAndVerifyTotp(factorId, code);
      await completeAuthenticatedNavigation();
    } catch {
      showStatus("error", "Mã 2FA không hợp lệ hoặc đã hết hạn. Vui lòng thử lại mã mới.");
    } finally {
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = "XÁC MINH 2FA";
      }
    }
  });

  document.getElementById("mfaCancelBtn")?.addEventListener("click", async () => {
    await auth.signOut("local");
    switchTab("login");
  });

  // Registration Handler
  registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    const fullName = (document.getElementById("regName")?.value || "").trim();
    const email = (document.getElementById("regEmail")?.value || "").trim();
    const password = document.getElementById("regPassword")?.value || "";
    const confirm = document.getElementById("regPasswordConfirm")?.value || "";
    const website = document.getElementById("regWebsite")?.value || "";
    const submitBtn = document.getElementById("registerSubmitBtn");

    if (fullName.length < 2) {
      showStatus("warning", "Họ và tên phải có ít nhất 2 ký tự.");
      return;
    }

    const strength = auth.evaluatePasswordStrength(password, email);
    if (!strength.valid) {
      showStatus("warning", "Mật khẩu chưa đạt đủ yêu cầu bảo mật (ít nhất 10 ký tự, có chữ hoa, chữ thường, số, ký tự đặc biệt và không dễ đoán).");
      return;
    }

    if (password !== confirm) {
      showStatus("warning", "Mật khẩu nhập lại không khớp.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "ĐANG TẠO TÀI KHOẢN...";
    }

    try {
      const signupRes = await auth.signUp({ email, password, fullName, website });
      registerForm.reset();
      updateStrengthMeter(regPassword, regEmail, regLabel, regBars, regChecklist);

      if (signupRes && typeof signupRes.access_token === "string" && signupRes.access_token) {
        showStatus("success", "🎉 Tạo tài khoản Gmail (" + email + ") thành công! Đang chuyển vào trang Tài khoản...");
        await completeAuthenticatedNavigation();
        return;
      }

      try {
        await auth.signInWithPassword({ email, password, remember: false });
        showStatus("success", "🎉 Tạo tài khoản Gmail (" + email + ") thành công! Đang chuyển vào trang Tài khoản...");
        await completeAuthenticatedNavigation();
        return;
      } catch {
        switchTab("login");
        const loginEmailEl = document.getElementById("loginEmail");
        if (loginEmailEl) loginEmailEl.value = email;
        showStatus(
          "success",
          "🎉 Tạo tài khoản (" + email + ") thành công! Bạn có thể đăng nhập ngay bên dưới."
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message.toLowerCase() : "";
      if (error && error.code === "BACKEND_NOT_CONFIGURED") {
        showStatus("warning", error.message);
      } else if (errMsg.includes("already registered") || errMsg.includes("already been registered")) {
        switchTab("login");
        const loginEmailEl = document.getElementById("loginEmail");
        if (loginEmailEl) loginEmailEl.value = email;
        showStatus("info", "Tài khoản Gmail (" + email + ") đã tồn tại trên hệ thống! Mình đã điền sẵn email để bạn đăng nhập ngay bên dưới.");
      } else {
        showStatus("error", (error instanceof Error && error.message) ? error.message : "Không thể hoàn tất đăng ký lúc này. Vui lòng kiểm tra thông tin và thử lại.");
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "TẠO TÀI KHOẢN";
      }
    }
  });

  // Forgot Password Handler
  forgotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    const email = (document.getElementById("forgotEmail")?.value || "").trim();
    const submitBtn = document.getElementById("forgotSubmitBtn");
    if (!email) {
      showStatus("warning", "Vui lòng nhập email đã đăng ký.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "ĐANG GỬI YÊU CẦU...";
    }

    try {
      await auth.sendPasswordReset(email);
      forgotForm.reset();
      showStatus(
        "success",
        "Nếu email tồn tại trong hệ thống, liên kết đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư (kể cả mục Spam)."
      );
    } catch (error) {
      if (error && error.code === "BACKEND_NOT_CONFIGURED") {
        showStatus("warning", error.message);
      } else {
        showStatus(
          "success",
          "Nếu email tồn tại trong hệ thống, liên kết đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư (kể cả mục Spam)."
        );
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "GỬI LIÊN KẾT ĐẶT LẠI MẬT KHẨU";
      }
    }
  });

  // Recovery Password Update Handler
  recoveryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    const newPassword = document.getElementById("recoveryPassword")?.value || "";
    const confirmPassword = document.getElementById("recoveryPasswordConfirm")?.value || "";
    const submitBtn = document.getElementById("recoverySubmitBtn");

    const strength = auth.evaluatePasswordStrength(newPassword, "");
    if (!strength.valid) {
      showStatus("warning", "Mật khẩu mới chưa đạt tiêu chuẩn bảo mật (tối thiểu 10 ký tự, đủ chữ hoa, chữ thường, số và ký tự đặc biệt).");
      return;
    }

    if (newPassword !== confirmPassword) {
      showStatus("warning", "Mật khẩu xác nhận không khớp.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "ĐANG CẬP NHẬT...";
    }

    try {
      await auth.updatePassword(newPassword);
      recoveryForm.reset();
      await auth.signOut("local");
      switchTab("login");
      showStatus("success", "Đổi mật khẩu thành công! Vui lòng đăng nhập lại bằng mật khẩu mới.");
    } catch (error) {
      showStatus("error", error instanceof Error ? error.message : "Không thể cập nhật mật khẩu.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "CẬP NHẬT MẬT KHẨU MỚI";
      }
    }
  });

  // Boot sequence
  (async function boot() {
    auth.bindMobileNavbarToggle();

    const mode = await auth.initBackendMode();
    if (mode === "unconfigured") {
      if (backendNotice) backendNotice.hidden = false;
      return;
    }

    const redirectOutcome = await auth.handleAuthRedirectFromUrl();
    if (redirectOutcome) {
      if (redirectOutcome.type === "error") {
        showStatus("error", redirectOutcome.message);
      } else if (redirectOutcome.type === "recovery") {
        if (authTabs) authTabs.hidden = true;
        loginForm.hidden = true;
        registerForm.hidden = true;
        forgotForm.hidden = true;
        mfaChallengeForm.hidden = true;
        recoveryForm.hidden = false;
        showStatus("info", "Xác thực liên kết khôi phục thành công. Hãy thiết lập mật khẩu mới bên dưới.");
        return;
      } else if (redirectOutcome.type === "signup") {
        showStatus("success", "Xác minh email thành công! Bạn đã đăng nhập vào tài khoản.");
        await completeAuthenticatedNavigation();
        return;
      }
    }

    const existingToken = await auth.getValidAccessToken();
    if (existingToken) {
      await completeAuthenticatedNavigation();
    }
  })();
})();
