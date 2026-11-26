# Kết nối Rang Mây Coffee với Supabase (Auth + 2FA + RBAC + Đơn hàng)

Website hiện sử dụng kiến trúc tĩnh tách biệt JS/CSS theo **Content-Security-Policy (CSP)** nghiêm ngặt (không dùng `unsafe-inline`) kết hợp với **Supabase Auth** (đăng ký, đăng nhập, quên mật khẩu, xác thực 2 yếu tố TOTP 2FA) và **Supabase Edge Functions** để xử lý đơn hàng, danh mục sản phẩm, liên hệ, hồ sơ khách hàng và 3 cổng vận hành riêng theo 4 vai trò RBAC (`admin` tại `admin.html`, `manager` tại `manager.html`, `staff` tại `staff.html`, `customer` tại `account.html`).

---

## 1. Tạo dự án & đẩy Database Schema

1. Tạo project Supabase tại https://supabase.com/dashboard.
2. Cài Supabase CLI và đăng nhập: `supabase login`.
3. Tại thư mục dự án, liên kết project: `supabase link --project-ref <PROJECT_REF>`.
4. Chạy toàn bộ 8 tệp migration trong `supabase/migrations/` (gồm bảng `orders`, `contact_messages`, `profiles` kèm `can_edit_price`, `store_products`, `store_vouchers`, `security_audit_logs`, `rate_limit_events`, `security_checklists`, `backup_snapshots`, `security_policies`, trigger chống leo thang đặc quyền và RLS):
   ```powershell
   supabase db push
   ```
5. Trong **Project Settings → API**, lấy **Project URL** và **publishable/anon key** (khóa công khai; tuyệt đối KHÔNG dùng `service_role` ở frontend).

---

## 2. Cấu hình Authentication & 2FA trên Supabase Dashboard

1. Vào **Authentication → Providers → Email**:
   - Bật **Email** provider.
   - Bật **Confirm email** (bắt buộc người dùng xác minh email trước khi đăng nhập).
2. Vào **Authentication → Multi-Factor (MFA)**:
   - Bật **TOTP (App Authenticator)** để khách hàng và nhân sự có thể quét mã QR bật 2FA trong `account.html`.
3. Vào **Authentication → URL Configuration**:
   - Đặt **Site URL**: `https://nguyenducquan08022006-ai.github.io/rangmaycoffe` (hoặc custom domain thực tế của bạn).
   - Thêm vào **Redirect URLs**:
     - `https://nguyenducquan08022006-ai.github.io/rangmaycoffe/login.html`
     - `https://nguyenducquan08022006-ai.github.io/rangmaycoffe/account.html`

---

## 3. Cấu hình Secrets & Deploy Edge Functions

Thiết lập Secrets trên Supabase:

```powershell
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
supabase secrets set ALLOWED_ORIGINS=https://nguyenducquan08022006-ai.github.io
supabase secrets set RATE_LIMIT_SALT=<CHUOI_NGAU_NHIEN_DAI_32_KY_TU>
```

Tuỳ chọn bảo vệ nâng cao:

```powershell
# Bắt buộc tài khoản Admin/Staff phải xác thực 2FA (AAL2) mới gọi được admin-api
supabase secrets set REQUIRE_ADMIN_MFA=true

# Tùy chọn: Bật kiểm tra Cloudflare Turnstile cho create-order và create-contact
supabase secrets set TURNSTILE_SECRET_KEY=<CLOUDFLARE_TURNSTILE_SECRET>

# Tùy chọn: Kết nối thêm Gemini 2.5 Flash cho trợ lý Barista AI (nếu bỏ trống vẫn chạy động cơ NLU tiếng Việt nối CSDL trực tiếp)
supabase secrets set GEMINI_API_KEY=<GEMINI_API_KEY>
```

> **Lưu ý:** Nếu dùng custom domain hoặc chạy test local (ví dụ `http://127.0.0.1:5500`), liệt kê các origin hợp lệ cách nhau bằng dấu phẩy trong `ALLOWED_ORIGINS`. Không dùng `*`.

Deploy toàn bộ 9 Edge Functions:

```powershell
supabase functions deploy store-catalog
supabase functions deploy validate-voucher
supabase functions deploy barista-ai --no-verify-jwt
supabase functions deploy create-order
supabase functions deploy create-contact
supabase functions deploy account-api
supabase functions deploy admin-api
supabase functions deploy manager-api
supabase functions deploy staff-api
```

---

## 4. Cấu hình Frontend (`assets/js/config.js`)

Mở [assets/js/config.js](../assets/js/config.js) và điền **Project URL** và **publishable/anon key**:

```js
const config = Object.freeze({
  supabaseUrl: "https://<PROJECT_REF>.supabase.co",
  supabaseAnonKey: "<PUBLISHABLE_OR_ANON_KEY>",
  turnstileSiteKey: "",
  adminIdleTimeoutMinutes: 30
});
```

Không bao giờ đặt `service_role` key trong thư mục `assets/` hay file `.html`.

---

## 5. Cấp quyền Quản trị viên (Admin) đầu tiên

Mọi tài khoản đăng ký qua `login.html` mặc định được trigger gán vai trò `customer` (không thể tự sửa qua API do trigger `trg_prevent_profile_privilege_escalation` chặn mọi role không phải `service_role`).

Để phong **Admin đầu tiên**:

1. Đăng ký tài khoản bình thường tại `login.html` và xác minh email.
2. Vào **Supabase Dashboard → SQL Editor** và chạy:
   ```sql
   update public.profiles
   set role = 'admin', is_active = true
   where email = 'admin-cua-ban@example.com';
   ```
3. Đăng nhập lại tại `login.html`, vào `account.html` bật **2FA (TOTP)**, sau đó mở `admin.html` (Chủ cửa hàng) để giám sát an ninh, sao lưu 3-2-1 và phân quyền tài khoản `staff` / `manager` / `admin` ngay trên giao diện; các vai trò sẽ tự điều hướng sang trang riêng (`admin.html`, `manager.html`, `staff.html`, `account.html`).

---

## 6. Kiểm tra nghiệm thu

- Mở DevTools Console trên `index.html`, `login.html`, `account.html`, `admin.html`, `manager.html`, `staff.html`: **không có lỗi CSP**.
- Thử đăng ký mật khẩu yếu (dưới 10 ký tự hoặc thiếu ký tự đặc biệt): giao diện phải chặn.
- Đăng nhập tài khoản `customer` rồi mở `admin.html`, `manager.html` hoặc `staff.html`: các API `admin-api`, `manager-api`, `staff-api` trả về **HTTP 403** và giao diện từ chối truy cập.
- Cô lập 3 cổng vận hành: `staff` truy cập `manager-api`/`admin-api` trả **HTTP 403**, cố hủy đơn trên `staff-api` trả **HTTP 403 (`FORBIDDEN_ORDER_CANCEL`)**; `manager` truy cập `admin-api` hoặc gọi thao tác phân quyền/sao lưu trả **HTTP 403**.
- Bật `REQUIRE_ADMIN_MFA=true`, đăng nhập tài khoản quản trị/nhân sự chưa xác thực 2FA: API từ chối với mã `MFA_REQUIRED` cho tới khi hoàn tất bước TOTP (`AAL2`).
- Quản lý cập nhật giá/tồn kho qua `manager-api`: trang chủ gọi `store-catalog` cập nhật giá & tồn kho mới tức thì, `create-order` kiểm tra tồn kho và áp giá thực từ server.
- Gửi đơn hàng liên tiếp vượt 10 lần trong 10 phút từ 1 IP: trả về **HTTP 429**.
