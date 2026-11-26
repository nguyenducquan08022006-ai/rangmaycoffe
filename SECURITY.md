# Phương Án Bảo Mật Toàn Diện Cho Website Bán Hàng (WordPress / WooCommerce & Đối Chiếu Kiến Trúc Rang Mây Coffee)

Tài liệu này trình bày **phương án bảo mật 5 trụ cột** dành cho website bán hàng sử dụng **WordPress/WooCommerce**, kèm **Phụ lục đối chiếu** các cơ chế bảo mật thực tế đã được triển khai trực tiếp trong mã nguồn website **Rang Mây Coffee** (trang đăng nhập người dùng, 2FA TOTP, phân quyền RBAC/RLS và CSP nghiêm ngặt).

---

## Phần 1. Thiết lập mật khẩu mạnh và xác thực hai yếu tố (2FA)

Tài khoản quản trị và nhân viên là mục tiêu tấn công phổ biến nhất trên WordPress thông qua dò mật khẩu tự động (brute-force), tái sử dụng mật khẩu lộ lọt (credential stuffing) hoặc tấn công đầu cuối `wp-login.php` / `xmlrpc.php`.

### 1.1. Chính sách mật khẩu mạnh (tham chiếu NIST SP 800-63B & OWASP)
- **Độ dài và độ phức tạp:**
  - **Khách hàng:** tối thiểu **10–12 ký tự**, ưu tiên cụm mật khẩu dài (passphrase) dễ nhớ nhưng khó đoán; kết hợp chữ hoa, chữ thường, chữ số và ký tự đặc biệt.
  - **Quản trị viên & Nhân viên:** tối thiểu **14–16 ký tự**, tạo ngẫu nhiên hoàn toàn bằng trình quản lý mật khẩu (Bitwarden, 1Password, KeePassXC).
- **Quy tắc chống đoán & chống tái sử dụng:**
  - Cấm mật khẩu nằm trong danh sách rò rỉ/phổ biến (`123456`, `admin123`, tên thương hiệu, ngày sinh, số điện thoại).
  - Không dùng trùng mật khẩu giữa WordPress Admin, Hosting/cPanel, Email doanh nghiệp, Registrar tên miền và Cổng thanh toán.
  - Không dùng tên đăng nhập mặc định `admin`, `administrator` hoặc `root`.
- **Áp dụng kỹ thuật trên WordPress/WooCommerce:**
  - Bật kiểm tra độ mạnh mật khẩu bắt buộc (Password Strength Enforcement) cho `Administrator`, `Shop Manager` và `Editor` qua plugin bảo mật (Wordfence / Solid Security).
  - Vô hiệu hóa thông báo lỗi chi tiết khi đăng nhập sai (không phân biệt *"Sai tên đăng nhập"* hay *"Sai mật khẩu"*) để chống dò tài khoản (Username Enumeration).
  - Chặn truy vấn tác giả `/?author=1` và tắt API danh sách user công khai `/wp-json/wp/v2/users` đối với người dùng chưa đăng nhập.

### 1.2. Xác thực hai yếu tố (2FA – TOTP)
- **Giao thức ưu tiên:** Sử dụng **TOTP (Time-based One-Time Password, chuẩn RFC 6238)** qua ứng dụng Google Authenticator, Microsoft Authenticator, Authy hoặc 1Password, **hoặc khóa phần cứng FIDO2/WebAuthn** (YubiKey). Hạn chế dùng SMS OTP cho tài khoản quản trị do rủi ro hoán đổi SIM (SIM swapping).
- **Phạm vi áp dụng:**
  - **Bắt buộc (100%):** Administrator, Shop Manager, nhân viên CSKH/kho, tài khoản Hosting/VPS, Cloudflare, GitHub, nhà đăng ký tên miền và cổng thanh toán.
  - **Khuyến khích (tùy chọn bật):** Tài khoản khách hàng tại trang *Tài khoản của tôi*.
- **Cấu hình chuẩn trên WordPress:**
  - Dùng module 2FA của **Wordfence Login Security** hoặc **WP 2FA**.
  - Lưu trữ **mã khôi phục dự phòng (Recovery Codes)** ngoại tuyến (két sắt hoặc Password Manager) để tránh mất quyền truy cập khi hỏng/mất điện thoại.
  - Đặt thời gian ân hạn (Grace Period) tối đa 3 ngày khi onboarding nhân sự mới; quá hạn sẽ khóa truy cập cho đến khi kích hoạt 2FA.

