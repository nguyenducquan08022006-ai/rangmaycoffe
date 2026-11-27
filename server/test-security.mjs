import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createSecureServer } from "./secure-server.mjs";
import {
  buildOtpAuthUri,
  generateBase32Secret,
  generateTotpCode,
  verifyTotpCode
} from "./totp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function requestHttpRaw({ port, path: reqPath, method = "GET", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: reqPath, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function createHttpsClient(caCertPem, port) {
  const agent = new https.Agent({ ca: caCertPem });

  return function requestHttps({
    path: reqPath,
    method = "GET",
    headers = {},
    json,
    rawBody,
    hostHeader = `localhost:${port}`
  }) {
    return new Promise((resolve, reject) => {
      const reqHeaders = { Host: hostHeader, ...headers };
      let payload = rawBody;
      if (json !== undefined) {
        payload = JSON.stringify(json);
        reqHeaders["Content-Type"] = reqHeaders["Content-Type"] || "application/json";
        reqHeaders["Content-Length"] = Buffer.byteLength(payload, "utf8");
      } else if (typeof payload === "string") {
        reqHeaders["Content-Length"] = Buffer.byteLength(payload, "utf8");
      }

      const req = https.request(
        {
          hostname: "localhost",
          port,
          path: reqPath,
          method,
          headers: reqHeaders,
          agent
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let data = null;
            try {
              data = JSON.parse(text);
            } catch {
              data = null;
            }
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              text,
              data
            });
          });
        }
      );
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  };
}

function runStaticSecurityAudits() {
  const htmlFiles = ["index.html", "blog.html", "login.html", "account.html", "admin.html", "manager.html", "staff.html"];
  for (const rel of htmlFiles) {
    const html = fs.readFileSync(path.join(ROOT_DIR, rel), "utf8");
    const nonJsonLdScripts = html
      .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/gi, "")
      .match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const tag of nonJsonLdScripts) {
      assert(!/>[\s\S]*\S[\s\S]*<\/script>/i.test(tag), `${rel} contains inline script body`);
    }
    assert(!/\son[a-z]+\s*=/i.test(html), `${rel} contains inline event handler`);
    assert(!/\sstyle\s*=/i.test(html), `${rel} contains inline style attribute`);
    assert(html.includes('http-equiv="Content-Security-Policy"'), `${rel} missing CSP meta`);
    assert(!html.includes("rangmay-proxy.workers.dev"), `${rel} still references legacy worker`);
  }

  const jsFiles = [
    "assets/js/config.js",
    "assets/js/auth.js",
    "assets/js/login.js",
    "assets/js/account.js",
    "assets/js/admin.js",
    "assets/js/manager.js",
    "assets/js/staff.js",
    "assets/js/app.js"
  ];
  const dangerousSinks = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function("];
  for (const rel of jsFiles) {
    const src = fs.readFileSync(path.join(ROOT_DIR, rel), "utf8");
    const codeWithoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const sink of dangerousSinks) {
      assert(!src.includes(sink), `${rel} contains forbidden DOM/eval sink: ${sink}`);
    }
    assert(!codeWithoutComments.includes("service_role"), `${rel} contains service_role outside comments`);
    assert(!/sb_secret_[a-zA-Z0-9_-]+/.test(src), `${rel} contains Supabase secret key`);
    assert(!/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/.test(src), `${rel} contains hardcoded JWT`);
  }

  const headersFile = fs.readFileSync(path.join(ROOT_DIR, "_headers"), "utf8");
  assert(headersFile.includes("Strict-Transport-Security"), "_headers missing HSTS");
  assert(headersFile.includes("X-Frame-Options: DENY"), "_headers missing X-Frame-Options: DENY");
  assert(headersFile.includes("/manager.html"), "_headers missing /manager.html no-store rules");
  assert(headersFile.includes("/staff.html"), "_headers missing /staff.html no-store rules");

  const sql2 = fs.readFileSync(
    path.join(ROOT_DIR, "supabase/migrations/20261124000000_harden_rls_functions_and_indexes.sql"),
    "utf8"
  );
  assert(sql2.includes("set search_path = ''"), "hardening migration missing empty search_path");
  assert(sql2.includes("(select auth.uid())"), "hardening migration missing cached auth.uid()");

  const sql3 = fs.readFileSync(
    path.join(ROOT_DIR, "supabase/migrations/20261124010000_add_security_checklist_and_backups.sql"),
    "utf8"
  );
  assert(sql3.includes("security_checklists") && sql3.includes("backup_snapshots"), "checklist/backup migration incomplete");
  assert(sql3.includes("enable row level security"), "checklist/backup migration missing RLS");

  const sql4 = fs.readFileSync(
    path.join(ROOT_DIR, "supabase/migrations/20261124020000_add_manager_role_and_security_policies.sql"),
    "utf8"
  );
  assert(sql4.includes("'manager'") && sql4.includes("security_policies"), "manager/policy migration incomplete");
  assert(sql4.includes("enable row level security"), "manager/policy migration missing RLS");

  const sql5 = fs.readFileSync(
    path.join(ROOT_DIR, "supabase/migrations/20261125000000_add_store_products_catalog.sql"),
    "utf8"
  );
  assert(sql5.includes("store_products") && sql5.includes("enable row level security"), "catalog migration incomplete");

  const sql6 = fs.readFileSync(
    path.join(ROOT_DIR, "supabase/migrations/20261126000000_add_store_vouchers.sql"),
    "utf8"
  );
  assert(sql6.includes("store_vouchers") && sql6.includes("enable row level security"), "vouchers migration incomplete");

  const sql7 = fs.readFileSync(
    path.join(ROOT_DIR, "supabase/migrations/20261126010000_add_price_edit_permission.sql"),
    "utf8"
  );
  assert(sql7.includes("can_edit_price") && sql7.includes("prevent_profile_privilege_escalation"), "price permission migration incomplete");
}

