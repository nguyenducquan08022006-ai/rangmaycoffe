(function initRangMayConfig(globalScope) {
  "use strict";

  // Cấu hình kết nối công khai Supabase Cloud (publishable key).
  // TUYỆT ĐỐI KHÔNG điền service_role / secret key vào file frontend này.
  const config = Object.freeze({
    supabaseUrl: "https://wwrosngjthxwnyenksvc.supabase.co",
    supabaseAnonKey: "sb_publishable_YSAWD1qVkdRrdq8H-swjpg_jlfulBC0",
    turnstileSiteKey: "",
    adminIdleTimeoutMinutes: 30
  });

  globalScope.RANG_MAY_CONFIG = config;
  globalScope.isRangMayBackendConfigured = function isRangMayBackendConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey);
  };
})(typeof window !== "undefined" ? window : globalThis);