### 1.3. Chống tấn công Brute-force vào trang đăng nhập
- **Giới hạn thử sai (Rate Limiting & Lockout):** Khóa tạm thời IP/tài khoản 15–30 phút sau 5 lần đăng nhập thất bại liên tiếp; chặn vĩnh viễn IP quét liên tục.
- **Tắt XML-RPC (`xmlrpc.php`):** Nếu không dùng ứng dụng mobile WordPress cũ hay Jetpack, chặn `xmlrpc.php` tại `.htaccess`/Nginx/WAF vì đây là kênh tấn công khuếch đại dò mật khẩu (`system.multicall`).
- **Bảo vệ đường dẫn quản trị:**
  - Đổi URL đăng nhập mặc định hoặc giới hạn truy cập `/wp-admin` và `wp-login.php` theo dải IP văn phòng/VPN hoặc lớp Cloudflare Zero Trust Access.
  - Bật CAPTCHA không gây phiền (Cloudflare Turnstile / reCAPTCHA v3) trên form đăng nhập, đăng ký, quên mật khẩu và thanh toán.

---

## Phần 2. Chứng chỉ SSL/HTTPS và vai trò trong bảo vệ dữ liệu

### 2.1. Khái niệm và cơ chế hoạt động của SSL/TLS & HTTPS
- **HTTPS (HTTP over TLS)** kết hợp giao thức web HTTP với lớp mã hóa **TLS (Transport Layer Security 1.2 / 1.3)** xác thực bằng **chứng chỉ số SSL/TLS**.
- **Quy trình bắt tay TLS (TLS Handshake) tóm tắt:**
  1. Trình duyệt gửi yêu cầu kết nối HTTPS kèm danh sách thuật toán mã hóa hỗ trợ.
  2. Máy chủ gửi về **Chứng chỉ SSL/TLS** chứa khóa công khai (Public Key) do Tổ chức chứng thực (CA) uy tín ký số.
  3. Trình duyệt kiểm tra tính hợp lệ của chứng chỉ (tên miền khớp, chưa hết hạn, chuỗi tin cậy CA hợp lệ), sau đó hai bên thỏa thuận **khóa phiên đối xứng (Session Key)** theo cơ chế trao đổi khóa an toàn (ECDHE – đảm bảo *Perfect Forward Secrecy*).
  4. Toàn bộ dữ liệu sau bước này (mật khẩu, cookie phiên, địa chỉ giao hàng, chi tiết đơn hàng) đều được mã hóa đầu cuối trên đường truyền.

### 2.2. Ba vai trò cốt lõi trong bảo vệ dữ liệu website bán hàng
1. **Bảo mật tính bí mật (Confidentiality):** Ngăn chặn nghe lén gói tin (sniffing) trên Wi-Fi công cộng hoặc mạng trung gian; bảo vệ thông tin đăng nhập, số điện thoại, địa chỉ nhận hàng và mã token phiên.
2. **Bảo đảm tính toàn vẹn (Integrity):** Mọi dữ liệu truyền đi đều có mã xác thực thông điệp (AEAD/MAC). Kẻ tấn công trung gian (MITM) không thể sửa giá tiền, thay mã đơn hay chèn mã độc quảng cáo vào nội dung trang.
3. **Xác thực danh tính máy chủ (Authentication):** Chứng minh khách hàng đang giao dịch đúng website chính thức của thương hiệu (không phải trang giả mạo DNS), đồng thời củng cố niềm tin mua hàng (biểu tượng ổ khóa, không bị trình duyệt cảnh báo *"Not Secure"*) và cải thiện thứ hạng SEO.

### 2.3. Phân loại chứng chỉ & Cấu hình chuẩn trên WordPress/WooCommerce
- **Loại chứng chỉ phù hợp:**
  - **DV (Domain Validation) – Let's Encrypt / Cloudflare Universal SSL:** Miễn phí, tự động gia hạn mỗi 90 ngày, mã hóa TLS 1.3 tương đương hoàn toàn OV/EV về mặt kỹ thuật, phù hợp shop vừa và nhỏ.
  - **OV / EV:** Bổ sung xác minh pháp nhân doanh nghiệp trong hồ sơ chứng chỉ khi cần tăng mức độ kiểm toán đối tác B2B.
