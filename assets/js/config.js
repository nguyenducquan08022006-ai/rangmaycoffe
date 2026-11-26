(function initRangMayConfig(globalScope) {
  "use strict";

  // Điền Project URL và Publishable/Anon Key từ Supabase Dashboard (Project Settings -> API).
  // TUYỆT ĐỐI KHÔNG điền service_role key vào file frontend này.
  const config = Object.freeze({
    supabaseUrl: "",
    supabaseAnonKey: "",
    turnstileSiteKey: "",
    adminIdleTimeoutMinutes: 30
  });

  globalScope.RANG_MAY_CONFIG = config;
  globalScope.isRangMayBackendConfigured = function isRangMayBackendConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey);
  };
})(typeof window !== "undefined" ? window : globalThis);
