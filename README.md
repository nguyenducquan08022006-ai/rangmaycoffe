# ☕ Rang Mây Coffee — Website Thương Mại Điện Tử & Bảo Mật 5 Trụ Cột

Website thương mại điện tử chuyên doanh **Cà phê Phin Giấy Đặc Sản Măng Đen – Kon Tum**, được thiết kế với kiến trúc **Bảo mật 5 trụ cột** (Mật khẩu mạnh & 2FA TOTP, Chứng chỉ SSL/HTTPS & Strict CSP, Phân quyền RBAC 4 cổng riêng biệt, Sao lưu 3-2-1 mã hóa AES-256-GCM & Restore Drill, Checklist bảo mật định kỳ), tích hợp **Trợ lý Barista AI** theo thời gian thực và **Cẩm nang chuẩn SEO On-Page**.

---

## 🌐 Đường dẫn Truy cập Trực tiếp (Live 24/7 trên GitHub Pages + Supabase Cloud)

- 🏠 **Trang chủ Cửa hàng (Bộ sưu tập 4 vị & Barista AI):** https://nguyenducquan08022006-ai.github.io/rangmaycoffe/
- 📖 **Trang Cẩm nang Cà phê chuẩn SEO (`Article` + `FAQPage` Schema):** https://nguyenducquan08022006-ai.github.io/rangmaycoffe/blog.html
- 🔐 **Cổng Đăng nhập / Tạo tài khoản Gmail & 2FA:** https://nguyenducquan08022006-ai.github.io/rangmaycoffe/login.html
- 👑 **Cổng Chủ cửa hàng (`admin`):** https://nguyenducquan08022006-ai.github.io/rangmaycoffe/admin.html
- 📊 **Cổng Quản lý cửa hàng (`manager`):** https://nguyenducquan08022006-ai.github.io/rangmaycoffe/manager.html
- 📦 **Bàn Nhân viên xử lý đơn (`staff`):** https://nguyenducquan08022006-ai.github.io/rangmaycoffe/staff.html
- 👤 **Trang Tài khoản Khách hàng (`customer`):** https://nguyenducquan08022006-ai.github.io/rangmaycoffe/account.html

---

## 🔑 Bảng Tài khoản Demo Phân quyền RBAC (4 Vai trò)

| Vai trò | Email đăng nhập | Mật khẩu | Cổng điều hướng & Quyền hạn chính |
|---|---|---|---|
| **Chủ cửa hàng (`admin`)** | `admin@rangmaycoffee.vn` | `RmAdmin@2026#Sec!` | `admin.html` — Toàn quyền phân quyền, cấp quyền sửa giá (`can_edit_price`), thu hồi phiên, ép buộc 2FA AAL2, Audit Log, Sao lưu AES-256-GCM & Checklist 12 mục |
| **Quản lý cửa hàng (`manager`)** | `manager@rangmaycoffee.vn` | `RmManager@2026#Sec!` | `manager.html` — Xem KPI doanh thu, duyệt/hủy đơn hoàn kho, quản lý 4 SKU sản phẩm, tạo/bật/tắt Mã giảm giá Voucher (`RANGMAY10`, `MANGDEN20K`, `VIP50K`) |
| **Nhân viên xử lý đơn (`staff`)** | `staff@rangmaycoffee.vn` | `RmStaff@2026#Sec!` | `staff.html` — Xử lý hàng đợi giao vận & liên hệ khách hàng; **ẩn doanh thu** và **chặn quyền hủy đơn (`403`)** |
| **Khách hàng (`customer`)** | `khachhang@rangmaycoffee.vn` *(hoặc tự tạo Gmail mới)* | `RmKhach@2026#Sec!` | `account.html` — Xem lịch sử đơn của riêng mình (chống IDOR), tự hủy đơn khi *Chờ xác nhận*, bật 2FA QR & tải 8 mã khôi phục dự phòng |

---

## 🛡️ Năm Trụ cột Bảo mật Website đã triển khai

Chi tiết lý thuyết và đối chiếu kỹ thuật được trình bày đầy đủ trong [**SECURITY.md**](SECURITY.md):

1. **Thiết lập mật khẩu mạnh & Xác thực hai yếu tố (2FA):**
   - Thanh đo độ mạnh mật khẩu 6 tiêu chí theo thời gian thực (`>= 10` ký tự cho Khách hàng, `>= 14` ký tự cho nhân sự nội bộ), băm mật khẩu bằng `scrypt`.
   - Quét mã QR **TOTP (RFC 6238)** qua Google/Microsoft Authenticator kèm **8 mã khôi phục dự phòng dùng một lần** (`XXXX-XXXX`).
   - Chống dò mật khẩu tự động (Brute-force Lockout `HTTP 429` + `Retry-After` sau 5 lần sai).
