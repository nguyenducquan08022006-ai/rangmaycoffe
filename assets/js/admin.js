(function initAdminPage() {
  "use strict";

  const auth = window.RangMayAuth;
  if (!auth) return;

  const ROLE_LABELS = {
    admin: "Chủ cửa hàng",
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

  const CONTACT_STATUS_LABELS = {
    new: "Mới tiếp nhận",
    in_progress: "Đang xử lý",
    resolved: "Đã phản hồi"
  };

  let dashboardState = {
    actor: null,
    summary: {},
    catalog: [],
    orders: [],
    contacts: [],
    users: [],
    auditLogs: [],
    securityCenter: null
  };

  let stopIdleGuard = null;

  const banner = document.getElementById("adminBanner");

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

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
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

  function showGateScreen(title, message) {
    document.getElementById("adminHeaderCard").hidden = true;
    document.getElementById("adminKpiGrid").hidden = true;
    document.getElementById("adminWorkspaceCard").hidden = true;
    const gateCard = document.getElementById("adminGateCard");
    if (gateCard) gateCard.hidden = false;
    const gateTitle = document.getElementById("adminGateTitle");
    const gateMessage = document.getElementById("adminGateMessage");
    if (gateTitle) gateTitle.textContent = title;
    if (gateMessage) gateMessage.textContent = message;
  }

  function switchAdminTab(tabName) {
    document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.adminTab === tabName);
    });
    document.getElementById("panelOrders").hidden = tabName !== "orders";
    document.getElementById("panelContacts").hidden = tabName !== "contacts";
    document.getElementById("panelUsers").hidden = tabName !== "users";
    const panelCatalog = document.getElementById("panelCatalog");
    if (panelCatalog) panelCatalog.hidden = tabName !== "catalog";
    document.getElementById("panelLogs").hidden = tabName !== "logs";
    const panelSecurity = document.getElementById("panelSecurity");
    if (panelSecurity) panelSecurity.hidden = tabName !== "security";
  }

  document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchAdminTab(btn.dataset.adminTab));
  });

  function renderHeaderAndKpis() {
    const actor = dashboardState.actor;
    const summary = dashboardState.summary || {};

    document.getElementById("adminGateCard").hidden = true;
    document.getElementById("adminHeaderCard").hidden = false;
    document.getElementById("adminKpiGrid").hidden = false;
    document.getElementById("adminWorkspaceCard").hidden = false;

    document.getElementById("adminActorEmail").textContent = actor.email;

    const roleBadge = document.getElementById("adminRoleBadge");
    roleBadge.className = "badge role-" + actor.role;
    roleBadge.textContent = ROLE_LABELS[actor.role] || actor.role;

    const aalBadge = document.getElementById("adminAalBadge");
    aalBadge.className = "badge " + (actor.aal === "aal2" ? "aal-2" : "aal-1");
    aalBadge.textContent = actor.aal === "aal2" ? "2FA AAL2" : "Chưa qua 2FA (AAL1)";

    if (actor.aal !== "aal2") {
      showBanner(
        "warning",
        "Khuyến nghị bảo mật: Tài khoản quản trị/quản lý/nhân viên nên bật và đăng nhập bằng xác thực 2 yếu tố (2FA) tại trang Tài khoản."
      );
    }

    document.getElementById("kpiTotalOrders").textContent = String(summary.totalOrders ?? 0);
    document.getElementById("kpiPendingOrders").textContent = String(summary.pendingOrders ?? 0);
    document.getElementById("kpiRevenue").textContent = summary.hideRevenue
      ? "Ẩn theo RBAC"
      : fmtPrice(summary.totalRevenue ?? 0) + "đ";
    document.getElementById("kpiNewContacts").textContent = String(summary.newContacts ?? 0);

    const isAdmin = actor.role === "admin";
    document.getElementById("kpiUsersCard").hidden = !isAdmin;
    document.getElementById("tabBtnUsers").hidden = !isAdmin;
    document.getElementById("tabBtnLogs").hidden = !isAdmin;
    const secTab = document.getElementById("tabBtnSecurity");
    if (secTab) secTab.hidden = !isAdmin;

    if (isAdmin) {
      document.getElementById("kpiTotalUsers").textContent = String(summary.totalUsers ?? 0);
    }
  }

  function renderOrdersTable() {
    const tbody = document.getElementById("adminOrdersBody");
    const search = (document.getElementById("orderSearchInput")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    if (!tbody) return;

    tbody.replaceChildren();
    const filtered = (dashboardState.orders || []).filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (!search) return true;
      const haystack = [
        order.order_number,
        order.customer_name,
        order.customer_phone,
        order.customer_email
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(search);
    });

    if (filtered.length === 0) {
      const tr = document.createElement("tr");
      const td = createEl("td", "empty-state", "Không có đơn hàng phù hợp bộ lọc.");
      td.colSpan = 5;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    filtered.forEach((order) => {
      const tr = document.createElement("tr");

      const tdOrder = createEl("td");
      tdOrder.appendChild(createEl("strong", "", order.order_number || ""));
      tdOrder.appendChild(createEl("span", "table-subtext", fmtDate(order.created_at)));

      const tdCustomer = createEl("td");
      tdCustomer.appendChild(createEl("strong", "", order.customer_name || ""));
      tdCustomer.appendChild(createEl("span", "table-subtext", order.customer_phone || ""));
      tdCustomer.appendChild(createEl("span", "table-subtext", order.shipping_address || ""));

      const tdItems = createEl("td");
      const itemsText = Array.isArray(order.items)
        ? order.items.map(i => (i.name || i.id) + " × " + i.quantity).join(", ")
        : "";
      tdItems.appendChild(createEl("div", "", itemsText));
      if (order.voucher_code && Number(order.discount_amount) > 0) {
        tdItems.appendChild(
          createEl("span", "table-subtext", "Voucher " + order.voucher_code + ": -" + fmtPrice(order.discount_amount) + "đ")
        );
      }
      tdItems.appendChild(createEl("strong", "", fmtPrice(order.total_amount) + "đ (" + (order.payment_method || "COD") + ")"));
      if (order.gift_message) {
        tdItems.appendChild(createEl("span", "table-subtext", "Thiệp: " + order.gift_message));
      }

      const tdStatus = createEl("td");
      const st = order.status || "pending";
      tdStatus.appendChild(createEl("span", "badge status-" + st, ORDER_STATUS_LABELS[st] || st));

      const tdActions = createEl("td");
      const stack = createEl("div", "inline-control-stack");
      const statusSelect = document.createElement("select");
      Object.entries(ORDER_STATUS_LABELS).forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        opt.selected = val === st;
        statusSelect.appendChild(opt);
      });

      const noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.maxLength = 1000;
      noteInput.placeholder = "Ghi chú nội bộ...";
      noteInput.value = order.internal_note || "";

      const saveBtn = createEl("button", "btn-sm", "Lưu đơn");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Đang lưu...";
        try {
          await auth.apiRequest("admin-api", {
            method: "PATCH",
            authRequired: true,
            body: {
              action: "update_order",
              orderId: order.id,
              status: statusSelect.value,
              internalNote: noteInput.value
            }
          });
          showBanner("success", "Đã cập nhật trạng thái đơn " + order.order_number + ".");
          await loadDashboardData();
        } catch (error) {
          showBanner("error", error instanceof Error ? error.message : "Không cập nhật được đơn hàng.");
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = "Lưu đơn";
        }
      });

      stack.append(statusSelect, noteInput, saveBtn);
      tdActions.appendChild(stack);

      tr.append(tdOrder, tdCustomer, tdItems, tdStatus, tdActions);
      tbody.appendChild(tr);
    });
  }

  function renderContactsTable() {
    const tbody = document.getElementById("adminContactsBody");
    const statusFilter = document.getElementById("contactStatusFilter")?.value || "all";
    if (!tbody) return;

    tbody.replaceChildren();
    const filtered = (dashboardState.contacts || []).filter((c) => {
      return statusFilter === "all" || (c.status || "new") === statusFilter;
    });

    if (filtered.length === 0) {
      const tr = document.createElement("tr");
      const td = createEl("td", "empty-state", "Không có tin nhắn liên hệ phù hợp.");
      td.colSpan = 5;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    filtered.forEach((contact) => {
      const tr = document.createElement("tr");

      const tdSender = createEl("td");
      tdSender.appendChild(createEl("strong", "", contact.name || ""));
      tdSender.appendChild(createEl("span", "table-subtext", contact.email || ""));
      if (contact.phone) tdSender.appendChild(createEl("span", "table-subtext", contact.phone));

      const tdMsg = createEl("td", "", contact.message || "");
      const tdDate = createEl("td", "", fmtDate(contact.created_at));

      const st = contact.status || "new";
      const tdStatus = createEl("td");
      tdStatus.appendChild(createEl("span", "badge status-" + st, CONTACT_STATUS_LABELS[st] || st));

      const tdActions = createEl("td");
      const stack = createEl("div", "inline-control-stack");
      const statusSelect = document.createElement("select");
      Object.entries(CONTACT_STATUS_LABELS).forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        opt.selected = val === st;
        statusSelect.appendChild(opt);
      });

      const saveBtn = createEl("button", "btn-sm", "Cập nhật");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        try {
          await auth.apiRequest("admin-api", {
            method: "PATCH",
            authRequired: true,
            body: {
              action: "update_contact",
              contactId: contact.id,
              status: statusSelect.value
            }
          });
          showBanner("success", "Đã cập nhật trạng thái liên hệ.");
          await loadDashboardData();
        } catch (error) {
          showBanner("error", error instanceof Error ? error.message : "Không cập nhật được liên hệ.");
        } finally {
          saveBtn.disabled = false;
        }
      });

      stack.append(statusSelect, saveBtn);
      tdActions.appendChild(stack);

      tr.append(tdSender, tdMsg, tdDate, tdStatus, tdActions);
      tbody.appendChild(tr);
    });
  }

  function renderUsersTable() {
    const tbody = document.getElementById("adminUsersBody");
    const search = (document.getElementById("userSearchInput")?.value || "").trim().toLowerCase();
    if (!tbody || dashboardState.actor?.role !== "admin") return;

    tbody.replaceChildren();
    const filtered = (dashboardState.users || []).filter((u) => {
      if (!search) return true;
      const hay = [u.email, u.full_name, u.phone].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });

    if (filtered.length === 0) {
      const tr = document.createElement("tr");
      const td = createEl("td", "empty-state", "Không tìm thấy tài khoản phù hợp.");
      td.colSpan = 4;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    filtered.forEach((user) => {
      const tr = document.createElement("tr");
      const isSelf = user.id === dashboardState.actor.id;

      const tdUser = createEl("td");
      tdUser.appendChild(createEl("strong", "", user.email || ""));
      tdUser.appendChild(createEl("span", "table-subtext", (user.full_name || "Chưa cập nhật tên") + (isSelf ? " (Bạn)" : "")));
      if (typeof user.has_2fa === "boolean") {
        tdUser.appendChild(createEl("span", "table-subtext", user.has_2fa ? "2FA: Đã bật" : "2FA: Chưa bật"));
      }

      const tdRole = createEl("td");
      tdRole.appendChild(createEl("span", "badge role-" + user.role, ROLE_LABELS[user.role] || user.role));
      if (user.role === "admin") {
        tdRole.appendChild(createEl("span", "table-subtext", "✓ Toàn quyền sửa giá"));
      } else if (user.role === "manager") {
        tdRole.appendChild(
          createEl(
            "span",
            "table-subtext",
            user.can_edit_price ? "✓ Đã cấp quyền sửa giá" : "🔒 Chưa cấp quyền sửa giá"
          )
        );
      }

      const tdActive = createEl("td");
      tdActive.appendChild(createEl(
        "span",
        "badge " + (user.is_active ? "status-active" : "status-disabled"),
        user.is_active ? "Đang hoạt động" : "Đã khóa"
      ));

      const tdControls = createEl("td");
      const stack = createEl("div", "inline-control-stack");

      const roleSelect = document.createElement("select");
      Object.entries(ROLE_LABELS).forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        opt.selected = val === user.role;
        roleSelect.appendChild(opt);
      });
      roleSelect.disabled = isSelf;

      const activeSelect = document.createElement("select");
      const optActive = document.createElement("option");
      optActive.value = "true";
      optActive.textContent = "Hoạt động";
      optActive.selected = Boolean(user.is_active);
      const optLocked = document.createElement("option");
      optLocked.value = "false";
      optLocked.textContent = "Khóa tài khoản";
      optLocked.selected = !user.is_active;
      activeSelect.append(optActive, optLocked);
      activeSelect.disabled = isSelf;

      const pricePermLabel = createEl("label", "catalog-checkbox-label compact-perm-check");
      const pricePermCheck = document.createElement("input");
      pricePermCheck.type = "checkbox";
      pricePermCheck.checked = Boolean(user.can_edit_price);
      const pricePermText = createEl("span", "", "Cho phép sửa giá bán");
      pricePermLabel.append(pricePermCheck, pricePermText);

      function syncPricePermVisibility() {
        const selectedRole = roleSelect.value;
        if (selectedRole === "admin") {
          pricePermLabel.hidden = false;
          pricePermCheck.checked = true;
          pricePermCheck.disabled = true;
        } else if (selectedRole === "manager") {
          pricePermLabel.hidden = false;
          pricePermCheck.disabled = isSelf;
        } else {
          pricePermLabel.hidden = true;
          pricePermCheck.checked = false;
          pricePermCheck.disabled = true;
        }
      }
      roleSelect.addEventListener("change", () => {
        if (roleSelect.value === "manager" && user.role !== "manager") {
          pricePermCheck.checked = false;
        }
        syncPricePermVisibility();
      });
      syncPricePermVisibility();

      const saveBtn = createEl("button", "btn-sm", isSelf ? "Tài khoản hiện tại" : "Áp dụng quyền");
      saveBtn.type = "button";
      saveBtn.disabled = isSelf;
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        try {
          const selectedRole = roleSelect.value;
          const canEditPrice = selectedRole === "admin"
            ? true
            : selectedRole === "manager"
              ? Boolean(pricePermCheck.checked)
              : false;
          await auth.apiRequest("admin-api", {
            method: "PATCH",
            authRequired: true,
            body: {
              action: "update_user",
              userId: user.id,
              role: selectedRole,
              isActive: activeSelect.value === "true",
              canEditPrice
            }
          });
          showBanner("success", "Đã cập nhật phân quyền cho tài khoản " + user.email + ".");
          await loadDashboardData();
        } catch (error) {
          showBanner("error", error instanceof Error ? error.message : "Không thể cập nhật quyền tài khoản.");
        } finally {
          saveBtn.disabled = isSelf;
        }
      });

      stack.append(roleSelect, activeSelect, pricePermLabel, saveBtn);

      if (!isSelf) {
        const revokeBtn = createEl("button", "btn-sm outline", "Thu hồi phiên");
        revokeBtn.type = "button";
        revokeBtn.addEventListener("click", async () => {
          revokeBtn.disabled = true;
          try {
            await auth.apiRequest("admin-api", {
              method: "PATCH",
              authRequired: true,
              body: {
                action: "revoke_user_sessions",
                userId: user.id
              }
            });
            showBanner("info", "Đã thu hồi toàn bộ phiên đăng nhập của " + user.email + ".");
            await loadDashboardData();
          } catch (error) {
            showBanner("error", error instanceof Error ? error.message : "Không thu hồi được phiên đăng nhập.");
          } finally {
            revokeBtn.disabled = false;
          }
        });
        stack.appendChild(revokeBtn);
      }

      tdControls.appendChild(stack);
      tr.append(tdUser, tdRole, tdActive, tdControls);
      tbody.appendChild(tr);
    });
  }

  function renderAuditLogsTable() {
    const tbody = document.getElementById("adminLogsBody");
    if (!tbody || dashboardState.actor?.role !== "admin") return;

    tbody.replaceChildren();
    const logs = dashboardState.auditLogs || [];
    if (logs.length === 0) {
      const tr = document.createElement("tr");
      const td = createEl("td", "empty-state", "Chưa có nhật ký bảo mật nào được ghi nhận.");
      td.colSpan = 5;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    logs.forEach((entry) => {
      const tr = document.createElement("tr");
      const tdDate = createEl("td", "", fmtDate(entry.created_at));

      const tdActor = createEl("td");
      tdActor.appendChild(createEl("strong", "", entry.actor_email || "Hệ thống"));
      if (entry.actor_role) {
        tdActor.appendChild(createEl("span", "table-subtext", ROLE_LABELS[entry.actor_role] || entry.actor_role));
      }

      const tdAction = createEl("td", "", entry.action || "");
      const targetStr = [entry.target_type, entry.target_id].filter(Boolean).join(": ");
      const tdTarget = createEl("td", "", targetStr);

      let detailsStr = "";
      try {
        detailsStr = entry.details ? JSON.stringify(entry.details) : "";
      } catch {
        detailsStr = "";
      }
      const tdDetails = createEl("td");
      tdDetails.appendChild(createEl("span", "table-subtext", detailsStr));

      tr.append(tdDate, tdActor, tdAction, tdTarget, tdDetails);
      tbody.appendChild(tr);
    });
  }

  function triggerJsonDownload(filename, jsonPayload) {
    const content = typeof jsonPayload === "string" ? jsonPayload : JSON.stringify(jsonPayload, null, 2);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "rangmay-backup.enc.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderSecurityCenter() {
    const sc = dashboardState.securityCenter;
    if (!sc || dashboardState.actor?.role !== "admin") return;

    const reqBadge = document.getElementById("requireMfaStatusBadge");
    const reqBtn = document.getElementById("toggleRequireMfaBtn");
    const lockoutsText = document.getElementById("activeLockoutsText");
    const requireMfaEnabled = Boolean(sc.securityPolicy && sc.securityPolicy.requireAdminMfa);

    if (reqBadge) {
      reqBadge.className = "badge " + (requireMfaEnabled ? "status-active" : "status-warn");
      reqBadge.textContent = requireMfaEnabled ? "Đang bật bắt buộc AAL2" : "Đang tắt (chế độ khuyến nghị)";
    }
    if (reqBtn) {
      reqBtn.textContent = requireMfaEnabled ? "Tắt ép buộc 2FA" : "Bật ép buộc 2FA (AAL2)";
      reqBtn.dataset.nextValue = requireMfaEnabled ? "false" : "true";
    }
    if (lockoutsText && sc.lockoutSummary) {
      lockoutsText.textContent = "Đang khóa tạm thời (Brute-force): " + String(sc.lockoutSummary.activeLockouts ?? 0);
    }

    const healthBody = document.getElementById("securityHealthBody");
    if (healthBody) {
      healthBody.replaceChildren();
      const mixedAssets = Array.from(document.querySelectorAll('img[src^="http://"], script[src^="http://"], link[href^="http://"]'));
      const clientChecks = [
        {
          label: "Giao thức HTTPS & Kiểm tra Mixed Content",
          status: window.location.protocol === "https:" && mixedAssets.length === 0 ? "pass" : "warn",
          detail: window.location.protocol === "https:" && mixedAssets.length === 0
            ? "HTTPS (" + window.location.host + ") sạch hoàn toàn, 0 tài nguyên http:// hỗn hợp"
            : "Phát hiện " + mixedAssets.length + " tài nguyên http:// hoặc chưa truy cập qua HTTPS"
        },
        {
          label: "Content Security Policy (CSP) & Khóa phiên 30 phút",
          status: document.querySelector('meta[http-equiv="Content-Security-Policy"]') ? "pass" : "warn",
          detail: "Chặn inline script/style XSS và tự khóa khu vực quản trị sau 30 phút không thao tác"
        }
      ];

      const allChecks = [...clientChecks, ...(Array.isArray(sc.healthChecks) ? sc.healthChecks : [])];
      allChecks.forEach((item) => {
        const tr = document.createElement("tr");
        const tdName = createEl("td");
        tdName.appendChild(createEl("strong", "", item.label || ""));

        const tdState = createEl("td");
        const isOk = item.status === "pass";
        tdState.appendChild(createEl(
          "span",
          "badge " + (isOk ? "status-active" : "status-warn"),
          isOk ? "ĐẠT" : "CẦN CHÚ Ý"
        ));

        const tdDetail = createEl("td", "", item.detail || "");
        tr.append(tdName, tdState, tdDetail);
        healthBody.appendChild(tr);
      });
    }

    const versionList = document.getElementById("securityVersionList");
    if (versionList && sc.versionInfo) {
      versionList.replaceChildren();
      const rows = [
        ["Phiên bản ứng dụng", sc.versionInfo.appVersion],
        ["Chế độ Backend", sc.versionInfo.backendMode === "local-secure" ? "Local HTTPS Security Server" : "Supabase Cloud + RLS"],
        ["Môi trường & Gói", sc.versionInfo.runtime],
        ["Chuẩn mã hóa đường truyền", sc.versionInfo.tlsAlgorithm],
        ["Quản lý khóa & bí mật", sc.versionInfo.keyRotationNote]
      ];
      rows.forEach(([label, value]) => {
        const li = document.createElement("li");
        li.appendChild(createEl("strong", "", label));
        li.appendChild(createEl("span", "", value || ""));
        versionList.appendChild(li);
      });
    }

    const backupsBody = document.getElementById("adminBackupsBody");
    const drillBox = document.getElementById("restoreDrillReport");
    if (backupsBody) {
      backupsBody.replaceChildren();
      const backups = Array.isArray(sc.backups) ? sc.backups : [];
      if (backups.length === 0) {
        const tr = document.createElement("tr");
        const td = createEl("td", "empty-state", "Chưa có bản sao lưu Snapshot nào. Nhấn \"Tạo Snapshot Mã hóa\" ở trên để khởi tạo.");
        td.colSpan = 4;
        tr.appendChild(td);
        backupsBody.appendChild(tr);
      } else {
        const mode = auth.getBackendMode ? auth.getBackendMode() : "supabase";
        backups.forEach((snap) => {
          const tr = document.createElement("tr");

          const tdFile = createEl("td");
          tdFile.appendChild(createEl("strong", "code-mono", snap.filename || ""));
          tdFile.appendChild(createEl("span", "table-subtext", Number(snap.size_bytes || 0).toLocaleString("vi-VN") + " bytes"));

          const tdMeta = createEl("td");
          tdMeta.appendChild(createEl("div", "", fmtDate(snap.created_at)));
          tdMeta.appendChild(createEl("span", "table-subtext", (snap.created_by_email || "admin") + " · " + (snap.encryption_alg || "JSON")));

          const tdSha = createEl("td");
          const fullHash = snap.checksum_sha256 || "";
          const shaEl = createEl("span", "code-mono", fullHash ? fullHash.slice(0, 16) + "…" : "");
          if (fullHash) shaEl.title = fullHash;
          tdSha.appendChild(shaEl);

          const tdAction = createEl("td");
          const rc = snap.record_counts || {};
          const countSummary = [
            "Đơn: " + (rc.orders ?? 0),
            "Liên hệ: " + (rc.contacts ?? 0),
            "User: " + (rc.profiles ?? 0)
          ].join(" · ");
          tdAction.appendChild(createEl("span", "table-subtext", countSummary));

          if (mode === "local-secure") {
            const btnRow = createEl("div", "backup-actions-row");

            const drillBtn = createEl("button", "btn-sm outline", "Diễn tập (Drill)");
            drillBtn.type = "button";
            drillBtn.addEventListener("click", async () => {
              drillBtn.disabled = true;
              try {
                const res = await auth.apiRequest("admin-api", {
                  method: "PATCH",
                  authRequired: true,
                  body: { action: "restore_drill", filename: snap.filename }
                });
                if (drillBox) {
                  drillBox.className = "portal-banner success";
                  drillBox.textContent = "Restore Drill ĐẠT (" + snap.filename + "): RTO = " + res.rtoMs +
                    " ms · SHA-256 hợp lệ · AES-256-GCM giải mã thành công (Đơn: " +
                    (res.backupCounts?.orders ?? 0) + ", Liên hệ: " + (res.backupCounts?.contacts ?? 0) + ").";
                  drillBox.hidden = false;
                }
                await loadDashboardData();
              } catch (error) {
                if (drillBox) {
                  drillBox.className = "portal-banner error";
                  drillBox.textContent = error instanceof Error ? error.message : "Diễn tập khôi phục thất bại.";
                  drillBox.hidden = false;
                }
              } finally {
                drillBtn.disabled = false;
              }
            });

            const restoreBtn = createEl("button", "btn-sm danger", "Khôi phục");
            restoreBtn.type = "button";
            restoreBtn.addEventListener("click", async () => {
              if (!window.confirm("Hệ thống sẽ tự tạo bản sao lưu an toàn trước khi khôi phục Đơn hàng, Liên hệ & Checklist từ " + snap.filename + ". Tiếp tục?")) {
                return;
              }
              restoreBtn.disabled = true;
              try {
                const res = await auth.apiRequest("admin-api", {
                  method: "PATCH",
                  authRequired: true,
                  body: { action: "restore_backup", filename: snap.filename }
                });
                showBanner("success", "Đã khôi phục dữ liệu từ " + res.restoredFilename +
                  " (bản sao an toàn trước đó: " + (res.safetySnapshot?.filename || "") + ").");
                await loadDashboardData();
              } catch (error) {
                showBanner("error", error instanceof Error ? error.message : "Khôi phục thất bại.");
              } finally {
                restoreBtn.disabled = false;
              }
            });

            btnRow.append(drillBtn, restoreBtn);

            if (typeof auth.downloadAdminBackup === "function") {
              const dlBtn = createEl("button", "btn-sm outline", "Tải (.enc.json)");
              dlBtn.type = "button";
              dlBtn.addEventListener("click", async () => {
                dlBtn.disabled = true;
                try {
                  const downloaded = await auth.downloadAdminBackup(snap.filename);
                  const text = await downloaded.blob.text();
                  triggerJsonDownload(snap.filename, text);
                  showBanner("success", "Đã tải bản sao lưu mã hóa " + snap.filename + ".");
                } catch (error) {
                  showBanner("error", error instanceof Error ? error.message : "Không tải được tệp sao lưu.");
                } finally {
                  dlBtn.disabled = false;
                }
              });
              btnRow.appendChild(dlBtn);
            }

            tdAction.appendChild(btnRow);
          }

          tr.append(tdFile, tdMeta, tdSha, tdAction);
          backupsBody.appendChild(tr);
        });
      }
    }

    const checklistBox = document.getElementById("securityChecklistItems");
    const checklistMeta = document.getElementById("checklistMetaText");
    if (checklistBox && sc.checklist) {
      checklistBox.replaceChildren();
      const checkedSet = new Set(Array.isArray(sc.checklist.checkedIds) ? sc.checklist.checkedIds : []);
      const items = Array.isArray(sc.checklist.items) ? sc.checklist.items : [];
      items.forEach((item) => {
        const label = document.createElement("label");
        label.className = "checklist-row";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "checklistItem";
        checkbox.value = item.id;
        checkbox.checked = checkedSet.has(item.id);

        const bodyWrap = document.createElement("div");
        const freqSpan = createEl("span", "checklist-freq", item.freq || "");
        const textSpan = createEl("span", "checklist-label", item.label || "");
        bodyWrap.append(freqSpan, textSpan);

        label.append(checkbox, bodyWrap);
        checklistBox.appendChild(label);
      });

      if (checklistMeta) {
        if (sc.checklist.updatedAt) {
          checklistMeta.textContent = "Cập nhật lần cuối: " + fmtDate(sc.checklist.updatedAt) +
            (sc.checklist.updatedByEmail ? " bởi " + sc.checklist.updatedByEmail : "") +
            " (" + checkedSet.size + "/" + items.length + " mục đạt).";
        } else {
          checklistMeta.textContent = "Đã hoàn thành " + checkedSet.size + "/" + items.length + " hạng mục kiểm tra định kỳ.";
        }
      }
    }
  }

  let selectedOwnerProductId = "drip-pack-001";

  function renderOwnerCatalogPanel() {
    const list = Array.isArray(dashboardState.catalog) ? dashboardState.catalog : [];
    const preview = document.getElementById("ownerCatalogLivePreview");
    const tbody = document.getElementById("ownerCatalogBody");
    const selectEl = document.getElementById("ownerProdId");

    if (tbody) {
      tbody.replaceChildren();
      list.forEach((item) => {
        const tr = document.createElement("tr");
        const tdSku = createEl("td");
        tdSku.appendChild(createEl("strong", "", item.sku || item.id));
        tdSku.appendChild(createEl("span", "table-subtext", item.id));

        const tdName = createEl("td");
        tdName.appendChild(createEl("strong", "", item.name || ""));
        tdName.appendChild(createEl("span", "table-subtext", item.badge_text || ""));

        const tdPrice = createEl("td", "", fmtPrice(item.price) + "đ");
        const tdStock = createEl("td", "", String(item.stock_quantity ?? 0) + " hộp");

        const tdStatus = createEl("td");
        const avail = item.is_available !== false && (item.stock_quantity ?? 0) > 0;
        tdStatus.appendChild(
          createEl("span", "badge " + (avail ? "status-completed" : "status-cancelled"), avail ? "Đang mở bán" : "Tạm ngưng / Hết")
        );

        const tdAct = createEl("td");
        const pickBtn = createEl("button", "btn-sm" + (item.id === selectedOwnerProductId ? "" : " outline"), item.id === selectedOwnerProductId ? "Đang chọn" : "Chọn sửa");
        pickBtn.type = "button";
        pickBtn.addEventListener("click", () => {
          selectedOwnerProductId = item.id;
          renderOwnerCatalogPanel();
        });
        tdAct.appendChild(pickBtn);

        tr.append(tdSku, tdName, tdPrice, tdStock, tdStatus, tdAct);
        tbody.appendChild(tr);
      });
    }

    if (list.length === 0) {
      if (preview) preview.textContent = "Chưa có dữ liệu sản phẩm.";
      return;
    }

    const product = list.find((p) => p.id === selectedOwnerProductId) || list[0];
    selectedOwnerProductId = product.id;

    if (selectEl) {
      selectEl.replaceChildren();
      list.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name + " (" + fmtPrice(p.price) + "đ – kho " + String(p.stock_quantity) + ")";
        opt.selected = p.id === selectedOwnerProductId;
        selectEl.appendChild(opt);
      });
    }

    const priceEl = document.getElementById("ownerProdPrice");
    const stockEl = document.getElementById("ownerProdStock");
    const badgeEl = document.getElementById("ownerProdBadge");
    const availEl = document.getElementById("ownerProdAvailable");

    if (priceEl) priceEl.value = String(product.price ?? 119000);
    if (stockEl) stockEl.value = String(product.stock_quantity ?? 0);
    if (badgeEl) badgeEl.value = product.badge_text || "";
    if (availEl) availEl.checked = product.is_available !== false;

    if (preview) {
      preview.replaceChildren();
      preview.appendChild(createEl("strong", "", product.name + " (" + product.id + "): "));
      preview.appendChild(
        createEl(
          "span",
          "",
          fmtPrice(product.price) +
            "đ · Tồn kho: " +
            String(product.stock_quantity) +
            " hộp · Trạng thái: " +
            (product.is_available ? "Đang mở bán" : "Tạm ngưng bán")
        )
      );
    }
  }

  async function loadDashboardData() {
    const data = await auth.apiRequest("admin-api", {
      method: "GET",
      authRequired: true
    });
    dashboardState = data;
    if (data.actor) {
      auth.setCachedProfile({
        id: data.actor.id,
        email: data.actor.email,
        fullName: data.actor.fullName,
        role: data.actor.role
      });
    }
    renderHeaderAndKpis();
    renderOrdersTable();
    renderContactsTable();
    if (data.actor && data.actor.role === "admin") {
      renderUsersTable();
      renderOwnerCatalogPanel();
      renderAuditLogsTable();
      renderSecurityCenter();
    }
  }

  // Filters & Buttons
  document.getElementById("orderSearchInput")?.addEventListener("input", renderOrdersTable);
  document.getElementById("orderStatusFilter")?.addEventListener("change", renderOrdersTable);
  document.getElementById("contactStatusFilter")?.addEventListener("change", renderContactsTable);
  document.getElementById("userSearchInput")?.addEventListener("input", renderUsersTable);

  document.getElementById("newStaffRole")?.addEventListener("change", (event) => {
    const wrap = document.getElementById("newStaffPricePermWrap");
    const check = document.getElementById("newStaffCanEditPrice");
    const roleVal = event.target?.value || "staff";
    if (wrap) wrap.hidden = roleVal !== "manager";
    if (check && roleVal !== "manager") check.checked = false;
  });

  document.getElementById("ownerProdId")?.addEventListener("change", (event) => {
    selectedOwnerProductId = event.target.value || "drip-pack-001";
    renderOwnerCatalogPanel();
  });

  document.getElementById("ownerProductForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();
    const saveBtn = document.getElementById("ownerSaveProductBtn");
    const productId = (document.getElementById("ownerProdId")?.value || "drip-pack-001").trim();
    const price = Number.parseInt(document.getElementById("ownerProdPrice")?.value || "", 10);
    const stockQuantity = Number.parseInt(document.getElementById("ownerProdStock")?.value || "", 10);
    const badgeText = (document.getElementById("ownerProdBadge")?.value || "").trim();
    const isAvailable = Boolean(document.getElementById("ownerProdAvailable")?.checked);

    if (!Number.isInteger(price) || price < 10000 || price > 5000000) {
      showBanner("warning", "Đơn giá sản phẩm phải từ 10.000đ đến 5.000.000đ.");
      return;
    }
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 10000) {
      showBanner("warning", "Số lượng tồn kho phải từ 0 đến 10.000 hộp.");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Đang đồng bộ...";
    }
    try {
      await auth.apiRequest("admin-api", {
        method: "PATCH",
        authRequired: true,
        body: { action: "update_product", productId, price, stockQuantity, isAvailable, badgeText }
      });
      await loadDashboardData();
      showBanner("success", "Chủ cửa hàng đã cập nhật giá bán (" + fmtPrice(price) + "đ) & tồn kho (" + String(stockQuantity) + " hộp).");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể cập nhật sản phẩm.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Lưu Giá & Đồng bộ Cửa hàng";
      }
    }
  });

  document.getElementById("createUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();
    const btn = document.getElementById("createStaffBtn");
    const fullName = (document.getElementById("newStaffName")?.value || "").trim();
    const email = (document.getElementById("newStaffEmail")?.value || "").trim();
    const role = document.getElementById("newStaffRole")?.value || "staff";
    const password = document.getElementById("newStaffPassword")?.value || "";
    const canEditPrice = role === "admin"
      ? true
      : role === "manager"
        ? Boolean(document.getElementById("newStaffCanEditPrice")?.checked)
        : false;
    const minLen = role === "customer" ? 10 : 14;

    const strength = auth.evaluatePasswordStrength(password, email, { minLength: minLen });
    if (!strength.valid) {
      showBanner("warning", "Mật khẩu cho vai trò " + (ROLE_LABELS[role] || role) + " phải tối thiểu " + minLen + " ký tự và đủ 4 nhóm ký tự.");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Đang tạo...";
    }
    try {
      await auth.apiRequest("admin-api", {
        method: "PATCH",
        authRequired: true,
        body: { action: "create_user", fullName, email, role, password, canEditPrice }
      });
      document.getElementById("createUserForm").reset();
      const wrap = document.getElementById("newStaffPricePermWrap");
      if (wrap) wrap.hidden = true;
      showBanner("success", "Đã cấp tài khoản mới cho " + email + " (" + (ROLE_LABELS[role] || role) + ").");
      await loadDashboardData();
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể tạo tài khoản mới.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Tạo tài khoản nhân sự";
      }
    }
  });

  document.getElementById("toggleRequireMfaBtn")?.addEventListener("click", async () => {
    clearBanner();
    const btn = document.getElementById("toggleRequireMfaBtn");
    const nextValue = btn?.dataset.nextValue === "true";
    if (btn) btn.disabled = true;
    try {
      await auth.apiRequest("admin-api", {
        method: "PATCH",
        authRequired: true,
        body: { action: "update_security_policy", requireAdminMfa: nextValue }
      });
      await loadDashboardData();
      showBanner("success", nextValue ? "Đã bật chính sách bắt buộc 2FA (AAL2) cho toàn bộ nhân sự quản trị." : "Đã tắt chế độ ép buộc 2FA toàn cục.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể cập nhật chính sách 2FA.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("clearLockoutsBtn")?.addEventListener("click", async () => {
    clearBanner();
    const btn = document.getElementById("clearLockoutsBtn");
    if (btn) btn.disabled = true;
    try {
      const res = await auth.apiRequest("admin-api", {
        method: "PATCH",
        authRequired: true,
        body: { action: "unlock_lockouts" }
      });
      await loadDashboardData();
      showBanner("info", "Đã xóa " + String(res.clearedCount ?? 0) + " bộ đếm khóa Brute-force.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không mở khóa được bộ đếm.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("createBackupBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("createBackupBtn");
    clearBanner();
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Đang mã hóa AES-256...";
    }
    try {
      const res = await auth.apiRequest("admin-api", {
        method: "PATCH",
        authRequired: true,
        body: { action: "create_backup" }
      });
      if (res && res.snapshot && (res.encryptedEnvelope || res.payload)) {
        triggerJsonDownload(res.snapshot.filename, res.encryptedEnvelope || res.payload);
        showBanner(
          "success",
          "Đã tạo & tải bản sao lưu mã hóa " + res.snapshot.filename +
          " (SHA-256: " + String(res.snapshot.checksum_sha256 || "").slice(0, 16) + "…)."
        );
      }
      await loadDashboardData();
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể tạo bản sao lưu Snapshot.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Tạo Snapshot Mã hóa";
      }
    }
  });

  document.getElementById("securityChecklistForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const btn = document.getElementById("saveChecklistBtn");
    clearBanner();
    const checkedIds = Array.from(
      document.querySelectorAll('#securityChecklistItems input[name="checklistItem"]:checked')
    ).map((el) => el.value);

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Đang lưu...";
    }
    try {
      await auth.apiRequest("admin-api", {
        method: "PATCH",
        authRequired: true,
        body: { action: "save_checklist", checkedIds }
      });
      await loadDashboardData();
      showBanner("success", "Đã lưu trạng thái Checklist bảo mật định kỳ (" + checkedIds.length + " mục đạt).");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không lưu được trạng thái checklist.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Lưu trạng thái Checklist";
      }
    }
  });

  document.getElementById("adminRefreshBtn")?.addEventListener("click", async () => {
    clearBanner();
    try {
      await loadDashboardData();
      showBanner("info", "Đã làm mới dữ liệu quản trị.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể làm mới dữ liệu.");
    }
  });

  document.getElementById("adminLogoutBtn")?.addEventListener("click", async () => {
    if (stopIdleGuard) stopIdleGuard();
    await auth.signOut("local");
    window.location.href = "index.html";
  });

  // Boot
  (async function boot() {
    const guardLoader = document.getElementById("routeGuardLoader");
    auth.bindMobileNavbarToggle();

    const mode = await auth.initBackendMode();
    if (mode === "unconfigured") {
      if (guardLoader) guardLoader.hidden = true;
      showGateScreen(
        "Chưa cấu hình kết nối Supabase",
        "Vui lòng thiết lập supabaseUrl và supabaseAnonKey trong assets/js/config.js hoặc chạy máy chủ bảo mật cục bộ (npm start)."
      );
      return;
    }

    const token = await auth.getValidAccessToken();
    if (!token) {
      window.location.href = "login.html?next=admin.html";
      return;
    }

    auth.renderHeaderAuthState("headerAuthArea");

    try {
      await loadDashboardData();
      if (guardLoader) guardLoader.hidden = true;
      const timeoutMin = (window.RANG_MAY_CONFIG && window.RANG_MAY_CONFIG.adminIdleTimeoutMinutes) || 30;
      stopIdleGuard = auth.startIdleSessionGuard(timeoutMin, async () => {
        await auth.signOut("local");
        window.location.href = "login.html?next=admin.html";
      });
    } catch (error) {
      if (guardLoader) guardLoader.hidden = true;
      if (error && error.status === 401) {
        auth.clearSession();
        window.location.href = "login.html?next=admin.html";
        return;
      }
      if (error && error.code === "MFA_REQUIRED") {
        const primaryBtn = document.getElementById("adminGatePrimaryBtn");
        if (primaryBtn) {
          primaryBtn.href = "account.html";
          primaryBtn.textContent = "Đi tới Tài khoản & Bảo mật 2FA";
        }
        showGateScreen(
          "Bắt buộc xác thực 2 yếu tố (2FA)",
          "Hệ thống yêu cầu tài khoản Chủ cửa hàng phải xác thực 2FA (AAL2) bằng mã Authenticator hoặc mã khôi phục dự phòng trước khi truy cập. Hãy kiểm tra tại trang Tài khoản."
        );
        return;
      }
      if (error && error.status === 403) {
        const cachedRole = auth.getCachedProfile()?.role || "customer";
        const primaryBtn = document.getElementById("adminGatePrimaryBtn");
        let defaultMsg = "Trang này chỉ dành riêng cho Chủ cửa hàng (Admin).";
        if (primaryBtn) {
          if (cachedRole === "manager") {
            primaryBtn.href = "manager.html";
            primaryBtn.textContent = "Mở trang Quản lý cửa hàng (manager.html)";
            defaultMsg = "Bạn đang ở trang Chủ cửa hàng. Vai trò Quản lý cửa hàng có trang vận hành riêng tại manager.html.";
          } else if (cachedRole === "staff") {
            primaryBtn.href = "staff.html";
            primaryBtn.textContent = "Mở Bàn nhân viên xử lý đơn (staff.html)";
            defaultMsg = "Bạn đang ở trang Chủ cửa hàng. Vai trò Nhân viên xử lý đơn có bàn làm việc riêng tại staff.html.";
          } else {
            primaryBtn.href = "account.html";
            primaryBtn.textContent = "Về trang Tài khoản (account.html)";
          }
        }
        showGateScreen(
          "Không có quyền truy cập trang Chủ cửa hàng (403)",
          error.message || defaultMsg
        );
        return;
      }
      showBanner("error", error instanceof Error ? error.message : "Không tải được khu vực quản trị.");
    }
  })();
})();