- **Checklist triển khai HTTPS trên WordPress/WooCommerce:**
  - Hỗ trợ **TLS 1.2 và TLS 1.3** (tắt hoàn toàn SSLv3, TLS 1.0, TLS 1.1).
  - Chuyển hướng bắt buộc **HTTP (cổng 80) → HTTPS (cổng 443)** với mã trạng thái `301` tại cấp Web Server/CDN.
  - Cập nhật `WordPress Address (URL)` và `Site Address (URL)` thành `https://...`, kiểm tra và xử lý triệt để lỗi **Mixed Content** (ảnh/CSS/JS tải qua `http://`).
  - Trong `wp-config.php`, bật bắt buộc quản trị qua HTTPS: `define('FORCE_SSL_ADMIN', true);`.
  - Bật các thuộc tính an toàn cho Cookie phiên đăng nhập: `Secure`, `HttpOnly`, `SameSite=Lax` (hoặc `Strict` cho cookie admin).
  - Thiết lập các HTTP Security Headers tại Nginx/Apache/Cloudflare:
    - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS – chỉ bật sau khi chắc chắn toàn bộ tên miền phụ đã chạy HTTPS ổn định).
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: DENY` và `Content-Security-Policy: frame-ancestors 'none'` (chống Clickjacking).
    - `Referrer-Policy: strict-origin-when-cross-origin`

---

## Phần 3. Phân quyền tài khoản Quản trị viên, Nhân viên và Khách hàng

Áp dụng nghiêm ngặt **Nguyên tắc đặc quyền tối thiểu (Principle of Least Privilege)**: mỗi tài khoản chỉ được cấp đúng quyền cần thiết để hoàn thành công việc, không dùng chung một tài khoản cho nhiều người.

### 3.1. Ma trận phân quyền đề xuất cho WooCommerce

| Nhóm người dùng | Vai trò WordPress / WooCommerce | Quyền được phép | Giới hạn bắt buộc (Không được phép) |
|---|---|---|---|
| **Quản trị viên hệ thống (Chủ shop / Kỹ thuật trưởng)** | `Administrator` | Toàn quyền cấu hình hệ thống, cài/gỡ plugin & theme, quản lý user, sao lưu & xem audit log | Không dùng tài khoản Administrator để viết bài blog hàng ngày; tối đa 1–2 tài khoản; bắt buộc 2FA + giới hạn IP |
| **Quản lý cửa hàng (Vận hành trưởng)** | `Shop Manager` | Quản lý sản phẩm, giá bán, tồn kho, mã giảm giá, đơn hàng, báo cáo doanh thu | Không được cài plugin/theme, không sửa code hệ thống, không nâng quyền lên Administrator |
| **Nhân viên xử lý đơn / CSKH** | Vai trò tùy chỉnh (`Order Staff` tạo từ User Role Editor) | Xem đơn hàng, cập nhật trạng thái xử lý/giao vận, ghi chú nội bộ, phản hồi liên hệ khách hàng | Không xóa đơn hàng, không xuất hàng loạt toàn bộ dữ liệu khách hàng, không sửa giá bán sản phẩm, không sửa phân quyền người dùng |
| **Nhân viên nội dung / Marketing** | `Editor` hoặc `Author` | Đăng & sửa bài viết tin tức, hướng dẫn pha chế | Không truy cập dữ liệu đơn hàng, thông tin khách hàng, cài đặt WooCommerce hoặc plugin |
| **Khách hàng mua hàng** | `Customer` | Đăng ký/đăng nhập, xem sản phẩm, đặt hàng, xem lịch sử đơn của chính mình, sửa địa chỉ giao hàng & mật khẩu cá nhân | Không truy cập `/wp-admin`, không xem đơn hàng/thông tin của khách hàng khác, không thay đổi giá tiền hay trạng thái đơn |

### 3.2. Kiểm soát kỹ thuật bổ sung cho phân quyền
- **Tắt trình sửa mã nguồn trong Dashboard:** Thêm vào `wp-config.php`:
  ```php
  define('DISALLOW_FILE_EDIT', true);
  ```
  (hoặc `DISALLOW_FILE_MODS` trên môi trường production triển khai qua CI/CD) để kể cả khi lộ tài khoản admin cũng không thể chèn shell PHP trực tiếp vào theme/plugin.
- **Phân tách dữ liệu ở tầng truy vấn (IDOR Protection):** Mọi API xem đơn hàng của khách hàng phải lọc theo `user_id` lấy từ phiên/JWT đã xác thực trên server, tuyệt đối không tin `user_id` gửi từ trình duyệt.
- **Quy trình nhân sự (Onboarding / Offboarding):**
  - Cấp tài khoản định danh riêng cho từng nhân viên (tuyệt đối không dùng chung `nhanvien@shop.vn`).
  - Khi nhân viên nghỉ việc hoặc ngừng hợp tác nhà cung cấp: **khóa/thu hồi tài khoản trong vòng 1 giờ**, thu hồi API key, đổi mật khẩu dùng chung (nếu có) và rà soát log hoạt động gần nhất.

---

## Phần 4. Thiết lập sao lưu dữ liệu, cập nhật phiên bản và plugin

### 4.1. Chiến lược sao lưu dữ liệu theo nguyên tắc 3-2-1
Nguyên tắc **3-2-1**: lưu **3 bản sao** dữ liệu trên **2 loại phương tiện/hệ thống lưu trữ khác nhau**, trong đó có ít nhất **1 bản đặt ngoài hạ tầng máy chủ chính (off-site)**.

- **Phạm vi sao lưu:**
  1. **Cơ sở dữ liệu (Database):** Bảng `wp_users`, `wp_usermeta`, đơn hàng WooCommerce (`wc_orders` / `wp_posts`), sản phẩm, cài đặt.
  2. **Tệp tin (Files):** `wp-content/uploads` (hình ảnh), `wp-content/themes`, `wp-content/plugins`, `wp-config.php`, `.htaccess`.
- **Lịch sao lưu đề xuất cho website bán hàng:**
  - **Hàng ngày (tự động lúc 02:00 sáng):** Sao lưu toàn bộ **Database** (giữ lưu trữ xoay vòng 30 ngày gần nhất).
  - **Hàng tuần:** Sao lưu **Full Backup (Database + Files)** (giữ 4–8 tuần gần nhất).
  - **Trước mọi thay đổi lớn (On-demand):** Bắt buộc tạo snapshot trước khi nâng cấp lõi WordPress, WooCommerce, PHP hoặc cài mới plugin.
- **Bảo vệ bản sao lưu:**
  - Lưu off-site lên Amazon S3 / Google Cloud Storage / Backblaze B2 (bật chế độ *Object Lock / Versioning* chống ransomware xóa bản backup), tuyệt đối không chỉ để file `.zip`/`.sql` trong `wp-content/updraft` trên cùng server.
  - Mã hóa bản sao lưu (AES-256) vì chứa PII (họ tên, SĐT, địa chỉ giao hàng).
  - **Diễn tập khôi phục (Restore Drill):** Backup chưa từng test restore đồng nghĩa với chưa có backup — thực hiện khôi phục thử ra môi trường staging mỗi quý 1 lần để đo thời gian phục hồi (RTO) và kiểm tra tính toàn vẹn đơn hàng.

### 4.2. Quy trình cập nhật WordPress, WooCommerce, Theme & Plugin
Phần lớn lỗ hổng WordPress xuất phát từ plugin bên thứ ba lỗi thời hoặc plugin "nulled/crack".

- **Quy tắc lựa chọn & dọn dẹp plugin:**
  - Chỉ cài plugin từ nguồn chính thức (`wordpress.org` hoặc nhà phát triển uy tín có giấy phép bản quyền); **tuyệt đối không dùng theme/plugin lậu (nulled)**.
  - Kiểm tra lần cập nhật gần nhất, số lượt cài đặt, tương thích phiên bản PHP/WordPress và lịch sử vá lỗi (WPScan / Patchstack) trước khi cài.
  - Xóa hoàn toàn plugin và theme không sử dụng (không chỉ tắt *Deactivate*, vì mã PHP vẫn có thể bị khai thác trực tiếp).
- **Quy trình cập nhật 5 bước an toàn (Staging → Production):**
  1. **Theo dõi bản vá:** Đăng ký nhận cảnh báo lỗ hổng (Wordfence Intelligence / Patchstack).
  2. **Sao lưu trước khi nâng cấp:** Tạo bản backup Database + Files mới nhất.
  3. **Kiểm thử trên Staging:** Clone website lên môi trường staging độc lập; nâng cấp phiên bản PHP được hỗ trợ (8.2+), WordPress core, WooCommerce và plugin tại đây.
  4. **Kiểm thử hồi quy luồng quan trọng:** Kiểm tra trang chủ, giỏ hàng, tính giá checkout, thanh toán, đăng nhập/2FA và gửi email xác nhận đơn.
  5. **Đẩy lên Production & giám sát:** Áp dụng cập nhật trong khung giờ ít khách, xóa cache CDN và theo dõi error log trong 24 giờ.
- **Tự động hóa có kiểm soát:** Cho phép auto-update các bản vá bảo mật nhỏ (minor security releases) của WordPress core; với major updates của WooCommerce và cổng thanh toán, bắt buộc test qua staging trước.

---

## Phần 5. Checklist bảo mật định kỳ cho website

### 5.1. Kiểm tra Hàng ngày (5–10 phút)
- [ ] Kiểm tra thông báo uptime (UptimeRobot / Better Stack) và tốc độ phản hồi trang chủ/checkout.
- [ ] Rà soát danh sách đơn hàng mới: phát hiện đơn bất thường (đặt lặp lại hàng loạt, giá sai lệch, spam COD).
- [ ] Kiểm tra nhật ký đăng nhập thất bại và cảnh báo tường lửa WAF (Wordfence / Cloudflare) xem có dấu hiệu brute-force hay không.
- [ ] Xác nhận tác vụ sao lưu Database đêm qua đã chạy thành công và đồng bộ lên kho off-site.
- [ ] Kiểm tra cảnh báo lỗ hổng khẩn cấp (Zero-day) đối với các plugin thanh toán/bán hàng đang dùng.

### 5.2. Kiểm tra Hàng tuần (30 phút)
- [ ] Kiểm tra bản cập nhật mới của WordPress core, WooCommerce, theme và plugin; test trên staging rồi mới cập nhật production.
- [ ] Quét toàn bộ mã độc và kiểm tra thay đổi file hệ thống (`wp-admin`, `wp-includes`, `wp-content`).
- [ ] Rà soát hàng đợi thư/liên hệ spam và điều chỉnh quy tắc Rate Limit / Turnstile nếu cần.
- [ ] Kiểm tra không gian lưu trữ sao lưu và xác minh không có file `.sql`, `.zip`, `.log`, `.env` lộ công khai trong thư mục webroot.

### 5.3. Kiểm tra Hàng tháng (60 phút)
- [ ] Rà soát toàn bộ danh sách tài khoản quản trị & nhân viên: khóa/xóa tài khoản không hoạt động > 60 ngày hoặc nhân sự đã nghỉ.
- [ ] Xác minh **100% tài khoản Administrator / Shop Manager / Nhân viên** vẫn đang bật 2FA và giữ phân quyền đúng ma trận.
- [ ] Kiểm tra hạn chứng chỉ SSL, chính sách HSTS, các HTTP Security Headers (qua SecurityHeaders.com / SSL Labs) và lỗi Mixed Content.
- [ ] Gỡ bỏ các plugin/theme thử nghiệm không còn sử dụng.
- [ ] Xoay vòng (rotate) các API key tích hợp phụ nếu có dấu hiệu bất thường; kiểm tra log lỗi PHP/Server.

### 5.4. Kiểm tra Hàng quý (2–3 giờ)
- [ ] **Diễn tập khôi phục bản sao lưu đầy đủ** lên môi trường staging và đối chiếu số liệu đơn hàng, tồn kho, tài khoản.
- [ ] Kiểm tra bảo mật tầng Domain/DNS: trạng thái Registrar Lock, bật DNSSEC, kiểm tra bản ghi SPF/DKIM/DMARC chống giả mạo email thương hiệu.
- [ ] Đánh giá lại ma trận rủi ro, rà soát tuân thủ quyền riêng tư & xóa dữ liệu cá nhân/log quá thời hạn lưu trữ.
- [ ] Diễn tập quy trình ứng phó sự cố 6 bước (*Nhận diện → Bao vây → Loại bỏ → Khôi phục → Kiểm chứng → Rút kinh nghiệm*).

---

## Phần 6. Tám kịch bản kiểm thử nghiệm thu bảo mật

1. **Chặn leo thang đặc quyền:** Tài khoản `Customer` truy cập `/wp-admin` hoặc API quản trị → hệ thống phải trả về `403 Forbidden` và ghi log cảnh báo.
2. **Chống XSS:** Gửi thẻ `<script>` / HTML vào ô họ tên, địa chỉ, tin nhắn liên hệ hoặc thiệp quà → không được thực thi, hiển thị dạng văn bản thuần.
3. **Chống sửa giá phía trình duyệt:** Sửa giá sản phẩm hoặc tổng tiền bằng DevTools trước khi bấm đặt hàng → server phải bỏ qua giá client và tự tính lại từ catalog gốc.
4. **Bảo vệ 2FA:** Tài khoản có 2FA nếu chưa nhập đúng mã OTP 6 số (chưa đạt `AAL2`) → không thể vào khu vực quản trị.
5. **Chống Brute-force & Spam:** Đăng nhập sai nhiều lần liên tiếp hoặc gửi form vượt ngưỡng tốc độ → bị giới hạn tạm thời (`429 Too Many Requests` / lockout).
6. **Bắt buộc HTTPS & Security Headers:** Truy cập `http://` tự động chuyển hướng sang `https://`; phản hồi HTTP chứa đầy đủ CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`.
7. **Kiểm tra phân tách dữ liệu khách hàng (IDOR):** Khách hàng A đăng nhập không thể xem danh sách đơn hàng của khách hàng B.
8. **Diễn tập khôi phục Backup:** Khôi phục bản sao lưu ra staging thành công, dữ liệu đơn hàng và tài khoản nhất quán.

