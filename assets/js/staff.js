(function initStaffPage() {
  "use strict";

  const auth = window.RangMayAuth;
  if (!auth) return;

  const ROLE_LABELS = {
    admin: "Chủ cửa hàng",
    manager: "Quản lý cửa hàng",
    staff: "Nhân viên",
    customer: "Khách hàng"
  };

  const ALL_ORDER_STATUS_LABELS = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    shipped: "Đang giao",
    completed: "Hoàn tất",
    cancelled: "Đã hủy"
  };

  const STAFF_EDITABLE_STATUSES = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    shipped: "Đang giao",
    completed: "Hoàn tất"
  };

  const CONTACT_STATUS_LABELS = {
    new: "Mới tiếp nhận",
    in_progress: "Đang xử lý",
    resolved: "Đã phản hồi"
  };

  let staffState = {
    actor: null,
    summary: {},
    orders: [],
    contacts: []
  };

  let stopIdleGuard = null;
  const banner = document.getElementById("staffBanner");

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
    document.getElementById("staffHeaderCard").hidden = true;
    document.getElementById("staffKpiGrid").hidden = true;
    document.getElementById("staffWorkspaceCard").hidden = true;
    const gateCard = document.getElementById("staffGateCard");
    if (gateCard) gateCard.hidden = false;
    const gateTitle = document.getElementById("staffGateTitle");
    const gateMessage = document.getElementById("staffGateMessage");
    if (gateTitle) gateTitle.textContent = title;
    if (gateMessage) gateMessage.textContent = message;
  }

  function switchTab(tabName) {
    document.querySelectorAll("[data-staff-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.staffTab === tabName);
    });
    document.getElementById("panelOrders").hidden = tabName !== "orders";
    document.getElementById("panelContacts").hidden = tabName !== "contacts";
  }

  document.querySelectorAll("[data-staff-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.staffTab));
  });

  function renderHeaderAndKpis() {
    const actor = staffState.actor;
    const summary = staffState.summary || {};

    document.getElementById("staffGateCard").hidden = true;
    document.getElementById("staffHeaderCard").hidden = false;
    document.getElementById("staffKpiGrid").hidden = false;
    document.getElementById("staffWorkspaceCard").hidden = false;

    document.getElementById("staffActorEmail").textContent = actor.email;

    const roleBadge = document.getElementById("staffRoleBadge");
    roleBadge.className = "badge role-" + actor.role;
    roleBadge.textContent = ROLE_LABELS[actor.role] || actor.role;

    const aalBadge = document.getElementById("staffAalBadge");
    aalBadge.className = "badge " + (actor.aal === "aal2" ? "aal-2" : "aal-1");
    aalBadge.textContent = actor.aal === "aal2" ? "2FA AAL2" : "Chưa qua 2FA (AAL1)";

    const toManagerBtn = document.getElementById("staffToManagerBtn");
    if (toManagerBtn) {
      toManagerBtn.hidden = !(actor.role === "admin" || actor.role === "manager");
    }
    const toAdminBtn = document.getElementById("staffToAdminBtn");
    if (toAdminBtn) {
      toAdminBtn.hidden = actor.role !== "admin";
    }

    if (actor.aal !== "aal2") {
      showBanner(
        "warning",
        "Khuyến nghị bảo mật: Tài khoản Nhân viên nên bật xác thực 2 yếu tố (2FA) tại trang Tài khoản."
      );
    }

    document.getElementById("kpiPendingOrders").textContent = String(summary.pendingOrders ?? 0);
    document.getElementById("kpiConfirmedOrders").textContent = String(summary.confirmedOrders ?? 0);
    document.getElementById("kpiShippedOrders").textContent = String(summary.shippedOrders ?? 0);
    document.getElementById("kpiNewContacts").textContent = String(summary.newContacts ?? 0);
  }

  function renderOrdersTable() {
    const tbody = document.getElementById("staffOrdersBody");
    const search = (document.getElementById("orderSearchInput")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    if (!tbody) return;

    tbody.replaceChildren();
    const filtered = (staffState.orders || []).filter((order) => {
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

    const actorRole = staffState.actor?.role || "staff";
    const isSupervisor = actorRole === "admin" || actorRole === "manager";

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
      tdStatus.appendChild(createEl("span", "badge status-" + st, ALL_ORDER_STATUS_LABELS[st] || st));

      const tdActions = createEl("td");
      if (!isSupervisor && st === "cancelled") {
        const ro = createEl(
          "div",
          "staff-readonly-note",
          "Đơn đã hủy – Chỉ Quản lý cửa hàng hoặc Chủ cửa hàng mới được thao tác lại."
        );
        tdActions.appendChild(ro);
      } else {
        const stack = createEl("div", "inline-control-stack");
        const statusSelect = document.createElement("select");
        const statusMap = isSupervisor ? ALL_ORDER_STATUS_LABELS : STAFF_EDITABLE_STATUSES;
        Object.entries(statusMap).forEach(([val, label]) => {
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = label;
          opt.selected = val === st;
          statusSelect.appendChild(opt);
        });

        const noteInput = document.createElement("input");
        noteInput.type = "text";
        noteInput.maxLength = 1000;
        noteInput.placeholder = "Ghi chú đóng gói / vận chuyển...";
        noteInput.value = order.internal_note || "";

        const saveBtn = createEl("button", "btn-sm", "Cập nhật xử lý");
        saveBtn.type = "button";
        saveBtn.addEventListener("click", async () => {
          saveBtn.disabled = true;
          saveBtn.textContent = "Đang lưu...";
          try {
            await auth.apiRequest("staff-api", {
              method: "PATCH",
              authRequired: true,
              body: {
                action: "update_order",
                orderId: order.id,
                status: statusSelect.value,
                internalNote: noteInput.value
              }
            });
            showBanner("success", "Đã cập nhật tiến độ đơn " + order.order_number + ".");
            await loadStaffData();
          } catch (error) {
            showBanner("error", error instanceof Error ? error.message : "Không cập nhật được đơn hàng.");
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Cập nhật xử lý";
          }
        });

        stack.append(statusSelect, noteInput, saveBtn);
        tdActions.appendChild(stack);
      }

      tr.append(tdOrder, tdCustomer, tdItems, tdStatus, tdActions);
      tbody.appendChild(tr);
    });
  }

  function renderContactsTable() {
    const tbody = document.getElementById("staffContactsBody");
    const statusFilter = document.getElementById("contactStatusFilter")?.value || "all";
    if (!tbody) return;

    tbody.replaceChildren();
    const filtered = (staffState.contacts || []).filter((c) => {
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
          await auth.apiRequest("staff-api", {
            method: "PATCH",
            authRequired: true,
            body: {
              action: "update_contact",
              contactId: contact.id,
              status: statusSelect.value
            }
          });
          showBanner("success", "Đã cập nhật trạng thái liên hệ.");
          await loadStaffData();
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

  async function loadStaffData() {
    const data = await auth.apiRequest("staff-api", {
      method: "GET",
      authRequired: true
    });
    staffState = data;
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
  }

  document.getElementById("orderSearchInput")?.addEventListener("input", renderOrdersTable);
  document.getElementById("orderStatusFilter")?.addEventListener("change", renderOrdersTable);
  document.getElementById("contactStatusFilter")?.addEventListener("change", renderContactsTable);

  document.getElementById("staffRefreshBtn")?.addEventListener("click", async () => {
    clearBanner();
    try {
      await loadStaffData();
      showBanner("info", "Đã làm mới hàng đợi đơn hàng.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể làm mới dữ liệu.");
    }
  });

  document.getElementById("staffLogoutBtn")?.addEventListener("click", async () => {
    if (stopIdleGuard) stopIdleGuard();
    await auth.signOut("local");
    window.location.href = "index.html";
  });

  (async function boot() {
    const guardLoader = document.getElementById("routeGuardLoader");
    auth.bindMobileNavbarToggle();

    const mode = await auth.initBackendMode();
    if (mode === "unconfigured") {
      if (guardLoader) guardLoader.hidden = true;
      showGateScreen(
        "Chưa cấu hình kết nối máy chủ",
        "Vui lòng thiết lập cấu hình Supabase hoặc chạy máy chủ bảo mật cục bộ (npm start)."
      );
      return;
    }

    const token = await auth.getValidAccessToken();
    if (!token) {
      window.location.href = "login.html?next=staff.html";
      return;
    }

    auth.renderHeaderAuthState("headerAuthArea");

    try {
      await loadStaffData();
      if (guardLoader) guardLoader.hidden = true;
      const timeoutMin = (window.RANG_MAY_CONFIG && window.RANG_MAY_CONFIG.adminIdleTimeoutMinutes) || 30;
      stopIdleGuard = auth.startIdleSessionGuard(timeoutMin, async () => {
        await auth.signOut("local");
        window.location.href = "login.html?next=staff.html";
      });
    } catch (error) {
      if (guardLoader) guardLoader.hidden = true;
      if (error && error.status === 401) {
        auth.clearSession();
        window.location.href = "login.html?next=staff.html";
        return;
      }
      if (error && error.code === "MFA_REQUIRED") {
        const primaryBtn = document.getElementById("staffGatePrimaryBtn");
        if (primaryBtn) {
          primaryBtn.href = "account.html";
          primaryBtn.textContent = "Đi tới Tài khoản & Bảo mật 2FA";
        }
        showGateScreen(
          "Bắt buộc xác thực 2 yếu tố (2FA)",
          "Tài khoản Nhân viên xử lý đơn phải xác thực 2FA (AAL2) trước khi truy cập hàng đợi đơn hàng."
        );
        return;
      }
      if (error && error.status === 403) {
        const primaryBtn = document.getElementById("staffGatePrimaryBtn");
        if (primaryBtn) {
          primaryBtn.href = "account.html";
          primaryBtn.textContent = "Về trang Tài khoản (account.html)";
        }
        showGateScreen(
          "Không có quyền truy cập Bàn nhân viên (403)",
          error.message || "Tài khoản Khách hàng không được phép truy cập khu vực xử lý đơn nội bộ."
        );
        return;
      }
      showBanner("error", error instanceof Error ? error.message : "Không tải được Bàn làm việc Nhân viên.");
    }
  })();
})();
