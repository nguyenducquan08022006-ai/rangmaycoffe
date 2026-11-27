(function initRangMayAuth(root) {
  "use strict";

  const SESSION_KEY = "rm_auth_session";
  const PROFILE_KEY = "rm_auth_profile";
  const PERSIST_KEY = "rm_auth_persist";
  const PKCE_VERIFIER_KEY = "rm_pkce_verifier";

  const COMMON_PASSWORDS = new Set([
    "123456", "12345678", "123456789", "1234567890", "password", "password123",
    "qwerty123", "admin123", "admin@123", "admin@1234", "admin@12345",
    "rangmay123", "rangmaycoffee", "iloveyou", "abc12345", "letmein123", "welcome123"
  ]);

  const SAFE_REDIRECT_PAGES = new Set([
    "index.html",
    "account.html",
    "admin.html",
    "manager.html",
    "staff.html"
  ]);

  let refreshPromise = null;
  let backendProbePromise = null;
  let detectedLocalServerInfo = null;

  function getConfig() {
    if (typeof window !== "undefined" && window.RANG_MAY_CONFIG) {
      return window.RANG_MAY_CONFIG;
    }
    return {
      supabaseUrl: "",
      supabaseAnonKey: "",
      turnstileSiteKey: "",
      adminIdleTimeoutMinutes: 30
    };
  }

  function hasSupabaseConfig() {
    const cfg = getConfig();
    return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  function isLocalhostBrowser() {
    if (typeof window === "undefined" || !window.location) return false;
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1";
  }

  function getBackendMode() {
    if (detectedLocalServerInfo && detectedLocalServerInfo.ok) return "local-secure";
    if (hasSupabaseConfig()) return "supabase";
    return "unconfigured";
  }

  function isConfigured() {
    if (isLocalhostBrowser() && !backendProbePromise) return false;
    return getBackendMode() !== "unconfigured";
  }

  function getLocalServerInfo() {
    return detectedLocalServerInfo;
  }

  async function initBackendMode() {
    if (detectedLocalServerInfo && detectedLocalServerInfo.ok) return "local-secure";
    if (hasSupabaseConfig() && !isLocalhostBrowser()) return "supabase";
    if (typeof window === "undefined" || typeof fetch !== "function") {
      return hasSupabaseConfig() ? "supabase" : "unconfigured";
    }
    const proto = window.location && window.location.protocol;
    if (proto !== "http:" && proto !== "https:") {
      return hasSupabaseConfig() ? "supabase" : "unconfigured";
    }

    if (!backendProbePromise) {
      backendProbePromise = (async () => {
        try {
          const response = await fetch("/api/health", {
            method: "GET",
            cache: "no-store"
          });
          if (!response.ok) return hasSupabaseConfig() ? "supabase" : "unconfigured";
          const data = await response.json().catch(() => null);
          if (data && data.ok === true && data.mode === "local-secure") {
            detectedLocalServerInfo = data;
            return "local-secure";
          }
          return hasSupabaseConfig() ? "supabase" : "unconfigured";
        } catch {
          return hasSupabaseConfig() ? "supabase" : "unconfigured";
        }
      })();
    }

    return await backendProbePromise;
  }

  function getSupabaseUrl() {
    return (getConfig().supabaseUrl || "").replace(/\/+$/, "");
  }

  function getAnonKey() {
    return getConfig().supabaseAnonKey || "";
  }

  function evaluatePasswordStrength(password, email, options = {}) {
    const pwd = typeof password === "string" ? password : "";
    const minLength = Number(options && options.minLength) || 10;
    const lowerPwd = pwd.toLowerCase();
    const emailLocal = typeof email === "string" && email.includes("@")
      ? email.split("@")[0].trim().toLowerCase()
      : "";

    const checks = {
      minLength: pwd.length >= minLength && pwd.length <= 128,
      hasUpper: /[A-Z]/.test(pwd),
      hasLower: /[a-z]/.test(pwd),
      hasNumber: /[0-9]/.test(pwd),
      hasSpecial: /[^A-Za-z0-9\s]/.test(pwd),
      notCommon: !COMMON_PASSWORDS.has(lowerPwd) &&
        !lowerPwd.includes("rangmay") &&
        !lowerPwd.includes("password") &&
        !lowerPwd.includes("qwerty") &&
        !lowerPwd.includes("123456") &&
        !/^admin[^a-z0-9]*\d+$/i.test(lowerPwd) &&
        (emailLocal.length < 3 || !lowerPwd.includes(emailLocal))
    };

    let score = 0;
    if (checks.minLength) score += 1;
    if (checks.hasUpper && checks.hasLower) score += 1;
    if (checks.hasNumber) score += 1;
    if (checks.hasSpecial) score += 1;
    if (!checks.notCommon && score > 1) score -= 1;

    const valid = checks.minLength &&
      checks.hasUpper &&
      checks.hasLower &&
      checks.hasNumber &&
      checks.hasSpecial &&
      checks.notCommon;

    let label = "Rất yếu";
    if (score >= 4 && valid) label = "Mạnh";
    else if (score === 3) label = "Trung bình";
    else if (score === 2) label = "Yếu";

    return { valid, score, label, checks, minLength };
  }

  function getSafeRedirect(rawNext, fallback = "account.html") {
    if (!rawNext || typeof rawNext !== "string") return fallback;
    const trimmed = rawNext.trim();
    if (!trimmed ||
      trimmed.startsWith("//") ||
      trimmed.includes("://") ||
      trimmed.includes("\\") ||
      trimmed.includes("..") ||
      trimmed.includes("?") ||
      trimmed.toLowerCase().startsWith("javascript:") ||
      trimmed.toLowerCase().startsWith("data:")) {
      return fallback;
    }

    const stripped = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
    const parts = stripped.split("#");
    const base = parts[0];
    const hash = parts.length === 2 ? "#" + parts[1] : "";

    if (!SAFE_REDIRECT_PAGES.has(base)) return fallback;
    if (parts.length > 2) return fallback;
    if (hash && !/^#[a-zA-Z0-9_-]+$/.test(hash)) return fallback;
    return base + hash;
  }

  function sanitizeSvg(svgText) {
    return svgText
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "");
  }

  function normalizeTotpQrDataUrl(qrCode) {
    if (!qrCode || typeof qrCode !== "string") return "";
    const trimmed = qrCode.trim();
    if (trimmed.startsWith("data:image/png;base64,") || trimmed.startsWith("data:image/svg+xml;base64,")) {
      return trimmed;
    }
    if (trimmed.startsWith("data:image/svg+xml;charset=utf-8,")) {
      const raw = trimmed.slice("data:image/svg+xml;charset=utf-8,".length);
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        decoded = raw;
      }
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sanitizeSvg(decoded));
    }
    if (trimmed.startsWith("data:image/svg+xml;utf8,")) {
      const rawSvg = sanitizeSvg(trimmed.slice("data:image/svg+xml;utf8,".length));
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(rawSvg);
    }
    if (trimmed.startsWith("data:image/svg+xml,")) {
      const raw = trimmed.slice("data:image/svg+xml,".length);
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        decoded = raw;
      }
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sanitizeSvg(decoded));
    }
    if (trimmed.startsWith("<svg")) {
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sanitizeSvg(trimmed));
    }
    return "";
  }

  function decodeJwtPayload(token) {
    if (!token || typeof token !== "string") return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      let jsonStr;
      if (typeof atob === "function") {
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        jsonStr = new TextDecoder().decode(bytes);
      } else if (typeof Buffer !== "undefined") {
        jsonStr = Buffer.from(padded, "base64").toString("utf8");
      } else {
        return null;
      }
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  function getSessionAal(session) {
    const payload = decodeJwtPayload(session && session.access_token);
    return payload && typeof payload.aal === "string" ? payload.aal : "aal1";
  }

  function getStorages() {
    if (typeof window === "undefined") return [];
    return [window.sessionStorage, window.localStorage];
  }

  function getSession() {
    if (typeof window === "undefined") return null;
    for (const storage of getStorages()) {
      try {
        const raw = storage.getItem(SESSION_KEY);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.access_token === "string") {
          return parsed;
        }
      } catch {
        storage.removeItem(SESSION_KEY);
      }
    }
    return null;
  }

  function isPersistentLogin() {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(PERSIST_KEY) === "1";
  }

  function saveSession(authData, persistOverride) {
    if (typeof window === "undefined" || !authData || !authData.access_token) return null;

    const cachedProfile = getCachedProfile();
    const isPrivileged = cachedProfile && (
      cachedProfile.role === "admin" ||
      cachedProfile.role === "manager" ||
      cachedProfile.role === "staff"
    );
    const shouldPersist = !isPrivileged && (typeof persistOverride === "boolean" ? persistOverride : isPersistentLogin());

    const expiresIn = Number(authData.expires_in) || 3600;
    const expiresAt = Number(authData.expires_at) || (Math.floor(Date.now() / 1000) + expiresIn);
    const normalized = {
      access_token: authData.access_token,
      refresh_token: authData.refresh_token || "",
      token_type: authData.token_type || "bearer",
      expires_at: expiresAt,
      user: authData.user || null
    };

    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
      if (shouldPersist) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
        window.localStorage.setItem(PERSIST_KEY, "1");
      } else {
        window.localStorage.removeItem(SESSION_KEY);
        window.localStorage.removeItem(PERSIST_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
    return normalized;
  }

  function getCachedProfile() {
    if (typeof window === "undefined") return null;
    for (const storage of getStorages()) {
      try {
        const raw = storage.getItem(PROFILE_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        storage.removeItem(PROFILE_KEY);
      }
    }
    return null;
  }

  function setCachedProfile(profile) {
    if (typeof window === "undefined" || !profile) return;
    const isPrivileged = profile.role === "admin" || profile.role === "manager" || profile.role === "staff";
    try {
      window.sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      if (isPrivileged) {
        // Admin/manager/staff sessions are strictly restricted to sessionStorage
        window.localStorage.removeItem(SESSION_KEY);
        window.localStorage.removeItem(PROFILE_KEY);
        window.localStorage.removeItem(PERSIST_KEY);
      } else if (isPersistentLogin()) {
        window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      }
    } catch {
      // Ignore storage errors
    }
  }

  function clearSession() {
    if (typeof window === "undefined") return;
    for (const storage of getStorages()) {
      try {
        storage.removeItem(SESSION_KEY);
        storage.removeItem(PROFILE_KEY);
        storage.removeItem(PERSIST_KEY);
      } catch {
        // Ignore storage errors
      }
    }
  }

  async function authFetch(path, { method = "GET", body, accessToken } = {}) {
    if (!isConfigured()) {
      await initBackendMode();
    }
    const mode = getBackendMode();
    if (mode === "unconfigured") {
      const err = new Error("Website chưa được cấu hình kết nối Supabase (assets/js/config.js) hoặc máy chủ bảo mật cục bộ.");
      err.code = "BACKEND_NOT_CONFIGURED";
      throw err;
    }

    const baseUrl = mode === "local-secure" ? "/api/auth" : getSupabaseUrl() + "/auth/v1";
    const apiKey = mode === "local-secure" ? "local-secure-anon" : getAnonKey();

    const headers = {
      "apikey": apiKey,
      "Content-Type": "application/json"
    };
    if (accessToken) {
      headers.Authorization = "Bearer " + accessToken;
    }

    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const rawMessage = data.msg || data.error_description || data.error || "Yêu cầu xác thực thất bại.";
      const err = new Error(rawMessage);
      err.status = response.status;
      err.code = data.error_code || data.error || "AUTH_ERROR";
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) err.retryAfter = Number(retryAfter) || 60;
      throw err;
    }
    return data;
  }

  function getLoginPageUrl() {
    if (typeof window === "undefined") return "";
    return new URL("login.html", window.location.href).href;
  }

  async function signUp({ email, password, fullName, website = "" }) {
    const redirect = encodeURIComponent(getLoginPageUrl());
    const payload = {
      email: email.trim(),
      password,
      data: { full_name: fullName.trim() }
    };
    if (website) payload.website = website;
    const data = await authFetch("/signup?redirect_to=" + redirect, {
      method: "POST",
      body: payload
    });
    if (data && typeof data.access_token === "string" && data.access_token) {
      saveSession(data, false);
    }
    return data;
  }

  async function signInWithPassword({ email, password, remember = false }) {
    clearSession();
    const data = await authFetch("/token?grant_type=password", {
      method: "POST",
      body: { email: email.trim(), password }
    });
    return saveSession(data, Boolean(remember));
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const current = getSession();
    if (!current || !current.refresh_token) return null;

    refreshPromise = (async () => {
      try {
        const data = await authFetch("/token?grant_type=refresh_token", {
          method: "POST",
          body: { refresh_token: current.refresh_token }
        });
        return saveSession(data);
      } catch {
        clearSession();
        return null;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  async function getValidAccessToken() {
    const session = getSession();
    if (!session) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at - 60 > nowSec) {
      return session.access_token;
    }
    const refreshed = await refreshSession();
    return refreshed ? refreshed.access_token : null;
  }

  async function getUser(explicitToken) {
    const token = explicitToken || await getValidAccessToken();
    if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
    const user = await authFetch("/user", {
      method: "GET",
      accessToken: token
    });
    const session = getSession();
    if (session) {
      session.user = user;
      saveSession(session);
    }
    return user;
  }

  async function updatePassword(newPassword) {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Vui lòng đăng nhập lại trước khi đổi mật khẩu.");
    return await authFetch("/user", {
      method: "PUT",
      accessToken: token,
      body: { password: newPassword }
    });
  }

  async function sendPasswordReset(email) {
    const redirect = encodeURIComponent(getLoginPageUrl());
    return await authFetch("/recover?redirect_to=" + redirect, {
      method: "POST",
      body: { email: email.trim() }
    });
  }

  async function signOut(scope = "local") {
    const session = getSession();
    if (session && session.access_token && isConfigured()) {
      try {
        await authFetch("/logout?scope=" + encodeURIComponent(scope), {
          method: "POST",
          accessToken: session.access_token
        });
      } catch {
        // Best-effort server revocation; always clear client session
      }
    }
    clearSession();
  }

  async function enrollTotp(friendlyName = "Rang May Authenticator") {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Vui lòng đăng nhập để thiết lập 2FA.");
    return await authFetch("/factors", {
      method: "POST",
      accessToken: token,
      body: {
        factor_type: "totp",
        friendly_name: friendlyName
      }
    });
  }

  async function challengeTotp(factorId) {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Vui lòng đăng nhập lại.");
    return await authFetch("/factors/" + encodeURIComponent(factorId) + "/challenge", {
      method: "POST",
      accessToken: token,
      body: {}
    });
  }

  async function verifyTotp(factorId, challengeId, code) {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Vui lòng đăng nhập lại.");
    const data = await authFetch("/factors/" + encodeURIComponent(factorId) + "/verify", {
      method: "POST",
      accessToken: token,
      body: {
        challenge_id: challengeId,
        code: String(code || "").trim()
      }
    });
    if (data && data.access_token) {
      saveSession(data);
    }
    return data;
  }

  async function challengeAndVerifyTotp(factorId, code) {
    const challenge = await challengeTotp(factorId);
    return await verifyTotp(factorId, challenge.id, code);
  }

  async function unenrollFactor(factorId) {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Vui lòng đăng nhập lại.");
    return await authFetch("/factors/" + encodeURIComponent(factorId), {
      method: "DELETE",
      accessToken: token
    });
  }

  async function getVerifiedTotpFactors() {
    const user = await getUser();
    const factors = Array.isArray(user && user.factors) ? user.factors : [];
    return factors.filter(f => f && f.factor_type === "totp" && f.status === "verified");
  }

  async function verifyRecoveryCode(code) {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Vui lòng đăng nhập lại.");
    const data = await authFetch("/recovery-verify", {
      method: "POST",
      accessToken: token,
      body: { code: String(code || "").trim() }
    });
    if (data && data.access_token) {
      saveSession(data);
    }
    return data;
  }

  async function regenerateRecoveryCodes() {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Vui lòng đăng nhập lại.");
    return await authFetch("/recovery-codes", {
      method: "POST",
      accessToken: token,
      body: {}
    });
  }

  async function exchangeAuthCode(code) {
    if (typeof window === "undefined" || !code) return null;
    const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY) || "";
    window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    if (!verifier) {
      return {
        type: "error",
        message: "Liên kết xác thực cần mở trên cùng trình duyệt đã yêu cầu hoặc đã hết hạn."
      };
    }
    try {
      const data = await authFetch("/token?grant_type=pkce", {
        method: "POST",
        body: { auth_code: code, code_verifier: verifier }
      });
      saveSession(data, false);
      return { type: "pkce" };
    } catch (error) {
      return {
        type: "error",
        message: error instanceof Error ? error.message : "Không thể hoàn tất xác thực PKCE."
      };
    }
  }

  async function handleAuthRedirectFromUrl() {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const hashParams = new URLSearchParams(hash);
    const searchParams = new URLSearchParams(window.location.search);

    let outcome = null;

    if (hashParams.get("error_description") || hashParams.get("error") || searchParams.get("error_description")) {
      outcome = {
        type: "error",
        message: hashParams.get("error_description") || searchParams.get("error_description") || "Liên kết xác thực không hợp lệ hoặc đã hết hạn."
      };
    } else if (hashParams.get("access_token")) {
      const flowType = hashParams.get("type") || "magiclink";
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token") || "";
      const expiresIn = Number(hashParams.get("expires_in")) || 3600;
      saveSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn,
        token_type: hashParams.get("token_type") || "bearer"
      }, false);
      outcome = { type: flowType };
    } else if (searchParams.get("code")) {
      const code = searchParams.get("code");
      const flowType = searchParams.get("type");
      const pkceResult = await exchangeAuthCode(code);
      if (pkceResult && pkceResult.type === "error") {
        outcome = pkceResult;
      } else if (pkceResult) {
        outcome = { type: flowType || "signup" };
      }
    }

    if (hash || searchParams.has("error") || searchParams.has("error_description") || searchParams.has("code") || searchParams.has("type")) {
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("error");
      cleanParams.delete("error_description");
      cleanParams.delete("code");
      cleanParams.delete("type");
      const query = cleanParams.toString();
      const cleanUrl = window.location.pathname + (query ? "?" + query : "");
      window.history.replaceState({}, document.title, cleanUrl);
    }

    return outcome;
  }

  function bindMobileNavbarToggle() {
    if (typeof document === "undefined") return;
    const toggle = document.getElementById("menuToggle");
    const navbar = document.getElementById("navbar");
    if (!toggle || !navbar) return;

    toggle.addEventListener("click", () => navbar.classList.toggle("show"));
    navbar.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => navbar.classList.remove("show"));
    });
  }

  async function apiRequest(functionName, { method = "GET", body, authRequired = false } = {}) {
    if (!isConfigured()) {
      await initBackendMode();
    }
    const mode = getBackendMode();
    if (mode === "unconfigured") {
      const err = new Error("Website chưa được cấu hình kết nối Supabase. Vui lòng cấu hình trong assets/js/config.js hoặc chạy máy chủ bảo mật cục bộ.");
      err.code = "BACKEND_NOT_CONFIGURED";
      throw err;
    }

    const userToken = await getValidAccessToken();
    if (authRequired && !userToken) {
      const err = new Error("Vui lòng đăng nhập để tiếp tục.");
      err.status = 401;
      err.code = "AUTH_REQUIRED";
      throw err;
    }

    const apiKey = mode === "local-secure" ? "local-secure-anon" : getAnonKey();
    const url = mode === "local-secure"
      ? "/api/functions/" + functionName
      : getSupabaseUrl() + "/functions/v1/" + functionName;

    const headers = {
      "Content-Type": "application/json",
      "apikey": apiKey,
      "Authorization": "Bearer " + (userToken || apiKey)
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(result.error || "Không thể kết nối máy chủ. Vui lòng thử lại sau.");
      err.status = response.status;
      err.code = result.code || "API_ERROR";
      throw err;
    }
    return result;
  }

  async function downloadAdminBackup(filename) {
    if (!isConfigured()) {
      await initBackendMode();
    }
    if (getBackendMode() !== "local-secure") {
      throw new Error("Tải bản sao lưu từ máy chủ chỉ hỗ trợ ở chế độ Local HTTPS.");
    }
    const userToken = await getValidAccessToken();
    if (!userToken) {
      throw new Error("Vui lòng đăng nhập lại.");
    }
    const response = await fetch("/api/functions/admin-backup?file=" + encodeURIComponent(filename), {
      method: "GET",
      headers: {
        "apikey": "local-secure-anon",
        "Authorization": "Bearer " + userToken
      }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Không tải được tệp sao lưu.");
    }
    const blob = await response.blob();
    return {
      blob,
      filename,
      sha256: response.headers.get("x-backup-sha256") || ""
    };
  }

  async function fetchCurrentAccountData() {
    const data = await apiRequest("account-api", { method: "GET", authRequired: true });
    if (data && data.profile) {
      setCachedProfile(data.profile);
    }
    return data;
  }

  function appendEl(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  async function renderHeaderAuthState(containerId) {
    if (typeof document === "undefined") return;
    const container = document.getElementById(containerId);
    if (!container) return;

    await initBackendMode();
    const session = getSession();
    if (!isConfigured() || !session) {
      container.replaceChildren();
      const loginLink = appendEl(container, "a", "auth-pill-btn", "Đăng nhập");
      loginLink.href = "login.html";
      return;
    }

    let profile = getCachedProfile();
    if (!profile) {
      try {
        const accountData = await fetchCurrentAccountData();
        profile = accountData.profile;
      } catch {
        // Keep fallback UI if offline or expired
      }
    }

    container.replaceChildren();

    if (profile && (profile.role === "admin" || profile.role === "manager" || profile.role === "staff")) {
      const workspaceHref = window.RangMayAuth.getHomePageForRole(profile.role);
      const workspaceLabel = window.RangMayAuth.getWorkspaceLabelForRole(profile.role);
      const workspaceLink = appendEl(container, "a", "auth-pill-btn admin", workspaceLabel);
      workspaceLink.href = workspaceHref;
    }

    const accountLink = appendEl(container, "a", "auth-pill-btn secondary", "Tài khoản");
    accountLink.href = "account.html";

    const logoutBtn = appendEl(container, "button", "auth-pill-btn ghost", "Đăng xuất");
    logoutBtn.type = "button";
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      await signOut("local");
      window.location.href = "index.html";
    });
  }

  function startIdleSessionGuard(minutes, onTimeout) {
    if (typeof window === "undefined" || typeof onTimeout !== "function") {
      return function noop() {};
    }
    const timeoutMs = Math.max(1, Number(minutes) || 30) * 60 * 1000;
    let timerId = null;

    function resetTimer() {
      if (timerId !== null) window.clearTimeout(timerId);
      timerId = window.setTimeout(onTimeout, timeoutMs);
    }

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach(evt => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return function stopGuard() {
      if (timerId !== null) window.clearTimeout(timerId);
      events.forEach(evt => window.removeEventListener(evt, resetTimer));
    };
  }

  const api = {
    isConfigured,
    getBackendMode,
    getLocalServerInfo,
    initBackendMode,
    evaluatePasswordStrength,
    getSafeRedirect,
    normalizeTotpQrDataUrl,
    decodeJwtPayload,
    getSessionAal,
    getSession,
    saveSession,
    clearSession,
    getCachedProfile,
    setCachedProfile,
    signUp,
    signInWithPassword,
    refreshSession,
    getValidAccessToken,
    getUser,
    updatePassword,
    sendPasswordReset,
    signOut,
    enrollTotp,
    challengeTotp,
    verifyTotp,
    challengeAndVerifyTotp,
    unenrollFactor,
    getVerifiedTotpFactors,
    verifyRecoveryCode,
    regenerateRecoveryCodes,
    exchangeAuthCode,
    handleAuthRedirectFromUrl,
    bindMobileNavbarToggle,
    apiRequest,
    downloadAdminBackup,
    fetchCurrentAccountData,
    renderHeaderAuthState,
    startIdleSessionGuard,
    getHomePageForRole(role) {
      if (role === "admin") return "admin.html";
      if (role === "manager") return "manager.html";
      if (role === "staff") return "staff.html";
      return "account.html";
    },
    getWorkspaceLabelForRole(role) {
      if (role === "admin") return "Chủ cửa hàng";
      if (role === "manager") return "Quản lý cửa hàng";
      if (role === "staff") return "Bàn nhân viên";
      return "Tài khoản";
    }
  };

  if (typeof root !== "undefined") {
    root.RangMayAuth = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