function runClientUnitTests() {
  const RangMayAuth = require(path.join(ROOT_DIR, "assets/js/auth.js"));
  assert.equal(RangMayAuth.evaluatePasswordStrength("123456", "a@b.com").valid, false);
  assert.equal(RangMayAuth.evaluatePasswordStrength("Abcdef12!@", "abcdef@x.com").valid, false);
  assert.equal(RangMayAuth.evaluatePasswordStrength("RangMay@2026!", "u@x.com").valid, false);
  assert.equal(RangMayAuth.evaluatePasswordStrength("C0ffeeStrong#2026!", "khach@x.com").valid, true);
  assert.equal(RangMayAuth.evaluatePasswordStrength("Short!1234A", "staff@x.com", { minLength: 14 }).valid, false);
  assert.equal(RangMayAuth.evaluatePasswordStrength("VeryStr0ng#Pass26!", "staff@x.com", { minLength: 14 }).valid, true);

  assert.equal(RangMayAuth.getSafeRedirect("https://evil.example"), "account.html");
  assert.equal(RangMayAuth.getSafeRedirect("//evil.example"), "account.html");
  assert.equal(RangMayAuth.getSafeRedirect("admin.html"), "admin.html");
  assert.equal(RangMayAuth.getSafeRedirect("manager.html"), "manager.html");
  assert.equal(RangMayAuth.getSafeRedirect("staff.html"), "staff.html");
  assert.equal(RangMayAuth.getHomePageForRole("admin"), "admin.html");
  assert.equal(RangMayAuth.getHomePageForRole("manager"), "manager.html");
  assert.equal(RangMayAuth.getHomePageForRole("staff"), "staff.html");
  assert.equal(RangMayAuth.getHomePageForRole("customer"), "account.html");

  const cleanQr = RangMayAuth.normalizeTotpQrDataUrl(
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg onload="alert(1)"><script>x</script><rect/></svg>')
  );
  assert(cleanQr.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert(!decodeURIComponent(cleanQr).includes("<script"));
  assert(!decodeURIComponent(cleanQr).includes("onload"));

  const secret = generateBase32Secret();
  assert(secret.length >= 16);
  const nowMs = Date.now();
  const code = generateTotpCode(secret, nowMs);
  assert(/^\d{6}$/.test(code));
  const check1 = verifyTotpCode(secret, code, { timeMs: nowMs });
  assert.equal(check1.valid, true);
  const replay = verifyTotpCode(secret, code, { timeMs: nowMs, lastUsedStep: check1.step });
  assert.equal(replay.valid, false);
  const uri = buildOtpAuthUri({ issuer: "Rang May Coffee", accountName: "admin@rangmaycoffee.vn", secret });
  assert(uri.startsWith("otpauth://totp/"));
}

async function main() {
  console.log("[Audit] Kiểm tra CSP, DOM sinks, SQL & Unit Tests...");
  runStaticSecurityAudits();
  runClientUnitTests();
  console.log("[Audit OK] Static CSP, RLS SQL & TOTP unit tests passed.");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rangmay-sec-test-"));
  const server = createSecureServer({
    httpPort: 0,
    httpsPort: 0,
    host: "127.0.0.1",
    certsDir: path.join(tmpDir, "certs"),
    dataDir: path.join(tmpDir, "data"),
    backupsDir: path.join(tmpDir, "backups")
  });

  try {
    const { httpPort, httpsPort } = await server.start();
    const certInfo = server.getCertInfo();
    const x509 = new crypto.X509Certificate(certInfo.cert);
    assert(x509.subject.includes("CN=localhost"), "TLS certificate CN mismatch");

    const httpsReq = createHttpsClient(certInfo.cert, httpsPort);
    const sameOriginHeaders = { Origin: `https://localhost:${httpsPort}` };

    // [1/16] HTTP -> HTTPS 301 Redirect
    const redir = await requestHttpRaw({ port: httpPort, path: "/login.html?next=admin.html" });
    assert.equal(redir.status, 301);
    assert.equal(redir.headers.location, `https://localhost:${httpsPort}/login.html?next=admin.html`);
    assert(String(redir.headers["strict-transport-security"]).includes("max-age=31536000"));
    console.log("[1/20 OK] HTTP -> HTTPS 301 redirect + HSTS");

    // [2/18] HTTPS pages & strict security headers (all 6 portals/pages)
    for (const page of ["/", "/login.html", "/account.html", "/admin.html", "/manager.html", "/staff.html"]) {
      const res = await httpsReq({ path: page });
      assert.equal(res.status, 200, `Expected 200 for ${page}`);
      assert(String(res.headers["strict-transport-security"]).includes("max-age=31536000"));
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.equal(res.headers["cross-origin-opener-policy"], "same-origin");
      assert(String(res.headers["content-security-policy"]).includes("script-src 'self'"));
      if (page !== "/") {
        assert(String(res.headers["cache-control"]).includes("no-store"));
        assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
      }
    }
    console.log("[2/20 OK] All 6 HTTPS pages enforce strict CSP, HSTS, X-Frame-Options: DENY & no-store");

    // [3/16] Static allowlist blocks sensitive repo paths
    for (const blockedPath of [
      "/server/secure-server.mjs",
      "/supabase/config.toml",
      "/package.json",
      "/.git/config",
      "/SECURITY.md",
      "/assets/../package.json"
    ]) {
      const res = await httpsReq({ path: blockedPath });
      assert.equal(res.status, 403, `Expected 403 for blocked path ${blockedPath}`);
    }
    console.log("[3/20 OK] Strict static allowlist blocks internal files & traversal");

    // [4/16] CSRF Origin check, Honeypot & 16KB body limit
    const badOrigin = await httpsReq({
      path: "/api/functions/create-contact",
      method: "POST",
      headers: { Origin: "https://attacker.example" },
      json: { name: "Test", email: "a@b.com", message: "hello" }
    });
    assert.equal(badOrigin.status, 403);

    const oversized = await httpsReq({
      path: "/api/functions/create-contact",
      method: "POST",
      headers: sameOriginHeaders,
      json: { name: "Test", email: "a@b.com", message: "x".repeat(20000) }
    });
    assert.equal(oversized.status, 413);

    const botContact = await httpsReq({
      path: "/api/functions/create-contact",
      method: "POST",
      headers: sameOriginHeaders,
      json: { name: "Spam Bot", email: "bot@spam.example", message: "buy now", website: "http://spam.example" }
    });
    assert.equal(botContact.status, 400);

    const botSignup = await httpsReq({
      path: "/api/auth/signup",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "bot@spam.example", password: "BotStrong#2026!", data: { full_name: "Bot" }, website: "spam" }
    });
    assert.equal(botSignup.status, 400);
    console.log("[4/20 OK] Cross-origin blocked (403), oversized body (413) & honeypot spam rejected (400)");

    // [5/16] Strong password policy & anti-enumeration signup + scrypt hash
    const weakSignup = await httpsReq({
      path: "/api/auth/signup",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "weak@example.com", password: "password123", data: { full_name: "Test User" } }
    });
    assert.equal(weakSignup.status, 400);

    const custASignup = await httpsReq({
      path: "/api/auth/signup",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "custa@example.com", password: "M@ngDenOne2026!", data: { full_name: "Khách Hàng A" } }
    });
    assert.equal(custASignup.status, 201);

    const custBSignup = await httpsReq({
      path: "/api/auth/signup",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "custb@example.com", password: "M@ngDenTwo2026!", data: { full_name: "Khách Hàng B" } }
    });
    assert.equal(custBSignup.status, 201);

    const storeAfterSignup = JSON.parse(fs.readFileSync(server.getStorePath(), "utf8"));
    const savedCustA = storeAfterSignup.users.find((u) => u.email === "custa@example.com");
    assert(savedCustA && savedCustA.passwordHash.length === 128 && !JSON.stringify(savedCustA).includes("M@ngDenOne2026!"));
    console.log("[5/20 OK] Strong password enforced & scrypt-hashed at rest");

    // [6/16] Brute-force lockout after 5 wrong attempts + HttpOnly Strict cookie
    for (let i = 1; i <= 5; i += 1) {
      const fail = await httpsReq({
        path: "/api/auth/token?grant_type=password",
        method: "POST",
        headers: sameOriginHeaders,
        json: { email: "staff@rangmaycoffee.vn", password: "WrongPassword#999!" }
      });
      assert.equal(fail.status, 400);
    }
    const locked = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "staff@rangmaycoffee.vn", password: "RmStaff@2026#Sec!" }
    });
    assert.equal(locked.status, 429);
    assert(Number(locked.headers["retry-after"]) >= 1);
    console.log("[6/20 OK] Brute-force lockout triggers 429 + Retry-After after 5 failed logins");

    // [7/16] TOTP 2FA QR enrollment, 8 Recovery Codes, Strict AAL2 Gate, Single-Use Recovery Verify, Cookie Flags & Unenroll
    const adminLogin1 = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "admin@rangmaycoffee.vn", password: "RmAdmin@2026#Sec!" }
    });
    assert.equal(adminLogin1.status, 200);
    const loginSetCookie = String(adminLogin1.headers["set-cookie"] || "");
    assert(loginSetCookie.includes("HttpOnly") && loginSetCookie.includes("Secure") && loginSetCookie.includes("SameSite=Strict"), "Missing secure HttpOnly SameSite=Strict session cookie");
    let adminToken = adminLogin1.data.access_token;

    const enrollRes = await httpsReq({
      path: "/api/auth/factors",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { factor_type: "totp", friendly_name: "Admin Phone" }
    });
    assert.equal(enrollRes.status, 200);
    const factorId = enrollRes.data.id;
    const totpSecret = enrollRes.data.totp.secret;
    assert(String(enrollRes.data.totp.qr_code).startsWith("data:image/svg+xml;charset=utf-8,"));

    const userInfo = await httpsReq({
      path: "/api/auth/user",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(userInfo.status, 200);
    assert(!userInfo.text.includes(totpSecret), "/api/auth/user leaked TOTP secret");

    const chalRes = await httpsReq({
      path: `/api/auth/factors/${factorId}/challenge`,
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {}
    });
    assert.equal(chalRes.status, 200);

    const otp = generateTotpCode(totpSecret);
    const verifyRes = await httpsReq({
      path: `/api/auth/factors/${factorId}/verify`,
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { challenge_id: chalRes.data.id, code: otp }
    });
    assert.equal(verifyRes.status, 200);
    assert(Array.isArray(verifyRes.data.recovery_codes) && verifyRes.data.recovery_codes.length === 8, "Expected 8 recovery codes on 2FA activation");
    const firstRecoveryCode = verifyRes.data.recovery_codes[0];
    adminToken = verifyRes.data.access_token;

    // Replay same TOTP must be rejected
    const chalReplay = await httpsReq({
      path: `/api/auth/factors/${factorId}/challenge`,
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {}
    });
    const replayVerify = await httpsReq({
      path: `/api/auth/factors/${factorId}/verify`,
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { challenge_id: chalReplay.data.id, code: otp }
    });
    assert.equal(replayVerify.status, 422);

    // Fresh AAL1 login while 2FA is active MUST be blocked from admin-api with 403 MFA_REQUIRED
    const adminAal1Login = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "admin@rangmaycoffee.vn", password: "RmAdmin@2026#Sec!" }
    });
    assert.equal(adminAal1Login.status, 200);
    const aal1Token = adminAal1Login.data.access_token;
    const blockedAal1Admin = await httpsReq({
      path: "/api/functions/admin-api",
      headers: { Authorization: `Bearer ${aal1Token}` }
    });
    assert.equal(blockedAal1Admin.status, 403);
    assert.equal(blockedAal1Admin.data.code, "MFA_REQUIRED");

    // Elevate via single-use recovery code -> AAL2 succeeds!
    const recoveryElevate = await httpsReq({
      path: "/api/auth/recovery-verify",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${aal1Token}` },
      json: { code: firstRecoveryCode }
    });
    assert.equal(recoveryElevate.status, 200);
    assert.equal(recoveryElevate.data.remaining_recovery_codes, 7);
    adminToken = recoveryElevate.data.access_token;

    // Reusing consumed recovery code fails
    const recoveryReuse = await httpsReq({
      path: "/api/auth/recovery-verify",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${aal1Token}` },
      json: { code: firstRecoveryCode }
    });
    assert.equal(recoveryReuse.status, 422);

    // Regenerate recovery codes at AAL2 succeeds
    const regenCodes = await httpsReq({
      path: "/api/auth/recovery-codes",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {}
    });
    assert.equal(regenCodes.status, 200);
    assert.equal(regenCodes.data.recovery_codes.length, 8);
    console.log("[7/20 OK] TOTP 2FA QR, 8 Recovery Codes, Strict AAL2 gate & HttpOnly/Strict cookies verified");

    // [8/16] Client Price Tampering Immunity & XSS Safe Storage + Cross-Customer IDOR
    const custALogin = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "custa@example.com", password: "M@ngDenOne2026!" }
    });
    const custBLogin = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "custb@example.com", password: "M@ngDenTwo2026!" }
    });
    const custAToken = custALogin.data.access_token;
    const custBToken = custBLogin.data.access_token;

    const xssPayload = "<script>alert('xss')</script><img src=x onerror=alert(1)>";
    const orderA = await httpsReq({
      path: "/api/functions/create-order",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${custAToken}` },
      json: {
        customer: { name: "Khách A " + xssPayload, phone: "0901234567", email: "custa@example.com", address: "123 Lê Lợi, Quận 1" },
        items: [{ id: "drip-pack-001", quantity: 2, unit_price: 1, price: 0 }],
        totalAmount: 100,
        paymentMethod: "COD"
      }
    });
    assert.equal(orderA.status, 201);

    const orderB = await httpsReq({
      path: "/api/functions/create-order",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${custBToken}` },
      json: {
        customer: { name: "Khách B", phone: "0908887777", email: "custb@example.com", address: "456 Nguyễn Trãi, Q5" },
        items: [{ id: "drip-pack-001", quantity: 1 }],
        paymentMethod: "COD"
      }
    });
    assert.equal(orderB.status, 201);

    // Server must enforce real unitPrice 119000 * 2 = 238000 regardless of tampered unit_price/totalAmount
    const accA = await httpsReq({
      path: "/api/functions/account-api",
      headers: { Authorization: `Bearer ${custAToken}` }
    });
    assert.equal(accA.status, 200);
    assert.equal(accA.data.orders.length, 1);
    assert.equal(accA.data.orders[0].order_number, orderA.data.orderNumber);
    assert.equal(accA.data.orders[0].total_amount, 238000);
    assert(accA.data.orders[0].customer_name.includes(xssPayload));

    // Customer B attempting IDOR query parameter sees ONLY Customer B's order
    const accBIdor = await httpsReq({
      path: `/api/functions/account-api?user_id=${savedCustA.id}`,
      headers: { Authorization: `Bearer ${custBToken}` }
    });
    assert.equal(accBIdor.status, 200);
    assert.equal(accBIdor.data.orders.length, 1);
    assert.equal(accBIdor.data.orders[0].order_number, orderB.data.orderNumber);
    console.log("[8/20 OK] Server-side price enforcement (238000), XSS literal data & strict IDOR scoping verified");

    // [9/18] Customer blocked from all 3 internal portals (admin-api, manager-api, staff-api) with 403
    for (const internalPath of ["/api/functions/admin-api", "/api/functions/manager-api", "/api/functions/staff-api"]) {
      const custTry = await httpsReq({
        path: internalPath,
        headers: { Authorization: `Bearer ${custAToken}` }
      });
      assert.equal(custTry.status, 403, `Expected customer blocked (403) on ${internalPath}`);
    }
    console.log("[9/20 OK] Customer blocked from admin-api, manager-api & staff-api (403)");

    // [10/18] Strict 3-Portal RBAC Isolation: Staff vs Shop Manager vs Owner Admin
    const staffLogin = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: { ...sameOriginHeaders, "X-Forwarded-For": "10.10.10.2" },
      json: { email: "staff@rangmaycoffee.vn", password: "RmStaff@2026#Sec!" }
    });
    assert.equal(staffLogin.status, 200);
    const staffToken = staffLogin.data.access_token;

    // Staff MUST be denied 403 on both Owner (admin-api) and Manager (manager-api)
    assert.equal(
      (await httpsReq({ path: "/api/functions/admin-api", headers: { Authorization: `Bearer ${staffToken}` } })).status,
      403
    );
    assert.equal(
      (await httpsReq({ path: "/api/functions/manager-api", headers: { Authorization: `Bearer ${staffToken}` } })).status,
      403
    );

    // Staff gets fulfillment queue ONLY on staff-api (no revenue, no users, no audit logs)
    const staffDash = await httpsReq({
      path: "/api/functions/staff-api",
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.equal(staffDash.status, 200);
    assert.equal(staffDash.data.summary.totalRevenue, undefined);
    assert.equal(staffDash.data.users, undefined);
    assert.equal(staffDash.data.auditLogs, undefined);
    assert.equal(staffDash.data.securityCenter, undefined);

    const targetOrderId = staffDash.data.orders[0].id;
    const staffConfirm = await httpsReq({
      path: "/api/functions/staff-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${staffToken}` },
      json: { action: "update_order", orderId: targetOrderId, status: "confirmed", internalNote: "Nhân viên đóng gói" }
    });
    assert.equal(staffConfirm.status, 200);

    // Staff CANNOT cancel orders (403 FORBIDDEN_ORDER_CANCEL)
    const staffCancelTry = await httpsReq({
      path: "/api/functions/staff-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${staffToken}` },
      json: { action: "update_order", orderId: targetOrderId, status: "cancelled", internalNote: "Thử hủy" }
    });
    assert.equal(staffCancelTry.status, 403);
    assert.equal(staffCancelTry.data.code, "FORBIDDEN_ORDER_CANCEL");

    const managerLogin = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: { ...sameOriginHeaders, "X-Forwarded-For": "10.10.10.3" },
      json: { email: "manager@rangmaycoffee.vn", password: "RmManager@2026#Sec!" }
    });
    assert.equal(managerLogin.status, 200);
    const managerToken = managerLogin.data.access_token;

    // Manager MUST be denied 403 on Owner admin-api
    assert.equal(
      (await httpsReq({ path: "/api/functions/admin-api", headers: { Authorization: `Bearer ${managerToken}` } })).status,
      403
    );

    const managerDash = await httpsReq({
      path: "/api/functions/manager-api",
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    assert.equal(managerDash.status, 200);
    assert.equal(managerDash.data.actor.role, "manager");
    assert(typeof managerDash.data.summary.totalRevenue === "number");
    assert(Array.isArray(managerDash.data.catalog));
    assert(Array.isArray(managerDash.data.staffRoster));
    assert.equal(managerDash.data.users, undefined);
    assert.equal(managerDash.data.securityCenter, undefined);

    const managerOrderUpdate = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: { action: "update_order", orderId: targetOrderId, status: "shipped", internalNote: "Quản lý duyệt giao" }
    });
    assert.equal(managerOrderUpdate.status, 200);

    for (const forbiddenBody of [
      { action: "update_user", userId: savedCustA.id, role: "admin", isActive: true },
      { action: "create_user", fullName: "Hack", email: "h@x.com", role: "admin", password: "StrongPassword#2026!" },
      { action: "save_checklist", checkedIds: ["daily_uptime"] },
      { action: "create_backup" },
      { action: "restore_drill", filename: "rangmay-backup-20260101-000000.enc.json" }
    ]) {
      const denied = await httpsReq({
        path: "/api/functions/manager-api",
        method: "PATCH",
        headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
        json: forbiddenBody
      });
      assert.equal(denied.status, 403);
    }
    console.log("[10/20 OK] Strict 3-portal isolation (admin-api / manager-api / staff-api) & staff cancel guard verified");

    // [11/18] Admin Onboarding (>=14 chars for staff), Security Policy AAL2, Lockout Unlock & 12-item Checklist
    const shortStaffCreate = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "create_user", fullName: "Nhân Viên Mới", email: "newstaff@rangmaycoffee.vn", role: "staff", password: "ShortPass#1" }
    });
    assert.equal(shortStaffCreate.status, 400);

    const validStaffCreate = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "create_user", fullName: "Nhân Viên Mới", email: "newstaff@rangmaycoffee.vn", role: "staff", password: "VungCao#Oper2026!" }
    });
    assert.equal(validStaffCreate.status, 201);

    // Enable system-wide Require Admin MFA while admin is at AAL2 -> staff & manager WITHOUT 2FA blocked on their own portals!
    const policyOn = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "update_security_policy", requireAdminMfa: true }
    });
    assert.equal(policyOn.status, 200);

    const blockedStaffNo2fa = await httpsReq({
      path: "/api/functions/staff-api",
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.equal(blockedStaffNo2fa.status, 403);
    assert.equal(blockedStaffNo2fa.data.code, "MFA_REQUIRED");

    const blockedManagerNo2fa = await httpsReq({
      path: "/api/functions/manager-api",
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    assert.equal(blockedManagerNo2fa.status, 403);
    assert.equal(blockedManagerNo2fa.data.code, "MFA_REQUIRED");

    const policyOff = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "update_security_policy", requireAdminMfa: false }
    });
    assert.equal(policyOff.status, 200);

    // Unlock brute-force lockouts so staff@rangmaycoffee.vn can log in again on primary IP
    const unlockRes = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "unlock_lockouts" }
    });
    assert.equal(unlockRes.status, 200);
    assert(unlockRes.data.clearedCount >= 1);

    const staffRelogin = await httpsReq({
      path: "/api/auth/token?grant_type=password",
      method: "POST",
      headers: sameOriginHeaders,
      json: { email: "staff@rangmaycoffee.vn", password: "RmStaff@2026#Sec!" }
    });
    assert.equal(staffRelogin.status, 200);

    const adminDash = await httpsReq({
      path: "/api/functions/admin-api",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminDash.status, 200);
    assert.equal(adminDash.data.securityCenter.checklist.items.length, 12);

    const saveChecklist = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {
        action: "save_checklist",
        checkedIds: ["daily_uptime", "daily_orders", "monthly_ssl", "quarterly_restore", "quarterly_dns"]
      }
    });
    assert.equal(saveChecklist.status, 200);
    assert.equal(saveChecklist.data.checklist.checkedIds.length, 5);
    console.log("[11/20 OK] Admin Onboarding (>=14 chars), AAL2 global policy, brute-force unlock & 12-item checklist verified");

    // [12/16] AES-256-GCM Encrypted Backup on Disk + SHA-256 + Download & Traversal Guard
    const createBackup = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "create_backup" }
    });
    assert.equal(createBackup.status, 200);
    const snap = createBackup.data.snapshot;
    assert(/^rangmay-backup-\d{8}-\d{6}\.enc\.json$/.test(snap.filename));
    assert.equal(snap.is_encrypted, true);
    assert.equal(snap.encryption_alg, "AES-256-GCM");

    const diskBackupPath = path.join(server.getBackupsDir(), snap.filename);
    const diskContent = fs.readFileSync(diskBackupPath, "utf8");
    const computedHash = crypto.createHash("sha256").update(diskContent, "utf8").digest("hex");
    assert.equal(snap.checksum_sha256, computedHash);
    // Ensure PII & secrets are encrypted (NOT readable plaintext on disk)
    assert(!diskContent.includes("0901234567"), "Encrypted backup leaked plaintext phone on disk");
    assert(!diskContent.includes("0908887777"), "Encrypted backup leaked customer B phone on disk");
    assert(!diskContent.includes("passwordHash") && !diskContent.includes("jwtSecret"), "Backup contained secret fields");

    const dlBackup = await httpsReq({
      path: `/api/functions/admin-backup?file=${encodeURIComponent(snap.filename)}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(dlBackup.status, 200);
    assert.equal(dlBackup.headers["x-backup-sha256"], computedHash);

    const traversalBackup = await httpsReq({
      path: "/api/functions/admin-backup?file=../../secrets.json",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(traversalBackup.status, 400);
    console.log("[12/20 OK] AES-256-GCM Encrypted Backup protects PII at rest + SHA-256 download guard verified");

    // [13/16] Restore Drill (RTO + Checksum + Decryption Validation)
    const drillRes = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "restore_drill", filename: snap.filename }
    });
    assert.equal(drillRes.status, 200);
    assert.equal(drillRes.data.ok, true);
    assert.equal(drillRes.data.checksumValid, true);
    assert.equal(drillRes.data.decrypted, true);
    assert(drillRes.data.rtoMs >= 1);
    console.log(`[13/20 OK] Restore Drill verified (RTO=${drillRes.data.rtoMs}ms, decrypted AES-256-GCM, SHA-256 intact)`);

    // [14/16] Full Restore (creates pre-restore safety snapshot + reverts mutated checklist/order)
    const mutateChecklist = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "save_checklist", checkedIds: ["daily_uptime"] }
    });
    assert.equal(mutateChecklist.status, 200);

    const fullRestore = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "restore_backup", filename: snap.filename }
    });
    assert.equal(fullRestore.status, 200);
    assert(fullRestore.data.safetySnapshot && fullRestore.data.safetySnapshot.filename !== snap.filename);

    const dashAfterRestore = await httpsReq({
      path: "/api/functions/admin-api",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(dashAfterRestore.status, 200);
    assert.equal(dashAfterRestore.data.securityCenter.checklist.checkedIds.length, 5);
    console.log("[14/20 OK] Full Restore from AES-256-GCM backup + pre-restore safety snapshot verified");

    // [15/20] Granular Price-Edit Permission (`can_edit_price`), Catalog Sync, Stock Deduction & Cancel Restore
    const catalogInit = await httpsReq({ path: "/api/functions/store-catalog" });
    assert.equal(catalogInit.status, 200);
    assert.equal(catalogInit.data.products[0].stock_quantity, 47);

    // By default, Manager has canEditPrice=false: updating stock succeeds, changing price is blocked (403 FORBIDDEN_PRICE_EDIT)
    const managerStockOnly = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: {
        action: "update_product",
        productId: "drip-pack-001",
        price: 119000,
        stockQuantity: 4,
        isAvailable: true,
        badgeText: "Cập nhật kho bởi Quản lý"
      }
    });
    assert.equal(managerStockOnly.status, 200);
    assert.equal(managerStockOnly.data.product.stock_quantity, 4);

    const managerBlockedPriceEdit = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: {
        action: "update_product",
        productId: "drip-pack-001",
        price: 135000,
        stockQuantity: 3,
        isAvailable: true,
        badgeText: "Đợt rang mới Măng Đen"
      }
    });
    assert.equal(managerBlockedPriceEdit.status, 403);
    assert.equal(managerBlockedPriceEdit.data.code, "FORBIDDEN_PRICE_EDIT");

    // Store Owner (`admin`) grants `canEditPrice: true` to Manager -> Manager can now edit price!
    const grantPricePerm = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {
        action: "update_user",
        userId: managerLogin.data.user.id,
        role: "manager",
        isActive: true,
        canEditPrice: true
      }
    });
    assert.equal(grantPricePerm.status, 200);
    assert.equal(grantPricePerm.data.user.can_edit_price, true);

    const managerCatalogEdit = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: {
        action: "update_product",
        productId: "drip-pack-001",
        price: 135000,
        stockQuantity: 3,
        isAvailable: true,
        badgeText: "Đợt rang mới Măng Đen"
      }
    });
    assert.equal(managerCatalogEdit.status, 200);
    assert.equal(managerCatalogEdit.data.product.price, 135000);
    assert.equal(managerCatalogEdit.data.product.stock_quantity, 3);

    const catalogAfterEdit = await httpsReq({ path: "/api/functions/store-catalog" });
    assert.equal(catalogAfterEdit.status, 200);
    assert.equal(catalogAfterEdit.data.products[0].price, 135000);
    assert.equal(catalogAfterEdit.data.products[0].badge_text, "Đợt rang mới Măng Đen");

    // Order exceeding live stock (5 > 3) MUST fail
    const overStockOrder = await httpsReq({
      path: "/api/functions/create-order",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${custBToken}` },
      json: {
        customer: { name: "Khách B", phone: "0908887777", address: "456 Nguyễn Trãi, Q5" },
        items: [{ id: "drip-pack-001", quantity: 5 }],
        paymentMethod: "COD"
      }
    });
    assert.equal(overStockOrder.status, 400);

    // Order within stock (2 <= 3) charges live unitPrice 135000 * 2 = 270000 and deducts stock -> 1
    const livePriceOrder = await httpsReq({
      path: "/api/functions/create-order",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${custBToken}` },
      json: {
        customer: { name: "Khách B", phone: "0908887777", address: "456 Nguyễn Trãi, Q5" },
        items: [{ id: "drip-pack-001", quantity: 2 }],
        totalAmount: 100,
        paymentMethod: "COD"
      }
    });
    assert.equal(livePriceOrder.status, 201);

    const catalogAfterOrder = await httpsReq({ path: "/api/functions/store-catalog" });
    assert.equal(catalogAfterOrder.data.products[0].stock_quantity, 1);

    const custBCheck = await httpsReq({
      path: "/api/functions/account-api",
      headers: { Authorization: `Bearer ${custBToken}` }
    });
    const newestBOrder = custBCheck.data.orders.find((o) => o.order_number === livePriceOrder.data.orderNumber);
    assert(newestBOrder);
    assert.equal(newestBOrder.total_amount, 270000);

    // Manager cancels that 2-box order -> stock automatically restores 1 + 2 = 3
    const managerCancel = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: { action: "update_order", orderId: newestBOrder.id, status: "cancelled", internalNote: "Khách đổi lịch" }
    });
    assert.equal(managerCancel.status, 200);
    const catalogRestored = await httpsReq({ path: "/api/functions/store-catalog" });
    assert.equal(catalogRestored.data.products[0].stock_quantity, 3);

    // Staff CANNOT reopen a cancelled order
    const staffReopenTry = await httpsReq({
      path: "/api/functions/staff-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${staffRelogin.data.access_token}` },
      json: { action: "update_order", orderId: newestBOrder.id, status: "confirmed", internalNote: "Thử mở lại" }
    });
    assert.equal(staffReopenTry.status, 403);
    assert.equal(staffReopenTry.data.code, "FORBIDDEN_ORDER_CANCEL");
    console.log("[15/20 OK] Live store-catalog sync, stock deduction, cancel stock restore & staff cancelled-order guard verified");

    // [16/19] Owner (admin) supervises all 3 portals
    assert.equal((await httpsReq({ path: "/api/functions/admin-api", headers: { Authorization: `Bearer ${adminToken}` } })).status, 200);
    assert.equal((await httpsReq({ path: "/api/functions/manager-api", headers: { Authorization: `Bearer ${adminToken}` } })).status, 200);
    assert.equal((await httpsReq({ path: "/api/functions/staff-api", headers: { Authorization: `Bearer ${adminToken}` } })).status, 200);
    console.log("[16/20 OK] Owner (admin) cross-portal supervision verified");

    // [17/19] Voucher System: Validation, Manager CRUD, Server-Side Discount Enforcement & Cancel Usage Restore
    await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: {
        action: "update_product",
        productId: "drip-pack-001",
        price: 119000,
        stockQuantity: 20,
        isAvailable: true,
        badgeText: "Phin giấy tiện lợi, minh bạch lô sản xuất"
      }
    });

    const catWithVouchers = await httpsReq({ path: "/api/functions/store-catalog" });
    assert.equal(catWithVouchers.status, 200);
    assert(Array.isArray(catWithVouchers.data.vouchers) && catWithVouchers.data.vouchers.some((v) => v.code === "RANGMAY10"));

    const validPctCheck = await httpsReq({
      path: "/api/functions/validate-voucher",
      method: "POST",
      headers: sameOriginHeaders,
      json: { code: "rangmay10", subtotal: 238000 }
    });
    assert.equal(validPctCheck.status, 200);
    assert.equal(validPctCheck.data.discountAmount, 23800);
    assert.equal(validPctCheck.data.finalTotal, 214200);

    const minOrderFail = await httpsReq({
      path: "/api/functions/validate-voucher",
      method: "POST",
      headers: sameOriginHeaders,
      json: { code: "VIP50K", subtotal: 119000 }
    });
    assert.equal(minOrderFail.status, 400);

    const unknownVoucher = await httpsReq({
      path: "/api/functions/validate-voucher",
      method: "POST",
      headers: sameOriginHeaders,
      json: { code: "KHONGTONTAI", subtotal: 238000 }
    });
    assert.equal(unknownVoucher.status, 404);

    // Staff & Customer CANNOT manage vouchers
    for (const badToken of [staffRelogin.data.access_token, custBToken]) {
      const unauthVoucher = await httpsReq({
        path: "/api/functions/manager-api",
        method: "PATCH",
        headers: { ...sameOriginHeaders, Authorization: `Bearer ${badToken}` },
        json: { action: "upsert_voucher", code: "HACK99", discountType: "percent", discountValue: 90, minOrderAmount: 0, usageLimit: 10, isActive: true }
      });
      assert.equal(unauthVoucher.status, 403);
    }

    // Manager creates custom voucher TET30K
    const createVoucher = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: {
        action: "upsert_voucher",
        code: "tet30k",
        discountType: "fixed",
        discountValue: 30000,
        minOrderAmount: 100000,
        usageLimit: 2,
        description: "Ưu đãi Tết Măng Đen",
        isActive: true
      }
    });
    assert.equal(createVoucher.status, 201);
    assert.equal(createVoucher.data.voucher.code, "TET30K");

    // Customer B applies TET30K while tampering discountAmount/totalAmount -> Server enforces 119000 - 30000 = 89000
    const voucherOrder = await httpsReq({
      path: "/api/functions/create-order",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${custBToken}` },
      json: {
        customer: { name: "Khách B", phone: "0908887777", address: "456 Nguyễn Trãi, Q5" },
        items: [{ id: "drip-pack-001", quantity: 1 }],
        voucherCode: "tet30k",
        discountAmount: 118000,
        totalAmount: 1000,
        paymentMethod: "COD"
      }
    });
    assert.equal(voucherOrder.status, 201);
    assert.equal(voucherOrder.data.voucherCode, "TET30K");
    assert.equal(voucherOrder.data.subtotalAmount, 119000);
    assert.equal(voucherOrder.data.discountAmount, 30000);
    assert.equal(voucherOrder.data.totalAmount, 89000);

    const mgrAfterVoucherOrder = await httpsReq({
      path: "/api/functions/manager-api",
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    const tetRow = mgrAfterVoucherOrder.data.vouchers.find((v) => v.code === "TET30K");
    assert.equal(tetRow.used_count, 1);

    const vOrderRecord = mgrAfterVoucherOrder.data.orders.find((o) => o.order_number === voucherOrder.data.orderNumber);
    assert.equal(vOrderRecord.total_amount, 89000);
    assert.equal(vOrderRecord.discount_amount, 30000);

    // Manager cancels that order -> voucher used_count restores 1 -> 0
    const cancelVoucherOrder = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: { action: "update_order", orderId: vOrderRecord.id, status: "cancelled", internalNote: "Hủy hoàn mã" }
    });
    assert.equal(cancelVoucherOrder.status, 200);

    const mgrAfterCancel = await httpsReq({
      path: "/api/functions/manager-api",
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    assert.equal(mgrAfterCancel.data.vouchers.find((v) => v.code === "TET30K").used_count, 0);

    // Manager disables TET30K -> checkout & validate-voucher reject it
    const disableTet = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: { action: "toggle_voucher", code: "TET30K", isActive: false }
    });
    assert.equal(disableTet.status, 200);
    assert.equal(
      (await httpsReq({ path: "/api/functions/validate-voucher", method: "POST", headers: sameOriginHeaders, json: { code: "TET30K", subtotal: 119000 } })).status,
      400
    );

    const delTet = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: { action: "delete_voucher", code: "TET30K" }
    });
    assert.equal(delTet.status, 200);
    console.log("[17/20 OK] Voucher validation, Manager CRUD, server discount enforcement (89000) & cancel restore verified");

    // [18/20] Owner Revokes Price-Edit Permission & Edits Price Directly via admin-api
    const revokePricePerm = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {
        action: "update_user",
        userId: managerLogin.data.user.id,
        role: "manager",
        isActive: true,
        canEditPrice: false
      }
    });
    assert.equal(revokePricePerm.status, 200);
    assert.equal(revokePricePerm.data.user.can_edit_price, false);

    const managerBlockedAgain = await httpsReq({
      path: "/api/functions/manager-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${managerToken}` },
      json: {
        action: "update_product",
        productId: "drip-pack-001",
        price: 150000,
        stockQuantity: 20,
        isAvailable: true,
        badgeText: "Thử đổi giá khi đã thu hồi"
      }
    });
    assert.equal(managerBlockedAgain.status, 403);
    assert.equal(managerBlockedAgain.data.code, "FORBIDDEN_PRICE_EDIT");

    const ownerDirectPriceEdit = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {
        action: "update_product",
        productId: "drip-pack-001",
        price: 125000,
        stockQuantity: 25,
        isAvailable: true,
        badgeText: "Định giá trực tiếp bởi Chủ cửa hàng"
      }
    });
    assert.equal(ownerDirectPriceEdit.status, 200);
    assert.equal(ownerDirectPriceEdit.data.product.price, 125000);
    console.log("[18/20 OK] Owner direct price control & dynamic grant/revoke of Manager price permission verified");

    // [19/20] Offboarding: Force session revocation (`revoke_user_sessions`) & immediate lock revocation
    const revokeRes = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "revoke_user_sessions", userId: staffRelogin.data.user.id }
    });
    assert.equal(revokeRes.status, 200);
    assert(revokeRes.data.count >= 1);

    const revokedStaffTry = await httpsReq({
      path: "/api/functions/staff-api",
      headers: { Authorization: `Bearer ${staffRelogin.data.access_token}` }
    });
    assert.equal(revokedStaffTry.status, 401);

    const lockCustA = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "update_user", userId: savedCustA.id, role: "customer", isActive: false }
    });
    assert.equal(lockCustA.status, 200);

    const lockedCustATry = await httpsReq({
      path: "/api/functions/account-api",
      headers: { Authorization: `Bearer ${custAToken}` }
    });
    assert(lockedCustATry.status === 401 || lockedCustATry.status === 403);
    console.log("[19/20 OK] Offboarding force-revoke & immediate account lock verified");

    // [20/20] Self-lock/demote guards, unenroll 2FA & Global Logout cookie clear
    const selfDemote = await httpsReq({
      path: "/api/functions/admin-api",
      method: "PATCH",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: { action: "update_user", userId: adminLogin1.data.user.id, role: "customer", isActive: true }
    });
    assert.equal(selfDemote.status, 400);

    const unenrollRes = await httpsReq({
      path: `/api/auth/factors/${factorId}`,
      method: "DELETE",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(unenrollRes.status, 200);

    const adminLogout = await httpsReq({
      path: "/api/auth/logout?scope=global",
      method: "POST",
      headers: { ...sameOriginHeaders, Authorization: `Bearer ${adminToken}` },
      json: {}
    });
    assert.equal(adminLogout.status, 200);
    assert(String(adminLogout.headers["set-cookie"] || "").includes("Max-Age=0"));
    const postLogoutTry = await httpsReq({
      path: "/api/functions/admin-api",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(postLogoutTry.status, 401);
    console.log("[20/20 OK] Admin safety guards, 2FA unenroll & Global Logout cookie clear verified");

    // [21/21] Smart Grounded Barista AI: Real-time Price/Stock, Accent-insensitive Vouchers, Combo Math & Zero-PII Order Tracking
    const aiPriceRes = await httpsReq({
      path: "/api/functions/barista-ai",
      method: "POST",
      headers: sameOriginHeaders,
      json: { message: "gia 1 hop bao nhieu tien va con hang khong?" }
    });
    assert.equal(aiPriceRes.status, 200);
    assert(aiPriceRes.data.reply.includes("125.000đ"), "Barista AI must reflect live updated price 125.000đ");
    assert(aiPriceRes.data.reply.includes("25 hộp"), "Barista AI must reflect live stock 25 boxes");
    assert(aiPriceRes.data.actions.some((a) => a.type === "add_to_cart"));

    const aiVoucherRes = await httpsReq({
      path: "/api/functions/barista-ai",
      method: "POST",
      headers: sameOriginHeaders,
      json: {
        message: "cho minh xin ma giam gia voucher hom nay",
        history: [{ role: "user", text: "gia 1 hop bao nhieu?" }, { role: "ai", text: aiPriceRes.data.reply }]
      }
    });
    assert.equal(aiVoucherRes.status, 200);
    assert(aiVoucherRes.data.reply.includes("RANGMAY10"));
    assert(aiVoucherRes.data.reply.includes("MANGDEN20K"));
    assert(aiVoucherRes.data.actions.some((a) => a.type === "apply_voucher" && a.code === "RANGMAY10"));

    const aiComboRes = await httpsReq({
      path: "/api/functions/barista-ai",
      method: "POST",
      headers: sameOriginHeaders,
      json: { message: "mua 2 hop co uu dai gi khong?" }
    });
    assert.equal(aiComboRes.status, 200);
    assert(aiComboRes.data.reply.includes("VIP50K"));
    assert(aiComboRes.data.reply.includes("200.000đ"));

    const aiTrackRes = await httpsReq({
      path: "/api/functions/barista-ai",
      method: "POST",
      headers: sameOriginHeaders,
      json: { message: `kiem tra don ${orderA.data.orderNumber} giup minh` }
    });
    assert.equal(aiTrackRes.status, 200);
    assert(aiTrackRes.data.reply.includes(orderA.data.orderNumber));
    assert(aiTrackRes.data.reply.includes("238.000đ"));
    // Strictly verify ZERO PII leakage on unauthenticated order lookup
    assert(!aiTrackRes.data.reply.includes("0901234567"), "Order lookup must NEVER leak customer phone");
    assert(!aiTrackRes.data.reply.includes("custa@example.com"), "Order lookup must NEVER leak customer email");
    assert(!aiTrackRes.data.reply.includes("123 Lê Lợi"), "Order lookup must NEVER leak shipping address");
    assert(!aiTrackRes.data.reply.includes("Khách A"), "Order lookup must NEVER leak customer name");

    const aiGiftRes = await httpsReq({
      path: "/api/functions/barista-ai",
      method: "POST",
      headers: sameOriginHeaders,
      json: { mode: "gift_card", recipient: "Mẹ yêu", occasion: "Sinh nhật", style: "warm" }
    });
    assert.equal(aiGiftRes.status, 200);
    assert(aiGiftRes.data.giftMessage.includes("Mẹ yêu"));
    console.log("[21/21 OK] Smart Barista AI grounded price/stock/vouchers/combo & zero-PII order lookup verified");

    // [22/22] 4-Product Collection, Multi-SKU Cart Order + Voucher Enforcement & Duplicate-SKU Stock Bypass Guard
    const fullCatRes = await httpsReq({ path: "/api/functions/store-catalog" });
    assert.equal(fullCatRes.status, 200);
    assert.equal(fullCatRes.data.products.length, 4);
    assert(fullCatRes.data.products.some((p) => p.id === "drip-pack-002" && p.price === 109000));
    assert(fullCatRes.data.products.some((p) => p.id === "drip-pack-003" && p.price === 145000));
    assert(fullCatRes.data.products.some((p) => p.id === "gift-box-004" && p.price === 269000));

    // Duplicate SKU lines trying to exceed stock (15 + 15 = 30 > 25) MUST be rejected
    const dupBypassTry = await httpsReq({
      path: "/api/functions/create-order",
      method: "POST",
      headers: sameOriginHeaders,
      json: {
        customer: { name: "Khách Multi", phone: "0905556666", address: "88 Đồng Khởi, Q1" },
        items: [
          { id: "gift-box-004", quantity: 15 },
          { id: "gift-box-004", quantity: 15 }
        ],
        paymentMethod: "COD"
      }
    });
    assert.equal(dupBypassTry.status, 400);

    // Multi-SKU order: 1 × Đại Ngàn (109.000) + 1 × Sương Sớm (145.000) = 254.000 - VIP50K (50.000) = 204.000
    const multiOrderRes = await httpsReq({
      path: "/api/functions/create-order",
      method: "POST",
      headers: sameOriginHeaders,
      json: {
        customer: { name: "Khách Gu Mix", phone: "0905556666", address: "88 Đồng Khởi, Q1" },
        items: [
          { id: "drip-pack-002", quantity: 1, price: 1 },
          { id: "drip-pack-003", quantity: 1, price: 1 }
        ],
        voucherCode: "VIP50K",
        paymentMethod: "COD"
      }
    });
    assert.equal(multiOrderRes.status, 201);
    assert.equal(multiOrderRes.data.subtotalAmount, 254000);
    assert.equal(multiOrderRes.data.discountAmount, 50000);
    assert.equal(multiOrderRes.data.totalAmount, 204000);

    const catAfterMulti = await httpsReq({ path: "/api/functions/store-catalog" });
    assert.equal(catAfterMulti.data.products.find((p) => p.id === "drip-pack-002").stock_quantity, 44);
    assert.equal(catAfterMulti.data.products.find((p) => p.id === "drip-pack-003").stock_quantity, 34);

    // Barista AI recommends exact matching SKU for Sữa đá (drip-pack-002) and Gift Box (gift-box-004)
    const aiSuaDa = await httpsReq({
      path: "/api/functions/barista-ai",
      method: "POST",
      headers: sameOriginHeaders,
      json: { message: "minh thich uong ca phe sua da dam thi chon loai nao?" }
    });
    assert.equal(aiSuaDa.status, 200);
    assert(aiSuaDa.data.actions.some((a) => a.type === "add_to_cart" && a.productId === "drip-pack-002"));
    console.log("[22/22 OK] 4-Product collection, multi-SKU order + voucher math, stock-bypass guard & AI SKU recommendation verified");

    console.log("\nALL_22_ORIGINAL_WEBSITE_SECURITY_TESTS_PASSED");
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("SECURITY TEST FAILED:", err);
  process.exit(1);
});