2. **Chứng chỉ SSL/HTTPS & Bảo vệ dữ liệu trên đường truyền:**
   - Tự động chuyển hướng `HTTP (3080) → HTTPS (3443)` với mã `301`, chứng chỉ X.509 `RSA-2048 / SHA-256` (`TLS 1.2 / 1.3`).
   - Bật đầy đủ `Strict-Transport-Security (HSTS)`, `Content-Security-Policy (CSP)` nghiêm ngặt (không dùng inline script/style hay `eval`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, cookie phiên `HttpOnly; Secure; SameSite=Strict`.
3. **Phân quyền tài khoản theo Nguyên tắc đặc quyền tối thiểu (Least Privilege):**
   - Tách biệt 4 cổng vận hành và 3 API nội bộ (`admin-api`, `manager-api`, `staff-api`), bảo vệ dữ liệu bằng Row-Level Security (RLS) trên PostgreSQL và trigger chống leo thang đặc quyền `prevent_profile_privilege_escalation`.
   - Hỗ trợ quy trình Onboarding nhân sự mới, khóa tài khoản & thu hồi toàn bộ phiên đăng nhập tức thì (Offboarding), và phân quyền chi tiết `can_edit_price`.
4. **Sao lưu dữ liệu 3-2-1 Mã hóa AES-256-GCM & Quản lý phiên bản:**
   - Tạo bản chụp dữ liệu Snapshot đã lọc sạch mật khẩu, mã hóa bằng **AES-256-GCM** kèm mã kiểm tra toàn vẹn **SHA-256**, tải tệp `.enc.json` lưu trữ off-site.
   - Hỗ trợ **Diễn tập khôi phục (Restore Drill)** đo thời gian phục hồi thực tế (`RTO ~ 1–2ms`) và khôi phục toàn phần có tạo bản sao an toàn tự động.
5. **Checklist bảo mật định kỳ 12 hạng mục:**
   - Theo dõi và lưu vết kiểm tra định kỳ theo 4 chu kỳ: **Hàng ngày – Hàng tuần – Hàng tháng – Hàng quý** trực tiếp trên giao diện Chủ cửa hàng.

---

## ☕ Bộ sưu tập 4 Dòng Sản phẩm, Chatbot Barista AI & SEO On-Page

- **4 Dòng Cà phê Phin Giấy Măng Đen:**
  1. **Rang Mây Bản Giao Hưởng** (`drip-pack-001` – `119.000đ`): Phối trộn cân bằng, nốt chocolate đen & caramel.
  2. **Rang Mây Đại Ngàn – Gu Đậm Sữa Đá** (`drip-pack-002` – `109.000đ`): Cốt sánh dày chuyên pha Sữa đá & Bạc xỉu.
  3. **Rang Mây Sương Sớm – 100% Arabica** (`drip-pack-003` – `145.000đ`): Arabica vùng cao 1.200m hương hoa & trái cây chín, chuẩn Cold Brew.
  4. **Hộp Quà Tinh Hoa Măng Đen – Mix 3 Vị** (`gift-box-004` – `269.000đ`): Hộp cứng 24 gói (8×3 vị) kèm thiệp chúc mừng AI miễn phí.
- **Trợ lý Barista AI thông minh (`barista-ai`):** Kết nối trực tiếp cơ sở dữ liệu sản phẩm và mã giảm giá để báo giá/tồn kho thực tế, tư vấn chọn dòng theo gu, tự động áp mã Voucher vào giỏ thanh toán và tra cứu tiến độ đơn hàng `RM-...` an toàn tuyệt đối không lộ dữ liệu cá nhân (Zero-PII).
- **Hồ sơ SEO On-Page:** Xem chi tiết tại [**SEO.md**](SEO.md) và trang [**blog.html**](blog.html).

---

## 💻 Hướng dẫn Chạy Cục bộ (Local HTTPS) & Kiểm thử Tự động

Yêu cầu: **Node.js >= 20**.

```powershell
# 1. Cài đặt thư viện
npm install

# 2. Khởi chạy máy chủ bảo mật HTTPS cục bộ (https://localhost:3443/ và chuyển hướng HTTP 3080 -> 301)
npm start

# 3. Chạy bộ 22 kịch bản kiểm thử bảo mật & nghiệp vụ tự động
npm run test:security
```