---

## Phụ lục: Đối chiếu triển khai bảo mật thực tế trên Website gốc Rang Mây Coffee

Website gốc **Rang Mây Coffee** trong kho mã nguồn này hỗ trợ **hai chế độ vận hành bảo mật đồng bộ**: chạy trực tiếp cục bộ qua máy chủ HTTPS Node.js (`npm start` → `https://localhost:3443/`) và triển khai Production trên **Static Frontend + Supabase Auth + Supabase Edge Functions + PostgreSQL RLS**:

1. **Trang đăng nhập, mật khẩu mạnh theo vai trò, 2FA (TOTP) & Mã khôi phục:**
   - [login.html](login.html) & [assets/js/login.js](assets/js/login.js): Đăng nhập, đăng ký (kèm honeypot chống bot), quên mật khẩu, đặt lại mật khẩu và bước xác thực OTP 6 chữ số hoặc **8 mã khôi phục dự phòng dùng một lần** (`XXXX-XXXX`). Chặn mật khẩu yếu (tối thiểu **10 ký tự** cho Khách hàng, **14 ký tự** cho Quản trị/Quản lý/Nhân viên), chống dò tài khoản (anti-enumeration), và khóa Brute-force (`429 Too Many Requests` + `Retry-After`) sau 5 lần đăng nhập sai.
   - [account.html](account.html) & [assets/js/account.js](assets/js/account.js): Xem lịch sử đơn hàng cá nhân (chống IDOR), cập nhật địa chỉ giao hàng, đổi mật khẩu theo chuẩn vai trò, kích hoạt/tắt **2FA TOTP (mã QR)**, tải/tạo lại **8 mã khôi phục dự phòng** và đăng xuất trên tất cả thiết bị (`global` sign out).
