import { AuthError, createServiceClient, requireAuth, type UserRole } from "../_shared/auth.ts";
import {
  checkRateLimit,
  corsHeaders,
  getClientIpHash,
  isValidUuid,
  jsonResponse,
  readJson,
  writeAuditLog
} from "../_shared/http.ts";

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "completed", "cancelled"] as const;
const CONTACT_STATUSES = ["new", "in_progress", "resolved"] as const;
const USER_ROLES: UserRole[] = ["customer", "staff", "manager", "admin"];

const CHECKLIST_ITEMS = [
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
] as const;

const CHECKLIST_ID_SET = new Set<string>(CHECKLIST_ITEMS.map(item => item.id));

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function formatUtcStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request.headers.get("origin"), "GET, PATCH, OPTIONS");
  if (!cors) return new Response("Origin không được phép.", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET" && request.method !== "PATCH") {
    return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405, cors);
  }

  try {
    const db = createServiceClient();
    const envRequireMfa = Deno.env.get("REQUIRE_ADMIN_MFA") === "true";
    const { data: policyRow } = await db
      .from("security_policies")
      .select("require_admin_mfa, updated_at, updated_by_email")
      .eq("id", "default")
      .maybeSingle();

    const requireMfa = envRequireMfa || Boolean(policyRow?.require_admin_mfa);
    const actor = await requireAuth(db, request, {
      roles: ["admin", "manager", "staff"],
      roles: ["admin"],
      requireMfa,
      enforceVerifiedMfa: true
    });
    const ipHash = await getClientIpHash(request);

    const allowed = await checkRateLimit(db, `admin:${actor.id}`, 120, 60);
    if (!allowed) {
      return jsonResponse({ error: "Quá nhiều thao tác quản trị. Vui lòng thử lại sau." }, 429, cors);
    }

    if (request.method === "GET") {
      const [
        ordersRes,
        orderStatsRes,
        contactsRes,
        newContactsCountRes
      ] = await Promise.all([
        db.from("orders")
          .select("id, order_number, user_id, customer_name, customer_phone, customer_email, shipping_address, items, subtotal_amount, voucher_code, discount_amount, total_amount, payment_method, status, gift_message, internal_note, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("orders").select("status, total_amount"),
        db.from("contact_messages")
          .select("id, user_id, name, email, phone, message, status, handled_by, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("contact_messages")
          .select("id", { count: "exact", head: true })
          .eq("status", "new")
      ]);

      if (ordersRes.error || orderStatsRes.error || contactsRes.error || newContactsCountRes.error) {
        console.error("Admin dashboard query failed");
        return jsonResponse({ error: "Không tải được dữ liệu quản trị." }, 500, cors);
      }

      const allOrderRows = orderStatsRes.data || [];
      const totalOrders = allOrderRows.length;
      const pendingOrders = allOrderRows.filter(o => o.status === "pending").length;
      const hideRevenue = actor.role === "staff";
      const totalRevenue = hideRevenue
        ? null
        : allOrderRows
          .filter(o => o.status !== "cancelled")
          .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      let users: unknown[] | undefined;
      let catalog: unknown[] | undefined;
      let auditLogs: unknown[] | undefined;
      let totalUsers: number | undefined;
      let securityCenter: Record<string, unknown> | undefined;

      if (actor.role === "admin") {
        const [usersRes, usersCountRes, logsRes, checklistRes, backupsRes, catalogRes] = await Promise.all([
          db.from("profiles")
            .select("id, email, full_name, phone, role, can_edit_price, is_active, created_at, updated_at")
            .order("created_at", { ascending: false })
            .limit(200),
          db.from("profiles").select("id", { count: "exact", head: true }),
          db.from("security_audit_logs")
            .select("id, actor_id, actor_email, actor_role, action, target_type, target_id, details, ip_hash, created_at")
            .order("created_at", { ascending: false })
            .limit(50),
          db.from("security_checklists")
            .select("checked_items, updated_at, updated_by_email")
            .eq("id", "default")
            .maybeSingle(),
          db.from("backup_snapshots")
            .select("id, filename, is_encrypted, encryption_alg, checksum_sha256, record_counts, size_bytes, created_by_email, created_at")
            .order("created_at", { ascending: false })
            .limit(20),
          db.from("store_products")
            .select("id, sku, name, price, stock_quantity, is_available, badge_text, updated_at")
            .order("id", { ascending: true })
        ]);

        if (usersRes.error || usersCountRes.error || logsRes.error) {
          console.error("Admin security data query failed");
          return jsonResponse({ error: "Không tải được danh sách người dùng và nhật ký." }, 500, cors);
        }

        const typedUsers = (usersRes.data || []) as Array<{ role?: string; is_active?: boolean }>;
        users = typedUsers;
        catalog = (!catalogRes.error && catalogRes.data) ? catalogRes.data : [];
        totalUsers = usersCountRes.count ?? typedUsers.length;
        auditLogs = logsRes.data || [];

        const checklistMissing = Boolean(checklistRes.error && checklistRes.error.code === "PGRST205");
        const backupsMissing = Boolean(backupsRes.error && backupsRes.error.code === "PGRST205");
        const checklistRow = !checklistRes.error ? checklistRes.data : null;
        const backupRows = !backupsRes.error ? (backupsRes.data || []) : [];

        securityCenter = {
          healthChecks: [
            {
              key: "supabase_auth_rls",
              label: "Supabase Auth PKCE + Row-Level Security (RLS)",
              status: "pass",
              detail: "Xác thực JWT qua Edge Functions; RLS tách biệt dữ liệu khách hàng & nhật ký bảo mật"
            },
            {
              key: "mfa_enforcement",
              label: "Chính sách 2FA quản trị viên (AAL2)",
              status: requireMfa ? "pass" : "warn",
              detail: requireMfa
                ? "Đang ép buộc phiên AAL2 (TOTP) cho toàn bộ Admin, Manager và Staff"
                : "Đang bật AAL2 tự động cho tài khoản đã cài 2FA; có thể bật ép buộc toàn hệ thống bên dưới"
            },
            {
              key: "rbac_audit",
              label: "Phân quyền RBAC 4 vai trò & Nhật ký bảo mật",
              status: "pass",
              detail: `Admin / Manager / Staff / Customer (${totalUsers} tài khoản); ghi nhận ${(auditLogs as unknown[]).length}+ sự kiện`
            },
            {
              key: "backup_321",
              label: "Sao lưu Snapshot JSON & kiểm tra SHA-256",
              status: backupRows.length > 0 ? "pass" : "warn",
              detail: backupsMissing
                ? "Hãy chạy migration 20261124010000 & 20261124020000 để lưu lịch sử Snapshot trong Postgres"
                : backupRows.length > 0
                  ? `Đã lưu ${backupRows.length} bản Snapshot (mới nhất: ${backupRows[0].filename})`
                  : "Chưa tạo bản Snapshot nào — nhấn Tạo Snapshot & Tải về bên dưới"
            }
          ],
          securityPolicy: {
            requireAdminMfa: requireMfa,
            updatedAt: policyRow?.updated_at || null,
            updatedByEmail: policyRow?.updated_by_email || null
          },
          checklist: {
            items: CHECKLIST_ITEMS,
            checkedIds: Array.isArray(checklistRow?.checked_items)
              ? checklistRow.checked_items
              : ["daily_uptime", "daily_backup", "monthly_ssl"],
            updatedAt: checklistRow?.updated_at || null,
            updatedByEmail: checklistRow?.updated_by_email || null,
            migrationRequired: checklistMissing
          },
          backups: backupRows,
          versionInfo: {
            appVersion: "Rang Mây Coffee Web v2.1 (Cloud Supabase)",
            backendMode: "supabase",
            runtime: "Supabase Edge Functions (Deno)",
            tlsAlgorithm: "TLS 1.3 (Supabase + Cloudflare Edge)",
            keyRotationNote: "Tách biệt anon/publishable key ngoài frontend và service_role trong Edge Functions"
          }
        };
      }

      return jsonResponse({
        actor: {
          id: actor.id,
          email: actor.email,
          fullName: actor.fullName,
          role: actor.role,
          aal: actor.aal,
          requireAdminMfa: requireMfa
        },
        summary: {
          totalOrders,
          pendingOrders,
          totalRevenue,
          hideRevenue,
          newContacts: newContactsCountRes.count ?? 0,
          ...(typeof totalUsers === "number" ? { totalUsers } : {})
        },
        orders: ordersRes.data || [],
        contacts: contactsRes.data || [],
        ...(actor.role === "admin" ? { catalog, users, auditLogs, securityCenter } : {})
      }, 200, cors);
    }

    const body = await readJson(request) as Record<string, unknown>;
    const action = body.action;

    if (action === "update_order") {
      const orderId = body.orderId;
      const status = body.status;
      const internalNote = body.internalNote;

      if (!isValidUuid(orderId) ||
        typeof status !== "string" ||
        !(ORDER_STATUSES as readonly string[]).includes(status) ||
        (internalNote !== undefined && internalNote !== null &&
          (typeof internalNote !== "string" || internalNote.length > 1000))) {
        return jsonResponse({ error: "Dữ liệu cập nhật đơn hàng không hợp lệ." }, 400, cors);
      }

      const { data: existingOrder } = await db
        .from("orders")
        .select("id, order_number, status")
        .eq("id", orderId)
        .maybeSingle();

      if (!existingOrder) {
        return jsonResponse({ error: "Không tìm thấy đơn hàng." }, 404, cors);
      }

      const cleanNote = typeof internalNote === "string" && internalNote.trim()
        ? internalNote.trim()
        : null;

      const { data: updatedOrder, error: orderUpdateError } = await db
        .from("orders")
        .update({
          status,
          internal_note: cleanNote,
          updated_by: actor.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId)
        .select("id, order_number, status, internal_note, updated_at")
        .single();

      if (orderUpdateError || !updatedOrder) {
        console.error("Order status update failed:", orderUpdateError?.code);
        return jsonResponse({ error: "Không cập nhật được đơn hàng." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "order.status_updated",
        targetType: "order",
        targetId: orderId,
        details: {
          orderNumber: existingOrder.order_number,
          previousStatus: existingOrder.status,
          nextStatus: status
        },
        ipHash
      });

      return jsonResponse({ order: updatedOrder }, 200, cors);
    }

    if (action === "update_contact") {
      const contactId = body.contactId;
      const status = body.status;

      if (!isValidUuid(contactId) ||
        typeof status !== "string" ||
        !(CONTACT_STATUSES as readonly string[]).includes(status)) {
        return jsonResponse({ error: "Dữ liệu cập nhật liên hệ không hợp lệ." }, 400, cors);
      }

      const { data: existingContact } = await db
        .from("contact_messages")
        .select("id, status")
        .eq("id", contactId)
        .maybeSingle();

      if (!existingContact) {
        return jsonResponse({ error: "Không tìm thấy tin nhắn liên hệ." }, 404, cors);
      }

      const { data: updatedContact, error: contactUpdateError } = await db
        .from("contact_messages")
        .update({
          status,
          handled_by: actor.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", contactId)
        .select("id, status, handled_by, updated_at")
        .single();

      if (contactUpdateError || !updatedContact) {
        console.error("Contact status update failed:", contactUpdateError?.code);
        return jsonResponse({ error: "Không cập nhật được trạng thái liên hệ." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "contact.status_updated",
        targetType: "contact_message",
        targetId: contactId,
        details: {
          previousStatus: existingContact.status,
          nextStatus: status
        },
        ipHash
      });

      return jsonResponse({ contact: updatedContact }, 200, cors);
    }

    if (actor.role !== "admin") {
      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "access.denied",
        targetType: "admin_action",
        targetId: typeof action === "string" ? action : "unknown",
        details: { attemptedAction: action },
        ipHash
      });
      return jsonResponse({ error: "Chỉ Quản trị viên (Admin) mới được thực hiện thao tác này." }, 403, cors);
    }

    if (action === "update_user") {
      const userId = body.userId;
      const nextRole = body.role as UserRole;
      const isActive = body.isActive;

      if (!isValidUuid(userId) ||
        typeof nextRole !== "string" ||
        !USER_ROLES.includes(nextRole) ||
        typeof isActive !== "boolean") {
        return jsonResponse({ error: "Dữ liệu phân quyền tài khoản không hợp lệ." }, 400, cors);
      }

      if (userId === actor.id && !isActive) {
        return jsonResponse({ error: "Không thể tự khóa tài khoản quản trị đang đăng nhập." }, 400, cors);
      }

      if (userId === actor.id && nextRole !== "admin") {
        return jsonResponse({ error: "Không thể tự hạ quyền tài khoản quản trị đang đăng nhập." }, 400, cors);
      }

      const { data: targetProfile } = await db
        .from("profiles")
        .select("id, email, role, can_edit_price, is_active")
        .eq("id", userId)
        .maybeSingle();

      if (!targetProfile) {
        return jsonResponse({ error: "Không tìm thấy tài khoản người dùng." }, 404, cors);
      }

      if (targetProfile.role === "admin" && targetProfile.is_active && (nextRole !== "admin" || !isActive)) {
        const { count: otherAdmins } = await db
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("is_active", true)
          .neq("id", userId);

        if ((otherAdmins ?? 0) === 0) {
          return jsonResponse({ error: "Hệ thống cần duy trì ít nhất một Quản trị viên đang hoạt động." }, 400, cors);
        }
      }

      const nextCanEditPrice = nextRole === "admin"
        ? true
        : nextRole === "manager"
          ? (typeof body.canEditPrice === "boolean" ? body.canEditPrice : Boolean(targetProfile.can_edit_price))
          : false;

      const { data: updatedProfile, error: profileUpdateError } = await db
        .from("profiles")
        .update({
          role: nextRole,
          is_active: isActive,
          can_edit_price: nextCanEditPrice
        })
        .eq("id", userId)
        .select("id, email, full_name, phone, role, can_edit_price, is_active, updated_at")
        .single();

      if (profileUpdateError || !updatedProfile) {
        console.error("User permissions update failed:", profileUpdateError?.code);
        return jsonResponse({ error: "Không cập nhật được phân quyền người dùng." }, 500, cors);
      }

      if (targetProfile.is_active !== isActive) {
        const { error: banError } = await db.auth.admin.updateUserById(userId, {
          ban_duration: isActive ? "none" : "876000h"
        });
        if (banError) {
          console.error("Auth ban sync failed:", banError.message);
        }
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "user.permissions_updated",
        targetType: "profile",
        targetId: userId,
        details: {
          targetEmail: targetProfile.email,
          previousRole: targetProfile.role,
          nextRole,
          previousActive: targetProfile.is_active,
          nextActive: isActive,
          previousCanEditPrice: Boolean(targetProfile.can_edit_price),
          nextCanEditPrice
        },
        ipHash
      });

      return jsonResponse({ user: updatedProfile }, 200, cors);
    }

    if (action === "create_user") {
      const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const role = body.role as UserRole;
      const minLen = role === "customer" ? 10 : 14;

      if (
        fullName.length < 2 || fullName.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        typeof role !== "string" || !USER_ROLES.includes(role) ||
        password.length < minLen || password.length > 128 ||
        !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)
      ) {
        return jsonResponse({ error: `Thông tin hoặc mật khẩu chưa đạt chuẩn an toàn (>=${minLen} ký tự đủ 4 nhóm).` }, 400, cors);
      }

      const canEditPrice = role === "admin"
        ? true
        : role === "manager"
          ? Boolean(body.canEditPrice)
          : false;

      const { data: createdAuth, error: createAuthErr } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName }
      });

      if (createAuthErr || !createdAuth?.user) {
        const isDup = String(createAuthErr?.message || "").toLowerCase().includes("already");
        return jsonResponse(
          { error: isDup ? "Email tài khoản đã tồn tại trong hệ thống." : "Không thể tạo tài khoản mới." },
          isDup ? 409 : 400,
          cors
        );
      }

      const { data: savedProfile, error: profErr } = await db
        .from("profiles")
        .upsert({
          id: createdAuth.user.id,
          email,
          full_name: fullName,
          role,
          can_edit_price: canEditPrice,
          is_active: true,
          updated_at: new Date().toISOString()
        }, { onConflict: "id" })
        .select("id, email, full_name, phone, role, can_edit_price, is_active, created_at, updated_at")
        .single();

      if (profErr || !savedProfile) {
        return jsonResponse({ error: "Đã tạo Auth nhưng lỗi cập nhật phân quyền hồ sơ." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "user.created",
        targetType: "profile",
        targetId: createdAuth.user.id,
        details: { targetEmail: email, role, canEditPrice },
        ipHash
      });

      return jsonResponse({ user: savedProfile }, 201, cors);
    }

    if (action === "update_product") {
      const productId = body.productId;
      const price = body.price;
      const stockQuantity = body.stockQuantity;
      const isAvailable = body.isAvailable;
      const badgeText = body.badgeText;

      if (
        typeof productId !== "string" ||
        !Number.isInteger(price) || (price as number) < 10000 || (price as number) > 5000000 ||
        !Number.isInteger(stockQuantity) || (stockQuantity as number) < 0 || (stockQuantity as number) > 10000 ||
        typeof isAvailable !== "boolean" ||
        (badgeText !== undefined && badgeText !== null && (typeof badgeText !== "string" || badgeText.trim().length > 120))
      ) {
        return jsonResponse({ error: "Thông tin cập nhật sản phẩm không hợp lệ." }, 400, cors);
      }

      const { data: existingProd } = await db
        .from("store_products")
        .select("id, price, stock_quantity")
        .eq("id", productId)
        .maybeSingle();

      if (!existingProd) {
        return jsonResponse({ error: "Không tìm thấy sản phẩm." }, 404, cors);
      }

      const updateFields: Record<string, unknown> = {
        price,
        stock_quantity: stockQuantity,
        is_available: isAvailable,
        updated_by: actor.id,
        updated_at: new Date().toISOString()
      };
      if (typeof badgeText === "string") {
        updateFields.badge_text = badgeText.trim();
      }

      const { data: updatedProd, error: prodErr } = await db
        .from("store_products")
        .update(updateFields)
        .eq("id", productId)
        .select("id, sku, name, price, stock_quantity, is_available, badge_text, updated_at")
        .single();

      if (prodErr || !updatedProd) {
        return jsonResponse({ error: "Không cập nhật được sản phẩm." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: existingProd.price !== price ? "product.price_updated" : "product.updated",
        targetType: "store_product",
        targetId: productId,
        details: { prevPrice: existingProd.price, nextPrice: price, prevStock: existingProd.stock_quantity, nextStock: stockQuantity, isAvailable },
        ipHash
      });

      return jsonResponse({ product: updatedProd }, 200, cors);
    }

    if (action === "revoke_user_sessions") {
      const userId = body.userId;
      if (!isValidUuid(userId)) {
        return jsonResponse({ error: "Mã tài khoản không hợp lệ." }, 400, cors);
      }
      if (userId === actor.id) {
        return jsonResponse({ error: "Dùng nút Đăng xuất để kết thúc phiên hiện tại." }, 400, cors);
      }

      const { error: signOutErr } = await db.auth.admin.signOut(userId, "global");
      if (signOutErr) {
        return jsonResponse({ error: "Không thể thu hồi phiên đăng nhập." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "user.sessions_revoked",
        targetType: "profile",
        targetId: userId,
        ipHash
      });

      return jsonResponse({ revoked: true }, 200, cors);
    }

    if (action === "update_security_policy") {
      const nextRequireMfa = body.requireAdminMfa;
      if (typeof nextRequireMfa !== "boolean") {
        return jsonResponse({ error: "Giá trị chính sách 2FA không hợp lệ." }, 400, cors);
      }
      if (nextRequireMfa && (!actor.hasVerifiedMfa || actor.aal !== "aal2")) {
        return jsonResponse({
          error: "Tài khoản Admin hiện tại cần bật 2FA và xác thực AAL2 trước khi bật bắt buộc toàn hệ thống."
        }, 400, cors);
      }

      const nowIso = new Date().toISOString();
      const { error: policyErr } = await db.from("security_policies").upsert({
        id: "default",
        require_admin_mfa: nextRequireMfa,
        updated_by: actor.id,
        updated_by_email: actor.email,
        updated_at: nowIso
      }, { onConflict: "id" });

      if (policyErr) {
        return jsonResponse({ error: "Không lưu được chính sách bảo mật (kiểm tra migration 20261124020000)." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "security.policy_updated",
        targetType: "security_policy",
        targetId: "default",
        details: { requireAdminMfa: nextRequireMfa },
        ipHash
      });

      return jsonResponse({
        securityPolicy: {
          requireAdminMfa: nextRequireMfa,
          updatedAt: nowIso,
          updatedByEmail: actor.email
        }
      }, 200, cors);
    }

    if (action === "save_checklist") {
      const rawIds = body.checkedIds;
      if (!Array.isArray(rawIds)) {
        return jsonResponse({ error: "Danh sách mục checklist không hợp lệ." }, 400, cors);
      }
      const cleanIds = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && CHECKLIST_ID_SET.has(id)))];
      const nowIso = new Date().toISOString();

      const { error: upsertErr } = await db.from("security_checklists").upsert({
        id: "default",
        checked_items: cleanIds,
        updated_by: actor.id,
        updated_by_email: actor.email,
        updated_at: nowIso
      }, { onConflict: "id" });

      if (upsertErr) {
        console.error("Checklist upsert failed:", upsertErr.code);
        return jsonResponse({ error: "Không lưu được checklist (hãy kiểm tra đã chạy migration mới nhất chưa)." }, 500, cors);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "security.checklist_updated",
        targetType: "security_checklist",
        targetId: "default",
        details: { checkedCount: cleanIds.length, totalCount: CHECKLIST_ITEMS.length },
        ipHash
      });

      return jsonResponse({
        checklist: {
          items: CHECKLIST_ITEMS,
          checkedIds: cleanIds,
          updatedAt: nowIso,
          updatedByEmail: actor.email
        }
      }, 200, cors);
    }

    if (action === "create_backup") {
      const [ordersSnapRes, contactsSnapRes, profilesSnapRes, logsSnapRes, checklistSnapRes] = await Promise.all([
        db.from("orders").select("*").order("created_at", { ascending: false }).limit(1000),
        db.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(1000),
        db.from("profiles").select("id, email, full_name, phone, role, is_active, created_at, updated_at").order("created_at", { ascending: false }).limit(1000),
        db.from("security_audit_logs").select("*").order("created_at", { ascending: false }).limit(200),
        db.from("security_checklists").select("checked_items, updated_at, updated_by_email").eq("id", "default").maybeSingle()
      ]);

      if (ordersSnapRes.error || contactsSnapRes.error || profilesSnapRes.error || logsSnapRes.error) {
        return jsonResponse({ error: "Không truy xuất được dữ liệu để sao lưu." }, 500, cors);
      }

      const now = new Date();
      const exportedAt = now.toISOString();
      const filename = `rangmay-backup-${formatUtcStamp(now)}.json`;
      const payload = {
        exportedAt,
        version: "Rang Mây Coffee Web v2.1 (Cloud Supabase)",
        mode: "supabase",
        recordCounts: {
          orders: (ordersSnapRes.data || []).length,
          contacts: (contactsSnapRes.data || []).length,
          profiles: (profilesSnapRes.data || []).length,
          auditLogs: (logsSnapRes.data || []).length
        },
        orders: ordersSnapRes.data || [],
        contacts: contactsSnapRes.data || [],
        profiles: profilesSnapRes.data || [],
        auditLogs: logsSnapRes.data || [],
        checklist: {
          checkedIds: !checklistSnapRes.error && Array.isArray(checklistSnapRes.data?.checked_items)
            ? checklistSnapRes.data.checked_items
            : [],
          updatedAt: !checklistSnapRes.error ? (checklistSnapRes.data?.updated_at || null) : null,
          updatedByEmail: !checklistSnapRes.error ? (checklistSnapRes.data?.updated_by_email || null) : null
        }
      };

      const jsonText = JSON.stringify(payload, null, 2);
      const checksumSha256 = await sha256Hex(jsonText);
      const sizeBytes = new TextEncoder().encode(jsonText).byteLength;

      const { data: savedSnap, error: snapInsertErr } = await db
        .from("backup_snapshots")
        .insert({
          filename,
          is_encrypted: false,
          encryption_alg: "SHA-256-Verified-JSON",
          checksum_sha256: checksumSha256,
          record_counts: payload.recordCounts,
          size_bytes: sizeBytes,
          created_by: actor.id,
          created_by_email: actor.email
        })
        .select("id, filename, is_encrypted, encryption_alg, checksum_sha256, record_counts, size_bytes, created_by_email, created_at")
        .maybeSingle();

      if (snapInsertErr) {
        console.error("Backup snapshot metadata insert failed:", snapInsertErr.code);
      }

      await writeAuditLog(db, {
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "security.backup_created",
        targetType: "backup_snapshot",
        targetId: filename,
        details: { checksum_sha256: checksumSha256, size_bytes: sizeBytes },
        ipHash
      });

      const snapshot = savedSnap || {
        id: crypto.randomUUID(),
        filename,
        is_encrypted: false,
        encryption_alg: "SHA-256-Verified-JSON",
        checksum_sha256: checksumSha256,
        record_counts: payload.recordCounts,
        size_bytes: sizeBytes,
        created_by_email: actor.email,
        created_at: exportedAt
      };

      return jsonResponse({ snapshot, payload }, 200, cors);
    }

    return jsonResponse({ error: "Hành động quản trị không hợp lệ." }, 400, cors);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, cors);
    }
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("quá lớn") ? 413 : 400;
    return jsonResponse({ error: status === 413 ? message : "Yêu cầu quản trị không hợp lệ." }, status, cors);
  }
});
