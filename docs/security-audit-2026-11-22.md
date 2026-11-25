# Rà soát bảo mật NoCap Web — 22/11/2026

> Đây là ảnh chụp phạm vi rà soát ngày 22/11, không phải trạng thái mới nhất của toàn bộ dự án. Bản web hiện dùng Worker tại `D:/du an/NoCap_Backend-debug/worker`. Các cập nhật email, ảnh đại diện, phiên admin và MFA sau đó được mô tả trong tài liệu `worker/docs/` của repository backend; nhận xét về việc chưa thấy MFA bên dưới chỉ áp dụng cho snapshot cũ.

## Phạm vi

- `D:\du an\nocap-web`: React + TypeScript + Vite, Cloudflare Pages.
- `D:\du an\ebook-backend\worker`: Cloudflare Worker, D1, R2.
- Không đọc `.env`, token, mật khẩu hay file secret. Chỉ kiểm tra mã nguồn, cấu hình và test hiện có.

## Kết luận nhanh

- Đã vá các điểm cấu hình rủi ro nhất: thiếu header bảo mật, CORS `*`, proxy catalog nhận mọi URL và không giới hạn dung lượng.
- Không phát hiện dependency production có CVE đã biết (`npm audit --omit=dev`: 0 vulnerabilities ở cả web và worker).
- Còn 3 rủi ro cần theo dõi: token phiên trong Web Storage, CSP còn `'unsafe-inline'` cho script bootstrap, và MFA phía backend chưa thấy trong snapshot local.

## OWASP Top 10 2021

### A01 — Broken Access Control

- Backend lấy `userId` từ session, không tin `userId` trong payload; các test IDOR/foreign session đều pass.
- Web admin dùng Bearer session tách khỏi cookie dashboard; mutation yêu cầu đăng nhập lại trong 15 phút; admin session 1 giờ.
- Không thấy đường đọc/ghi tài nguyên của người khác ngoài ý muốn trong các route đã kiểm tra.
- **Kết luận:** đạt; không cần sửa.

### A02 — Cryptographic Failures

- Mật khẩu: PBKDF2-SHA256, 600.000 vòng, salt 32 byte.
- Session token: 32 byte ngẫu nhiên; D1 chỉ lưu SHA-256 của token.
- Google ID token: xác minh RS256, `aud`, `iss`, `exp`, `email_verified`.
- Đã thêm `Strict-Transport-Security` cho web.
- **Rủi ro còn lại:** token phiên được lưu trong `localStorage`/`sessionStorage`; nếu XSS xảy ra, token có thể bị đọc. Đã giảm thiểu bằng CSP, DOMPurify và EPUB `allowScriptedContent: false`, nhưng chưa loại bỏ hoàn toàn. Khuyến nghị dài hạn: chuyển sang cookie `HttpOnly; Secure; SameSite` hoặc mặc định chỉ dùng `sessionStorage`.

### A03 — Injection

- D1 dùng prepared statement/bind cho toàn bộ truy vấn đã kiểm tra.
- JSON body bị giới hạn kích thước; `field()` giới hạn độ dài và kiểm tra kiểu.
- HTML từ file người dùng và HTTPS import đi qua DOMPurify với allowlist tag/attribute.
- EPUB render với `allowScriptedContent: false`; PDF.js không dùng `new Function`/`eval` trong build chính.
- CSP mới chặn script ngoài danh sách, `object-src 'none'`, `base-uri 'self'`.
- **Rủi ro còn lại:** CSP còn `'unsafe-inline'` cho hai script bootstrap trong `index.html`. Khi có thể inject nonce/hash qua Pages Function, nên bỏ `'unsafe-inline'`.

### A04 — Insecure Design

- Rate limit theo IP và theo email cho login/register/reset/verify.
- Email verification trước các tính năng cloud; admin reauth trước mutation.
- Catalog import dùng add-only, không xóa/sửa bản ghi cũ; asset kiểm tra hash trước khi publish.
- **Kết luận:** đạt; không cần sửa.

### A05 — Security Misconfiguration

Đã thêm vào `public/_headers`:

- `Strict-Transport-Security`
- `Content-Security-Policy` với `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0`
- `X-Permitted-Cross-Domain-Policies: none`
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy` tắt camera/microphone/geolocation/payment/USB và các sensor không dùng

Backend:

- CORS chuyển từ `Access-Control-Allow-Origin: *` sang allowlist origin first-party; request không có `Origin` (native app) vẫn hoạt động.
- Proxy catalog chỉ nhận host allowlist (`nocap-ebook-api...`, `nocap.rest`, Gutenberg, Standard Ebooks), chỉ HTTPS, chặn URL có credential, giới hạn 150 MiB và cắt stream nếu vượt.
- **Kiểm chứng:** `wrangler pages dev dist` trả đủ header; trình duyệt tải trang chủ và mở reader EPUB thành công; ảnh bìa từ API tải được dưới CSP; API catalog trả dữ liệu cho origin `http://127.0.0.1:5173`.

### A06 — Vulnerable and Outdated Components

- `npm audit --omit=dev` tại web: **0 vulnerabilities**.
- `npm audit --omit=dev` tại worker: **0 vulnerabilities**.
- Audit đầy đủ (gồm dev tooling) báo advisory ở `vite` (dev server) và `undici` kéo theo bởi `wrangler`/`miniflare`. Các gói này không nằm trong bundle production gửi lên Cloudflare Pages/Worker. Khuyến nghị nâng `vite`/`wrangler` trong một đợt bảo trì riêng, kèm test/build đầy đủ; không dùng `npm audit fix --force` vì có thể đổi major.
- Không nâng version ngoài phạm vi yêu cầu trong đợt này.