2. **Chứng chỉ SSL/TLS, HTTPS 301 Redirect, Cookie HttpOnly & Security Headers:**
   - [server/secure-server.mjs](server/secure-server.mjs): Phát hành chứng chỉ X.509 RSA 2048-bit SHA-256 (`TLS >= 1.2`), chuyển hướng bắt buộc HTTP `3080` → HTTPS `3443` với mã `301`, gắn cookie phiên `rm_sid` cờ `HttpOnly; Secure; SameSite=Strict`, cấu hình HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` và chỉ phục vụ danh sách tệp public hợp lệ (trả `403` cho mã nguồn máy chủ/tệp nội bộ).
   - [_headers](_headers), [robots.txt](robots.txt): Cấu hình đồng bộ tương đương khi deploy Cloudflare Pages / trình thu thập dữ liệu.
3. **Phân quyền 4 vai trò (`customer` / `staff` / `manager` / `admin`) & 3 trang nội bộ tách biệt:**
   - [supabase/migrations/20261123000000_add_auth_rbac_and_security.sql](supabase/migrations/20261123000000_add_auth_rbac_and_security.sql), [20261124000000_harden_rls_functions_and_indexes.sql](supabase/migrations/20261124000000_harden_rls_functions_and_indexes.sql), [20261124020000_add_manager_role_and_security_policies.sql](supabase/migrations/20261124020000_add_manager_role_and_security_policies.sql), [20261125000000_add_store_products_catalog.sql](supabase/migrations/20261125000000_add_store_products_catalog.sql): Bảng `public.profiles` hỗ trợ 4 vai trò, trigger `prevent_profile_privilege_escalation` trong schema `private`, bật RLS toàn bộ bảng, `security_policies` quản lý ép buộc 2FA và `store_products` đồng bộ giá/tồn kho trực tiếp.
   - **Chủ cửa hàng (`admin`):** [admin.html](admin.html), [assets/js/admin.js](assets/js/admin.js), [supabase/functions/admin-api/index.ts](supabase/functions/admin-api/index.ts) (Onboarding nhân sự mới, phân quyền, khóa tài khoản & **Thu hồi phiên tức thì**, ép buộc 2FA AAL2, mở khóa Brute-force, Audit Log, giám sát toàn hệ thống).
   - **Quản lý cửa hàng (`manager`):** [manager.html](manager.html), [assets/js/manager.js](assets/js/manager.js), [supabase/functions/manager-api/index.ts](supabase/functions/manager-api/index.ts) + [store-catalog/index.ts](supabase/functions/store-catalog/index.ts) + [validate-voucher/index.ts](supabase/functions/validate-voucher/index.ts) (KPI doanh thu, quản lý đủ 5 trạng thái đơn hàng & hủy hoàn tồn kho/lượt voucher, xuất CSV an toàn công thức, chỉnh giá/tồn kho và tạo/bật/tắt **Mã giảm giá Voucher** đồng bộ lên cửa hàng, xử lý liên hệ, xem danh sách nhân viên).
   - **Nhân viên xử lý đơn (`staff`):** [staff.html](staff.html), [assets/js/staff.js](assets/js/staff.js), [supabase/functions/staff-api/index.ts](supabase/functions/staff-api/index.ts) (xử lý hàng đợi đơn hàng & liên hệ, **ẩn hoàn toàn doanh thu**, chặn hủy đơn hoặc sửa đơn đã hủy). Tự động khóa tất cả trang vận hành sau 30 phút không thao tác.
4. **Làm cứng sao lưu 3-2-1 Mã hóa AES-256-GCM, Diễn tập khôi phục (Restore Drill) & Checklist 12 hạng mục:**
   - Tab **Bảo mật & Sao lưu** trong [admin.html](admin.html) + [20261124010000_add_security_checklist_and_backups.sql](supabase/migrations/20261124010000_add_security_checklist_and_backups.sql): Tạo Snapshot dữ liệu đã lọc sạch mật khẩu/secret, **mã hóa bằng AES-256-GCM** kèm mã toàn vẹn **SHA-256**, chạy **Diễn tập khôi phục (Restore Drill)** đo RTO thực tế, hỗ trợ **Khôi phục dữ liệu** có bản sao an toàn tự động, kiểm tra **Mixed Content / Health Check** trực tiếp và lưu **Checklist bảo mật định kỳ 12 hạng mục** (Hàng ngày / Tuần / Tháng / Quý).
5. **Làm cứng CSP, chống XSS, chống sửa giá & kiểm thử tự động:**
   - [index.html](index.html), [assets/css/styles.css](assets/css/styles.css), [assets/js/app.js](assets/js/app.js): Strict CSP (`script-src 'self'`), không dùng inline script/style hay `innerHTML`, bổ sung honeypot ẩn chống spam ở Checkout & Liên hệ, tính lại giá đơn hàng hoàn toàn trên server (`create-order`).
   - [server/test-security.mjs](server/test-security.mjs) (`npm run test:security`): Kiểm thử tự động 20 kịch bản bảo mật đầu-cuối bao phủ toàn bộ 8 kịch bản nghiệm thu, cô lập 3 cổng vận hành, phân quyền sửa giá (`can_edit_price`), đồng bộ giá/tồn kho thực và chống giả mạo mức giảm Voucher trên server.
