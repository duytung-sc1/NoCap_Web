# Điều hướng và tiếp tục đọc Excel — 15/10/2026

## Cách dùng

- Thanh dưới bảng có **Trang trước**, **Trang sau** và số trang hiện tại.
- **PgUp / PgDn** hoặc **← / →** chuyển trang. Mỗi trang gồm 40 dòng nội dung; trang mới bắt đầu ở trên cùng. Phím **↑ / ↓**, Space, J/K vẫn chuyển từng dòng.
- Cuộn chuột cũng cập nhật mốc đọc tự động theo dòng đầu đang nhìn và độ cuộn trong dòng.
- Thoát bằng F2 hoặc đóng web đều giữ mốc đọc. Khi mở lại cùng sách và bật Đọc ẩn, Excel phục hồi trang, dòng và vị trí cuộn đã lưu trên trình duyệt này.
- Dòng ở lần đọc trước có dấu màu vàng cạnh số dòng. Nút **Về mốc lần trước** trở lại dòng đó.
- Mốc lưu riêng theo tài khoản và sách. Nếu trình duyệt chặn lưu, thanh điều hướng báo lỗi; tiến độ vẫn được gửi qua luồng lưu/đồng bộ hiện có.

Đây là cách lưu mốc đọc cuối (phương án 2), không tự bật màn hình Excel ngay khi mở website. Quyền Pro vẫn được kiểm tra khi bật Đọc ẩn.

## Các sửa lỗi kèm theo

- Locator STEALTH phiên bản 2 chứa dòng, số dòng của bản sách, ID dòng và độ cuộn. Không chỉ dùng href đầu chương EPUB để khôi phục.
- Có checkpoint cục bộ ghi đồng bộ, phòng trường hợp đóng tab trước khi IndexedDB hoàn tất. Khi mở sách, checkpoint mới hơn được dùng để phục hồi tiến độ.
- Trình đọc thường phía sau Excel không được ghi đè vị trí khi đang đọc ẩn.
- Thoát về trình đọc thường kích hoạt lưu ngay thay vì chỉ chờ bộ đếm trì hoãn.
- Chế độ khẩn cấp không ghi dữ liệu ngụy trang làm vị trí sách.
- Trang đầu/cuối chặn thao tác vượt giới hạn, gồm cả phím tắt.

## Kiểm tra

- Toàn bộ bộ kiểm thử: **43 file / 280 test passed**. Các test mới bao gồm phân trang, biên trang, locator theo dòng, lưu riêng tài khoản, bộ nhớ bị chặn, cuộn chuột, pagehide, vào lại và chặn vị trí từ trình đọc phía sau.
- Oxlint và TypeScript: thành công.
- Vite production build và service worker PWA: thành công; còn cảnh báo chunk xuất PDF lớn đã có từ trước.
- Trình duyệt thật, nội dung mẫu trên local: sang trang 2 cuộn về 0; cuộn đến dòng 65 tại scrollTop 720; tải lại phục hồi đúng dòng 65/scrollTop 720; trang trước về scrollTop 0; thoát/vào lại và quay về mốc cũ hoạt động. Không ghi nhận console error/warning.
- Ảnh: `D:/du an/NoCap-demo-assets/stealth-excel-2026-10-15/excel-navigation-resume.jpg`.
