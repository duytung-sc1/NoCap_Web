# Quy tắc font bắt buộc — 26/10/2026

Quy tắc này thay thế các lựa chọn font trong hai báo cáo ngày 12/10/2026.

Toàn bộ chữ do ứng dụng hiển thị dùng font **không chân**, bao gồm thương hiệu, tiêu đề, nút, thông báo, quản trị, nội dung đọc có thể dàn lại, các chế độ đọc ẩn và PDF ghi chú mới xuất.

| Ngôn ngữ | Bộ font riêng |
|---|---|
| Tiếng Việt | Be Vietnam Pro, gồm bộ ký tự Vietnamese |
| Tiếng Anh | Plus Jakarta Sans, gồm tệp Latin/Latin Extended riêng |

- Font được đóng gói cùng sản phẩm, không tải từ dịch vụ font bên ngoài. Giấy phép nằm trong `public/font-licenses`.
- Ngôn ngữ nội dung được xử lý độc lập với ngôn ngữ giao diện. Khi có chữ Việt, chuẩn hóa NFC và chọn trực tiếp Be Vietnam Pro, kể cả khi metadata nhập vào ghi nhầm tiếng Anh.
- `src/typography.ts` là nơi chọn font; `src/fonts.css` khai báo các face. Dùng `var(--font-ui)` cho mọi thành phần và đặt `lang` cho nội dung khác ngôn ngữ giao diện. Không thêm font riêng cho logo, mã kỹ thuật hay tiêu đề.
- Các giá trị font cũ trong dữ liệu đồng bộ vẫn được đọc để tương thích, nhưng luôn hiển thị bằng sans theo ngôn ngữ. Không khôi phục tùy chọn serif, monospace hoặc font tùy ý.
- EPUB thay font của nhà xuất bản mà không chèn wrapper, giữ cấu trúc DOM phục vụ định vị ghi chú. TXT/HTML/DOCX đặt ngôn ngữ theo khối nội dung.
- PDF ghi chú nhúng hai bộ TTF riêng, gồm thường, đậm, nghiêng và đậm nghiêng. Không sửa font nhúng/pixel của PDF hoặc ảnh gốc do người dùng mở.
- Android áp dụng cùng hai bộ font trong design system, wrapper văn bản, Readium và bộ xuất PDF. Các trang quản trị độc lập và pháp lý của backend cũng áp dụng cùng quy tắc.

Kiểm tra bắt buộc: `npm run lint`, `npm test`, `npm run build`; kiểm thử cả hai ngôn ngữ, dấu tổ hợp tiếng Việt, font cũ đã lưu, EPUB có CSS riêng, ghi chú Việt trong giao diện Anh và xuất PDF trộn hai ngôn ngữ. Không xác nhận đã kiểm tra trực quan nếu công cụ trình duyệt bị chặn.