### A07 — Identification and Authentication Failures

- Login: 15 lần/15 phút theo IP, 20 lần/15 phút theo email.
- Register/reset/verify: 30 lần/15 phút theo IP; link reset/verify dùng một lần, hết hạn 30 phút.
- Session 30 ngày; admin session 1 giờ; mutation admin yêu cầu reauth 15 phút.
- **Finding:** frontend có `AdminMfa` và `MfaLogin`, nhưng snapshot backend local không thấy route `security/mfa` và `auth.js` không đọc `otp` trong login. Cần xác minh Worker đang deploy có MFA hay không. Nếu chưa có, nên ẩn UI MFA hoặc bổ sung backend (migration + secret + route) trước khi coi MFA là đã bật. Không tự ý triển khai TOTP trong đợt này vì cần thay đổi schema và luồng đăng nhập.

### A08 — Software and Data Integrity Failures

- EPUB/cover mới được kiểm tra ZIP CRC, `mimetype`, container, OPF, spine, text tối thiểu trước khi publish.
- Tên file R2 dùng SHA-256; catalog chỉ chèn `ON CONFLICT(id) DO NOTHING`.
- **Kết luận:** đạt.

### A09 — Security Logging and Monitoring Failures

- Admin audit ghi actor/action/target/reason.
- HTTPS import chỉ log `stage`, `code`, `upstreamStatus`, `errorType`; không log URL, query token hay nội dung tài liệu.
- Analytics không ghi admin page view; DNT/GPC được tôn trọng.
- **Kết luận:** đạt.

### A10 — Server-Side Request Forgery (SSRF)

- `server/httpsImport.ts`: chỉ HTTPS, kiểm tra DNS qua Cloudflare DoH, chặn private/link-local/metadata, redirect thủ công tối đa, giới hạn kích thước, kiểm tra `Origin`/`Sec-Fetch-Site`.
- Proxy catalog đã allowlist host và giới hạn dung lượng.
- **Kết luận:** tốt.

## File đã thay đổi

| File | Thay đổi |
|---|---|
| `public/_headers` | Thêm HSTS, CSP, frame-ancestors, COOP, CORP, Permissions-Policy, X-Frame-Options, X-XSS-Protection |
| `worker/src/http.js` | Thêm `applyCors()` và allowlist origin first-party |
| `worker/src/index.js` | Bọc response qua CORS; allowlist host proxy; chặn HTTP/credential; cap 150 MiB |
| `worker/test/security.test.js` | Test CORS, host allowlist, size cap |
| `worker/test/web-admin.test.js` | Cập nhật kỳ vọng CORS theo policy mới |

## Kiểm chứng

- Web: `npm run test` — 119 file, 1.124 test pass.
- Web: `npm run lint` — pass, còn 4 warning có sẵn (fast-refresh/exhaustive-deps).
- Web: `npm run build` — pass.
- Worker: `npm test` — 104 test pass.
- Worker: `npm run check` — bundle dry-run pass.
- `npm audit --omit=dev` — 0 vulnerabilities ở cả hai repo; audit đầy đủ chỉ báo gói dev (Vite dev server, undici qua wrangler/miniflare).
- Browser: trang chủ render; API catalog gọi được từ origin local; ảnh bìa tải qua CSP; reader EPUB tạo iframe và hiển thị nội dung.

## Trạng thái triển khai

- Worker `nocap-ebook-api` đã deploy production; CORS allowlist và giới hạn proxy catalog đã có hiệu lực.
- Pages `nocap-web` đã deploy; các header bảo mật đã có hiệu lực tại `https://nocap.rest`.
- Kiểm chứng sau deploy:
  - `Origin: https://nocap.rest` → `Access-Control-Allow-Origin: https://nocap.rest`, `Vary: Origin`.
  - Origin lạ → không có `Access-Control-Allow-Origin`.
  - Request không có Origin (native) → vẫn nhận `*`, không ảnh hưởng app Android.
  - EPUB range request → `206`, `Content-Range`, ACAO đúng origin.
  - `/health/ready` → `UP`; catalog → 200 sách, 10 thể loại.
  - Reader production mở sách Việt từ Explore và render iframe dưới CSP mới.

## Rủi ro còn lại và khuyến nghị

1. **Token trong Web Storage:** ưu tiên chuyển sang cookie `HttpOnly; Secure; SameSite=Lax/Strict` hoặc mặc định `sessionStorage`; cần phối hợp backend và Android.
2. **CSP `'unsafe-inline'`:** thay bằng nonce/hash khi Pages Function có thể chèn nonce vào `index.html`; giữ `'unsafe-inline'` cho `style-src` vì React dùng inline style.
3. **MFA backend:** xác minh bản Worker production có route MFA; nếu không, ẩn UI hoặc triển khai đầy đủ.
4. **CORS `ntlab.id.vn`:** chỉ giữ nếu đây là origin first-party thật; nếu không, xóa khỏi allowlist.
5. **R2 public assets:** catalog và bìa là công khai có chủ đích; đảm bảo không có tài liệu riêng tư nào nằm dưới tiền tố `public/`.
6. **Rate limit theo `CF-Connecting-IP`:** chỉ tin header này khi Worker luôn chạy sau Cloudflare; không thêm proxy tự dựng phía trước làm giả header.
