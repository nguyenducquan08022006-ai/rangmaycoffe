(function initManagerPage() {
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

  let managerState = {
    actor: null,
    summary: {},
    catalog: [],
    vouchers: [],
    orders: [],
    contacts: [],
    staffRoster: []
  };

  let stopIdleGuard = null;
  const banner = document.getElementById("managerBanner");

  function normalizeVoucherCodeInput(raw) {
    return String(raw || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "D")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9_-]/g, "");
  }

  function showBanner(kind, message) {
    if (banner) {
      banner.className = "portal-banner " + kind;
      banner.textContent = message;
      banner.hidden = false;
    }
    const vchPanel = document.getElementById("panelVouchers");
    const vchNotice = document.getElementById("voucherFormNotice");
    if (vchNotice && vchPanel && !vchPanel.hidden) {
      vchNotice.className = "portal-banner " + kind + " admin-panel-spaced";
      vchNotice.textContent = message;
      vchNotice.hidden = false;
    }
  }

  function clearBanner() {
    if (banner) {
      banner.hidden = true;
      banner.textContent = "";
    }
    const vchNotice = document.getElementById("voucherFormNotice");
    if (vchNotice) {
      vchNotice.hidden = true;
      vchNotice.textContent = "";
    }
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

  function sanitizeCsvCell(value) {
    const str = String(value ?? "");
    const safe = /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
    return '"' + safe.replace(/"/g, '""') + '"';
  }

  function downloadOrdersCsv(orders) {
    const headers = [
      "Ma don hang",
      "Ngay tao",
      "Khach hang",
      "So dien thoai",
      "Email",
      "Dia chi giao hang",
      "San pham",
      "Ma voucher",
      "Giam gia (VND)",
      "Tong tien (VND)",
      "Thanh toan",
      "Trang thai",
      "Ghi chu noi bo"
    ];

    const rows = orders.map((order) => {
      const itemsText = Array.isArray(order.items)
        ? order.items.map(i => (i.name || i.id) + " x " + i.quantity).join("; ")
        : "";
      return [
        sanitizeCsvCell(order.order_number || ""),
        sanitizeCsvCell(order.created_at || ""),
        sanitizeCsvCell(order.customer_name || ""),
        sanitizeCsvCell(order.customer_phone || ""),
        sanitizeCsvCell(order.customer_email || ""),
        sanitizeCsvCell(order.shipping_address || ""),
        sanitizeCsvCell(itemsText),
        sanitizeCsvCell(order.voucher_code || ""),
        sanitizeCsvCell(order.discount_amount ?? 0),
        sanitizeCsvCell(order.total_amount ?? 0),
        sanitizeCsvCell(order.payment_method || "COD"),
        sanitizeCsvCell(ORDER_STATUS_LABELS[order.status] || order.status || ""),
        sanitizeCsvCell(order.internal_note || "")
      ].join(",");
    });

    const csvContent = "\uFEFF" + headers.map(sanitizeCsvCell).join(",") + "\r\n" + rows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rangmay-orders-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showGateScreen(title, message) {
    document.getElementById("managerHeaderCard").hidden = true;
    document.getElementById("managerKpiGrid").hidden = true;
    document.getElementById("managerWorkspaceCard").hidden = true;
    const gateCard = document.getElementById("managerGateCard");
    if (gateCard) gateCard.hidden = false;
    const gateTitle = document.getElementById("managerGateTitle");
    const gateMessage = document.getElementById("managerGateMessage");
    if (gateTitle) gateTitle.textContent = title;
    if (gateMessage) gateMessage.textContent = message;
  }

  function switchTab(tabName) {
    document.querySelectorAll("[data-manager-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.managerTab === tabName);
    });
    document.getElementById("panelOrders").hidden = tabName !== "orders";
    document.getElementById("panelCatalog").hidden = tabName !== "catalog";
    const panelVouchers = document.getElementById("panelVouchers");
    if (panelVouchers) panelVouchers.hidden = tabName !== "vouchers";
    document.getElementById("panelContacts").hidden = tabName !== "contacts";
    document.getElementById("panelTeam").hidden = tabName !== "team";
  }

  document.querySelectorAll("[data-manager-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.managerTab));
  });

  function renderHeaderAndKpis() {
    const actor = managerState.actor;
    const summary = managerState.summary || {};
    const primaryProduct = (managerState.catalog || [])[0];

    document.getElementById("managerGateCard").hidden = true;
    document.getElementById("managerHeaderCard").hidden = false;
    document.getElementById("managerKpiGrid").hidden = false;
    document.getElementById("managerWorkspaceCard").hidden = false;

    document.getElementById("managerActorEmail").textContent = actor.email;

    const roleBadge = document.getElementById("managerRoleBadge");
    roleBadge.className = "badge role-" + actor.role;
    roleBadge.textContent = ROLE_LABELS[actor.role] || actor.role;

    const pricePermBadge = document.getElementById("managerPricePermBadge");
    if (pricePermBadge) {
      const hasPricePerm = Boolean(actor.canEditPrice);
      pricePermBadge.className = "badge " + (hasPricePerm ? "status-completed" : "status-warn");
      pricePermBadge.textContent = hasPricePerm ? "Quyền sửa giá: Đã cấp" : "Quyền sửa giá: Đang khóa";
    }

    const aalBadge = document.getElementById("managerAalBadge");
    aalBadge.className = "badge " + (actor.aal === "aal2" ? "aal-2" : "aal-1");
    aalBadge.textContent = actor.aal === "aal2" ? "2FA AAL2" : "Chưa qua 2FA (AAL1)";

    const ownerShortcut = document.getElementById("ownerPortalShortcut");
    if (ownerShortcut) {
      ownerShortcut.hidden = actor.role !== "admin";
    }

    if (actor.aal !== "aal2") {
      showBanner(
        "warning",
        "Khuyến nghị bảo mật: Tài khoản Quản lý cửa hàng nên bật xác thực 2 yếu tố (2FA) tại trang Tài khoản."
      );
    }

    document.getElementById("kpiRevenue").textContent = fmtPrice(summary.totalRevenue ?? 0) + "đ";
    document.getElementById("kpiTotalOrders").textContent = String(summary.totalOrders ?? 0);
    document.getElementById("kpiPendingOrders").textContent = String(summary.pendingOrders ?? 0);
    const totalStock = typeof summary.totalStock === "number"
      ? summary.totalStock
      : (managerState.catalog || []).reduce((acc, p) => acc + (Number(p.stock_quantity) || 0), 0);
    document.getElementById("kpiProductStock").textContent = String(totalStock) + " hộp";
    document.getElementById("kpiNewContacts").textContent = String(summary.newContacts ?? 0);
  }

  function renderOrdersTable() {
    const tbody = document.getElementById("managerOrdersBody");
    const search = (document.getElementById("orderSearchInput")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    if (!tbody) return;

    tbody.replaceChildren();
    const filtered = (managerState.orders || []).filter((order) => {
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
      noteInput.placeholder = "Ghi chú / lý do hủy (nếu có)...";
      noteInput.value = order.internal_note || "";

      const saveBtn = createEl("button", "btn-sm", "Lưu đơn");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Đang lưu...";
        try {
          await auth.apiRequest("manager-api", {
            method: "PATCH",
            authRequired: true,
            body: {
              action: "update_order",
              orderId: order.id,
              status: statusSelect.value,
              internalNote: noteInput.value
            }
          });
          showBanner("success", "Đã cập nhật đơn " + order.order_number + " thành trạng thái: " + (ORDER_STATUS_LABELS[statusSelect.value] || statusSelect.value) + ".");
          await loadManagerData();
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

  let selectedManagerProductId = "drip-pack-001";

  function renderCatalogPanel() {
    const list = Array.isArray(managerState.catalog) ? managerState.catalog : [];
    const preview = document.getElementById("catalogLivePreview");
    const tbody = document.getElementById("managerCatalogBody");
    const selectEl = document.getElementById("prodId");

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
        const pickBtn = createEl("button", "btn-sm" + (item.id === selectedManagerProductId ? "" : " outline"), item.id === selectedManagerProductId ? "Đang chọn" : "Chọn sửa");
        pickBtn.type = "button";
        pickBtn.addEventListener("click", () => {
          selectedManagerProductId = item.id;
          renderCatalogPanel();
        });
        tdAct.appendChild(pickBtn);

        tr.append(tdSku, tdName, tdPrice, tdStock, tdStatus, tdAct);
        tbody.appendChild(tr);
      });
    }

    if (list.length === 0) {
      if (preview) preview.textContent = "Chưa có dữ liệu sản phẩm trong danh mục.";
      return;
    }

    const product = list.find((p) => p.id === selectedManagerProductId) || list[0];
    selectedManagerProductId = product.id;

    if (selectEl) {
      selectEl.replaceChildren();
      list.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name + " (" + fmtPrice(p.price) + "đ – kho " + String(p.stock_quantity) + ")";
        opt.selected = p.id === selectedManagerProductId;
        selectEl.appendChild(opt);
      });
    }

    const priceEl = document.getElementById("prodPrice");
    const stockEl = document.getElementById("prodStock");
    const badgeEl = document.getElementById("prodBadge");
    const availEl = document.getElementById("prodAvailable");
    const hasPricePerm = Boolean(managerState.actor?.canEditPrice);
    const permNotice = document.getElementById("pricePermNotice");
    const permNoticeText = document.getElementById("pricePermNoticeText");

    if (priceEl) {
      priceEl.value = String(product.price ?? 119000);
      priceEl.readOnly = !hasPricePerm;
      priceEl.classList.toggle("input-locked", !hasPricePerm);
    }
    if (permNotice && permNoticeText) {
      permNotice.className = "portal-banner " + (hasPricePerm ? "info" : "warning");
      permNoticeText.textContent = hasPricePerm
        ? "✓ Bạn đã được cấp Quyền sửa giá bán: Có thể điều chỉnh Giá bán niêm yết, Tồn kho, Nhãn và Trạng thái mở bán cho cả 4 dòng sản phẩm."
        : "🔒 Ô Giá bán đang khóa theo phân quyền RBAC: Tài khoản Quản lý này chưa được Chủ cửa hàng cấp 'Quyền sửa giá'. Bạn vẫn được phép cập nhật Tồn kho, Nhãn giới thiệu và Mở/Tạm ngưng bán cho từng dòng.";
    }
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
      if (product.updated_at) {
        preview.appendChild(
          createEl(
            "span",
            "table-subtext",
            "Cập nhật lần cuối: " + fmtDate(product.updated_at) + (product.updated_by ? " bởi " + product.updated_by : "")
          )
        );
      }
    }
  }

  function renderContactsTable() {
    const tbody = document.getElementById("managerContactsBody");
    const statusFilter = document.getElementById("contactStatusFilter")?.value || "all";
    if (!tbody) return;

    tbody.replaceChildren();
    const filtered = (managerState.contacts || []).filter((c) => {
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
          await auth.apiRequest("manager-api", {
            method: "PATCH",
            authRequired: true,
            body: {
              action: "update_contact",
              contactId: contact.id,
              status: statusSelect.value
            }
          });
          showBanner("success", "Đã cập nhật trạng thái liên hệ.");
          await loadManagerData();
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

  function renderTeamTable() {
    const tbody = document.getElementById("managerTeamBody");
    if (!tbody) return;

    tbody.replaceChildren();
    const roster = managerState.staffRoster || [];
    if (roster.length === 0) {
      const tr = document.createElement("tr");
      const td = createEl("td", "empty-state", "Chưa có tài khoản nhân viên xử lý đơn.");
      td.colSpan = 3;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    roster.forEach((member) => {
      const tr = document.createElement("tr");

      const tdInfo = createEl("td");
      tdInfo.appendChild(createEl("strong", "", member.full_name || member.email));
      tdInfo.appendChild(createEl("span", "table-subtext", member.email || ""));

      const tdActive = createEl("td");
      tdActive.appendChild(
        createEl(
          "span",
          "badge " + (member.is_active !== false ? "status-completed" : "status-cancelled"),
          member.is_active !== false ? "Đang hoạt động" : "Đang khóa"
        )
      );

      const tdMfa = createEl("td");
      tdMfa.appendChild(
        createEl(
          "span",
          "badge " + (member.has_2fa ? "aal-2" : "aal-1"),
          member.has_2fa ? "Đã bật 2FA" : "Chưa bật 2FA"
        )
      );

      tr.append(tdInfo, tdActive, tdMfa);
      tbody.appendChild(tr);
    });
  }

  async function loadManagerData() {
    const data = await auth.apiRequest("manager-api", {
      method: "GET",
      authRequired: true
    });
    managerState = data;
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
    renderCatalogPanel();
    renderVouchersPanel();
    renderContactsTable();
    renderTeamTable();
  }

  function renderVouchersPanel() {
    const tbody = document.getElementById("managerVouchersBody");
    if (!tbody) return;

    tbody.replaceChildren();
    const list = managerState.vouchers || [];
    if (list.length === 0) {
      const tr = document.createElement("tr");
      const td = createEl("td", "empty-state", "Chưa có mã giảm giá nào.");
      td.colSpan = 6;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    list.forEach((v) => {
      const tr = document.createElement("tr");

      const tdCode = createEl("td");
      tdCode.appendChild(createEl("strong", "", v.code));
      if (v.description) {
        tdCode.appendChild(createEl("span", "table-subtext", v.description));
      }

      const discountLabel = v.discount_type === "percent"
        ? "Giảm " + String(v.discount_value) + "%" + (v.max_discount_amount ? " (tối đa " + fmtPrice(v.max_discount_amount) + "đ)" : "")
        : "Giảm " + fmtPrice(v.discount_value) + "đ";
      const tdDiscount = createEl("td", "", discountLabel);

      const tdMin = createEl("td", "", fmtPrice(v.min_order_amount || 0) + "đ");
      const tdUsage = createEl("td", "", String(v.used_count ?? 0) + " / " + String(v.usage_limit ?? 0));

      const tdStatus = createEl("td");
      tdStatus.appendChild(
        createEl(
          "span",
          "badge " + (v.is_active ? "status-completed" : "status-cancelled"),
          v.is_active ? "Đang bật" : "Tạm ngưng"
        )
      );

      const tdActions = createEl("td");
      const btnRow = createEl("div", "backup-actions-row");

      const editBtn = createEl("button", "btn-sm outline", "Sửa");
      editBtn.type = "button";
      editBtn.addEventListener("click", () => {
        document.getElementById("vchCode").value = v.code;
        document.getElementById("vchType").value = v.discount_type;
        document.getElementById("vchValue").value = String(v.discount_value);
        document.getElementById("vchMinOrder").value = String(v.min_order_amount || 0);
        document.getElementById("vchMaxDiscount").value = v.max_discount_amount ? String(v.max_discount_amount) : "";
        document.getElementById("vchLimit").value = String(v.usage_limit || 100);
        document.getElementById("vchDesc").value = v.description || "";
        document.getElementById("vchActive").checked = Boolean(v.is_active);
        showBanner("info", "Đang nạp mã " + v.code + " lên biểu mẫu để chỉnh sửa.");
      });

      const toggleBtn = createEl("button", "btn-sm outline", v.is_active ? "Tạm tắt" : "Bật lại");
      toggleBtn.type = "button";
      toggleBtn.addEventListener("click", async () => {
        toggleBtn.disabled = true;
        try {
          await auth.apiRequest("manager-api", {
            method: "PATCH",
            authRequired: true,
            body: { action: "toggle_voucher", code: v.code, isActive: !v.is_active }
          });
          await loadManagerData();
          showBanner("success", (v.is_active ? "Đã tạm ngưng mã " : "Đã bật lại mã ") + v.code + ".");
        } catch (error) {
          showBanner("error", error instanceof Error ? error.message : "Không thể đổi trạng thái voucher.");
        } finally {
          toggleBtn.disabled = false;
        }
      });

      const delBtn = createEl("button", "btn-sm danger", "Xóa");
      delBtn.type = "button";
      delBtn.addEventListener("click", async () => {
        delBtn.disabled = true;
        try {
          await auth.apiRequest("manager-api", {
            method: "PATCH",
            authRequired: true,
            body: { action: "delete_voucher", code: v.code }
          });
          await loadManagerData();
          showBanner("info", "Đã xóa mã voucher " + v.code + ".");
        } catch (error) {
          showBanner("error", error instanceof Error ? error.message : "Không thể xóa voucher.");
        } finally {
          delBtn.disabled = false;
        }
      });

      btnRow.append(editBtn, toggleBtn, delBtn);
      tdActions.appendChild(btnRow);

      tr.append(tdCode, tdDiscount, tdMin, tdUsage, tdStatus, tdActions);
      tbody.appendChild(tr);
    });
  }

  document.getElementById("orderSearchInput")?.addEventListener("input", renderOrdersTable);
  document.getElementById("orderStatusFilter")?.addEventListener("change", renderOrdersTable);
  document.getElementById("contactStatusFilter")?.addEventListener("change", renderContactsTable);

  document.getElementById("exportOrdersCsvBtn")?.addEventListener("click", () => {
    clearBanner();
    const orders = managerState.orders || [];
    if (orders.length === 0) {
      showBanner("warning", "Chưa có đơn hàng nào để xuất báo cáo CSV.");
      return;
    }
    downloadOrdersCsv(orders);
    showBanner("success", "Đã xuất " + String(orders.length) + " đơn hàng ra tệp CSV (an toàn công thức).");
  });

  document.getElementById("prodId")?.addEventListener("change", (event) => {
    selectedManagerProductId = event.target.value || "drip-pack-001";
    renderCatalogPanel();
  });

  document.getElementById("productForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();
    const saveBtn = document.getElementById("saveProductBtn");
    const productId = (document.getElementById("prodId")?.value || "drip-pack-001").trim();
    const price = Number.parseInt(document.getElementById("prodPrice")?.value || "", 10);
    const stockQuantity = Number.parseInt(document.getElementById("prodStock")?.value || "", 10);
    const badgeText = (document.getElementById("prodBadge")?.value || "").trim();
    const isAvailable = Boolean(document.getElementById("prodAvailable")?.checked);

    if (!Number.isInteger(price) || price < 10000 || price > 5000000) {
      showBanner("warning", "Đơn giá sản phẩm phải từ 10.000đ đến 5.000.000đ.");
      return;
    }
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 10000) {
      showBanner("warning", "Số lượng tồn kho phải là số nguyên từ 0 đến 10.000.");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Đang đồng bộ...";
    }
    try {
      await auth.apiRequest("manager-api", {
        method: "PATCH",
        authRequired: true,
        body: {
          action: "update_product",
          productId,
          price,
          stockQuantity,
          isAvailable,
          badgeText
        }
      });
      await loadManagerData();
      showBanner("success", "Đã lưu giá bán (" + fmtPrice(price) + "đ) & tồn kho (" + String(stockQuantity) + " hộp) đồng bộ lên Cửa hàng.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể cập nhật sản phẩm.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Lưu & Đồng bộ Cửa hàng";
      }
    }
  });

  document.getElementById("resetVoucherFormBtn")?.addEventListener("click", () => {
    document.getElementById("voucherForm")?.reset();
    const minEl = document.getElementById("vchMinOrder");
    const limEl = document.getElementById("vchLimit");
    const actEl = document.getElementById("vchActive");
    if (minEl) minEl.value = "100000";
    if (limEl) limEl.value = "100";
    if (actEl) actEl.checked = true;
  });

  document.getElementById("vchCode")?.addEventListener("blur", (event) => {
    const el = event.target;
    if (el && typeof el.value === "string" && el.value.trim()) {
      el.value = normalizeVoucherCodeInput(el.value);
    }
  });

  document.getElementById("voucherForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBanner();
    const saveBtn = document.getElementById("saveVoucherBtn");
    const codeInputEl = document.getElementById("vchCode");
    const code = normalizeVoucherCodeInput(codeInputEl?.value || "");
    if (codeInputEl) codeInputEl.value = code;
    const discountType = document.getElementById("vchType")?.value || "percent";
    const discountValue = Number.parseInt(document.getElementById("vchValue")?.value || "", 10);
    const minOrderAmount = Number.parseInt(document.getElementById("vchMinOrder")?.value || "0", 10);
    const maxRaw = (document.getElementById("vchMaxDiscount")?.value || "").trim();
    const maxDiscountAmount = maxRaw ? Number.parseInt(maxRaw, 10) : null;
    const usageLimit = Number.parseInt(document.getElementById("vchLimit")?.value || "100", 10);
    const description = (document.getElementById("vchDesc")?.value || "").trim();
    const isActive = Boolean(document.getElementById("vchActive")?.checked);

    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
      showBanner("warning", "Mã Voucher phải từ 3–24 ký tự chữ hoặc số (VD: TET2027).");
      return;
    }
    if (discountType === "percent" && (!Number.isInteger(discountValue) || discountValue < 1 || discountValue > 90)) {
      showBanner("warning", "Mức giảm theo phần trăm (%) phải từ 1% đến 90%.");
      return;
    }
    if (discountType === "fixed" && (!Number.isInteger(discountValue) || discountValue < 1000 || discountValue > 2000000)) {
      showBanner("warning", "Mức giảm tiền cố định (VND) phải từ 1.000đ đến 2.000.000đ.");
      return;
    }
    if (discountType === "percent" && maxDiscountAmount !== null && (!Number.isInteger(maxDiscountAmount) || maxDiscountAmount < 1000 || maxDiscountAmount > 2000000)) {
      showBanner("warning", "Mức giảm tối đa (VND) phải từ 1.000đ đến 2.000.000đ (hoặc để trống nếu không giới hạn).");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Đang lưu...";
    }
    try {
      await auth.apiRequest("manager-api", {
        method: "PATCH",
        authRequired: true,
        body: {
          action: "upsert_voucher",
          code,
          discountType,
          discountValue,
          minOrderAmount,
          maxDiscountAmount: discountType === "percent" ? maxDiscountAmount : null,
          usageLimit,
          description,
          isActive
        }
      });
      document.getElementById("voucherForm")?.reset();
      document.getElementById("vchMinOrder").value = "100000";
      document.getElementById("vchLimit").value = "100";
      document.getElementById("vchActive").checked = true;
      await loadManagerData();
      showBanner("success", "Đã lưu mã giảm giá " + code + " đồng bộ lên Cửa hàng.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể lưu mã giảm giá.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Lưu Mã Voucher";
      }
    }
  });

  document.getElementById("managerRefreshBtn")?.addEventListener("click", async () => {
    clearBanner();
    try {
      await loadManagerData();
      showBanner("info", "Đã làm mới dữ liệu Quản lý cửa hàng.");
    } catch (error) {
      showBanner("error", error instanceof Error ? error.message : "Không thể làm mới dữ liệu.");
    }
  });

  document.getElementById("managerLogoutBtn")?.addEventListener("click", async () => {
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
      window.location.href = "login.html?next=manager.html";
      return;
    }

    auth.renderHeaderAuthState("headerAuthArea");

    try {
      await loadManagerData();
      if (guardLoader) guardLoader.hidden = true;
      const timeoutMin = (window.RANG_MAY_CONFIG && window.RANG_MAY_CONFIG.adminIdleTimeoutMinutes) || 30;
      stopIdleGuard = auth.startIdleSessionGuard(timeoutMin, async () => {
        await auth.signOut("local");
        window.location.href = "login.html?next=manager.html";
      });
    } catch (error) {
      if (guardLoader) guardLoader.hidden = true;
      if (error && error.status === 401) {
        auth.clearSession();
        window.location.href = "login.html?next=manager.html";
        return;
      }
      if (error && error.code === "MFA_REQUIRED") {
        const primaryBtn = document.getElementById("managerGatePrimaryBtn");
        if (primaryBtn) {
          primaryBtn.href = "account.html";
          primaryBtn.textContent = "Đi tới Tài khoản & Bảo mật 2FA";
        }
        showGateScreen(
          "Bắt buộc xác thực 2 yếu tố (2FA)",
          "Tài khoản Quản lý cửa hàng phải xác thực 2FA (AAL2) trước khi truy cập trang vận hành."
        );
        return;
      }
      if (error && error.status === 403) {
        const cachedRole = auth.getCachedProfile()?.role || "customer";
        const primaryBtn = document.getElementById("managerGatePrimaryBtn");
        let defaultMsg = "Trang này chỉ dành cho Quản lý cửa hàng hoặc Chủ cửa hàng.";
        if (primaryBtn) {
          if (cachedRole === "staff") {
            primaryBtn.href = "staff.html";
            primaryBtn.textContent = "Mở Bàn nhân viên xử lý đơn (staff.html)";
            defaultMsg = "Bạn thuộc nhóm Nhân viên xử lý đơn, vui lòng sử dụng Bàn nhân viên tại staff.html.";
          } else {
            primaryBtn.href = "account.html";
            primaryBtn.textContent = "Về trang Tài khoản (account.html)";
          }
        }
        showGateScreen(
          "Không có quyền truy cập trang Quản lý (403)",
          error.message || defaultMsg
        );
        return;
      }
      showBanner("error", error instanceof Error ? error.message : "Không tải được khu vực Quản lý cửa hàng.");
    }
  })();
})();
