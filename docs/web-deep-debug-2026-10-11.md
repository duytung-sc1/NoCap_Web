# NoCap Web — debug sâu trình đọc, thanh toán và nhập HTTPS

Ngày: 11/10/2026. Phạm vi: `D:\du an\nocap-web`. Công việc Android đã tạm dừng theo yêu cầu; đợt này không sửa source Android hoặc Worker tài khoản/thanh toán.

## Kết quả

Baseline sạch tại commit `3a7d0f4`: 200/200 tests, 35 file. Thêm 13 kiểm thử, kết quả cuối **213/213 tests, 37 file PASS**. Lint, TypeScript/Vite/PWA build và Cloudflare Pages Function build đều PASS.

Đã sửa sáu tình huống được tái hiện bằng kiểm thử thất bại trước sửa:

1. **Đóng QR rồi phản hồi kiểm tra thủ công đến muộn:** cửa sổ tự mở lại. Nay đóng cửa sổ vô hiệu request cũ ngay, trước khi React xử lý render tiếp theo.
2. **Tạo đơn mới trong lúc đang kiểm tra đơn cũ:** phản hồi cũ thay QR/trạng thái của đơn mới. Nay kiểm tra token, ID đơn hiện tại và thế hệ request trước khi cập nhật; ID trong response cũng phải khớp. Phản hồi pending đến muộn không làm lùi trạng thái đã xác nhận.
3. **Xác nhận PAID nhưng request quyền Pro còn chậm:** kiểm tra thủ công và effect cùng gọi entitlement. Nay dùng một luồng cập nhật quyền; các effect đang chờ cùng đơn/tài khoản dùng chung request. Có thể kiểm tra lại nếu tải quyền thất bại. Backend vẫn là bên xác nhận giao dịch và quyền Pro.
4. **PDF cũ lưu trang 99 nhưng tệp hiện tại chỉ có ba trang:** reader gọi trang không tồn tại, ghi progression ngoài khoảng hợp lệ và có thể kẹt màn hình lỗi. Nay chuẩn hóa số trang, giới hạn theo PDF đã tải và chặn render/ghi vị trí không hợp lệ. Bao gồm locator trang 0, âm và thập phân.
5. **Chuyển chương khi DOCX đang giải mã:** yêu cầu điều hướng chạy trước khi có DOM rồi mất. Nay giữ yêu cầu đến khi nội dung có mặt, và áp dụng sau bước khôi phục vị trí đọc.
6. **Body JSON của endpoint nhập HTTPS bị treo:** timer abort đã có nhưng không hủy reader của body request; handler vẫn chờ. Nay nối tín hiệu hủy/deadline vào body reader, kiểm tra hủy trước/sau mỗi lần đọc và gỡ listener khi hoàn tất. Kiểm thử xác nhận body được hủy, trả 504/DOWNLOAD_TIMEOUT và không gọi nguồn ngoài.

## Kiểm thử hồi quy bổ sung

- Đăng xuất ở tab khác trong khi nhập HTTPS: dialog đóng, signal hủy và bytes đến muộn không được nhập. Luồng này đã hoạt động đúng; không cần sửa `App.tsx`.
- Đóng checkout trong lúc tải quyền Pro: không mở lại cửa sổ hoặc áp dụng callback từ checkout đã đóng.
- Đơn đã PAID nhưng tải entitlement thất bại: kiểm tra lại được.
- Kiểm tra tự động xác nhận PAID trước khi request thủ công trả PENDING: trạng thái không bị lùi.
- Tài khoản, QR và đơn thanh toán trong tests đều là fixtures `.test`; không tạo đơn, chuyển khoản, cấp Pro hoặc xóa tài khoản thật.
- PDF/DOCX component tests mô phỏng giao diện API của PDF.js/Mammoth để điều khiển thời điểm phản hồi; đây không phải xác nhận render trực quan trên thiết bị thật.

## HTTP và runtime thực tế

- Vite local tại `http://127.0.0.1:5173`: `/`, `/explore`, `/library`, `/account`, `/privacy`, `/terms` trả 200.
- `/api/import`: GET → 405; thiếu Origin → 403; nguồn HTTP → 400; body vượt 16 KiB → 413.
- Tải PDF công khai từ W3C qua endpoint local: 200, **13.264 bytes**, chữ ký `%PDF-1.4`, `Cache-Control: private, no-store`.
- Build Functions bằng Wrangler 4.149.0: `Compiled Worker successfully`.
- Chạy bundle production với `wrangler pages dev dist --port 8788`: `/explore` và `/sw.js` trả 200; service worker có `Cache-Control: no-cache` theo `_headers`.
- Cùng PDF W3C qua runtime Pages local: 200, 13.264 bytes, đúng chữ ký PDF và header private/no-store.
- Bằng chứng HTTP trong `.deploy-backup.local/web-deep-https-http-2026-10-11.json` và `.deploy-backup.local/web-deep-pages-preview-2026-10-11.json`; không đưa fixtures/log vào Git.

## Files thay đổi

- `src/SePayCheckout.tsx`: vòng đời order/request, chống phản hồi cũ và gộp tải entitlement.
- `src/Reader.tsx`: khôi phục trang PDF hợp lệ; giữ yêu cầu điều hướng DOCX/HTML/Text khi nội dung chưa sẵn sàng.
- `server/httpsImport.ts`: hủy body reader khi hết hạn hoặc client abort. Handler dùng chung cho Pages Function hiện có.
- `src/SePayCheckout.lifecycle.test.tsx`: sáu kiểm thử thanh toán mô phỏng.
- `src/Reader.lifecycle.test.tsx`: năm kiểm thử khôi phục PDF và điều hướng DOCX.
- `src/App.lifecycle.test.tsx`: thêm một regression nhập HTTPS khi tab khác đăng xuất.
- `src/httpsImport.server.test.ts`: thêm một regression body request treo.
- Báo cáo này.

## Giới hạn và trạng thái phát hành

- Trạng thái khi kết thúc debug ngày 11/10: bản sửa chạy local và đã build, chưa commit/push/deploy. Yêu cầu phát hành ngày 12/10 được kiểm tra và ghi nhận riêng sau triển khai.
- Không thử thanh toán SePay thật, Google OAuth thật hoặc đồng bộ Web–Android trên hai thiết bị thật trong đợt này.
- Không có QA trực quan mới: công cụ trình duyệt chặn việc chọn tab lỗi kết nối cũ do chính sách URL. Không thử vượt chặn; dùng kiểm thử component, HTTP và runtime Pages local để xác minh.
- Safari/iOS WebView và việc hệ điều hành dừng trình duyệt vẫn cần kiểm tra trên thiết bị thật.
- Không chỉnh cache zone Cloudflare. Header `sw.js` trong preview chỉ xác nhận cấu hình bundle; không chứng minh TTL bốn giờ trước đây của tên miền production đã được sửa.
- Giữ hệ thống IndexedDB, sync, drag/reading routes, thiết kế UI và chính sách giá/quyền Pro hiện có.
