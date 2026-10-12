# Áp dụng font NoCap Web — 12/10/2026

Tiếp nối [báo cáo kiểm tra trước khi sửa](typography-audit-2026-10-12.md), sau khi người dùng duyệt tiếp tục. Phạm vi: NoCap Web; không thay source Android hoặc backend. Báo cáo ghi lại kết quả của vòng QA local trước khi người dùng yêu cầu commit, push và deploy.

## Font sau khi sửa

| Thành phần | Font |
|---|---|
| Giao diện Việt: nội dung, nút, form, thông báo, account và admin | Be Vietnam Pro |
| Giao diện Anh | Plus Jakarta Sans Variable |
| Tiêu đề có chân, phần đọc mặc định và intro | Literata Variable |
| Chữ thương hiệu NOCAP lớn và hiệu ứng echo | Plus Jakarta Sans Variable, giữ hình dáng thương hiệu |
| Reader không chân, sách Việt hoặc chưa biết ngôn ngữ | Be Vietnam Pro |
| Reader không chân, sách khai báo tiếng Anh | Atkinson Hyperlegible, Be Vietnam Pro dự phòng |
| Reader đơn cách | Stack đơn cách hệ thống hiện có |
| Quyền riêng tư và Điều khoản | Times New Roman hiện có |

Các biến `--font-ui`, `--font-editorial`, `--font-brand` được đặt trong `src/index.css`. `:root:lang(en)` chọn font UI Anh; các component kế thừa cùng quy tắc. Font reader theo **ngôn ngữ sách**, không theo ngôn ngữ giao diện. EPUB nhập từ máy thiếu ngôn ngữ trong catalog sẽ đọc `dc:language` từ metadata EPUB trước khi chọn font và đo nội dung. Tệp TXT/HTML/DOCX chưa có metadata ngôn ngữ vẫn dùng font hỗ trợ tiếng Việt khi chọn không chân.

`src/fonts.css` chứa 50 face WOFF2 tự host, đủ regular/bold/italic/bold italic của các họ cần dùng. Be Vietnam Pro có 400–800; Plus Jakarta Sans Variable có 200–800; Literata có 200–900; Atkinson có 400/700. Main document và iframe EPUB dùng chung khai báo font, thông qua CSS `?inline` đã được Vite xử lý URL. Loại bỏ Google Fonts stylesheet và dependency DM Sans cũ. Giấy phép font được giữ trong `public/font-licenses/` để đi cùng bản web.

Nhãn lựa chọn đọc đổi thành “Không chân · Dễ đọc” / “Sans · Accessible”, do họ font thực tế phụ thuộc sách. Enum `sans`, thiết lập đã lưu và cơ chế sync không thay đổi.

## Bố cục liên quan

- Giữ menu desktop trên một dòng, điều chỉnh gap theo chiều rộng. Từ 1200px trở xuống dùng drawer sẵn có; từ 1201–1450px ẩn tagline nhỏ trong header để dành chỗ cho menu. Logo và menu không bị bẻ từng từ.
- Modal dùng cột grid `minmax(0, 1fr)` và giới hạn chiều rộng. Nút Google đăng nhập lấy chiều rộng container, tối đa 320px; tránh ép hộp thoại tràn ở màn hình hẹp.

## Kiểm chứng

- `npm run lint`: PASS.
- `npm test`: 226/226, 39 file PASS sau thay đổi font và ngôn ngữ EPUB.
- Sau chỉnh chiều rộng modal/nút Google: kiểm tra lại hai file lifecycle của App và Reader, 22/22 PASS.
- `npm run build`: TypeScript, Vite và PWA PASS.
- Đọc bảng cmap của 50 WOFF2 và áp dụng `unicode-range` thực tế: mọi face Be Vietnam Pro, Plus Jakarta Sans và Literata đủ **146/146** ký tự trong bộ thử Việt. Atkinson đủ ASCII Anh; không dùng làm font chính cho sách Việt.
- Bundle gồm 50 WOFF2, tổng 921.884 byte (~900 KiB). PWA cache sẵn font theo cấu hình hiện có; không tải font từ Google Fonts.
- UI Việt/Anh: computed style chọn đúng họ. Tiêu đề giữ Literata.
- EPUB thực: nhập hai tệp QA vi-VN/en-US vào origin preview riêng, chọn không chân; sách Anh vẫn dùng Atkinson khi UI Việt, sách Việt dùng Be Vietnam Pro khi UI Anh. Iframe có cùng CSS font và URL `/assets/...woff2`.
- Quan sát mẫu Việt chữ thường/hoa, đậm, nghiêng, đậm nghiêng và Unicode NFD trong EPUB. Không thấy ô vuông hoặc dấu bị tách/mất trong trình duyệt kiểm thử.
- Console lần kiểm tra EPUB không ghi lỗi/warning.
- Test regression mới xác nhận đổi ngôn ngữ điều khiển giữ nguyên typeface và nội dung sách; tài liệu thiếu ngôn ngữ chọn font có glyph Việt.
- Responsive: desktop 1280px, sáu mục menu Việt đều một dòng; tablet 1100px dùng drawer mở/đóng được; mobile 390px không có tràn ngang, modal đăng nhập rộng 339px nằm trong vùng nội dung 375px (trừ scrollbar).

Ảnh kiểm chứng local:

- [Khám phá tiếng Việt sau sửa](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/screenshots/fonts-applied-desktop-vi.jpg>)
- [Đăng nhập trên màn hình nhỏ](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/screenshots/fonts-applied-mobile-login-vi.jpg>)
- [EPUB Việt: regular/bold/italic/bold italic/NFD](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/screenshots/fonts-applied-epub-vi-sans.jpg>)

Tệp fixture và bằng chứng máy nằm ngoài Git trong `.deploy-backup.local/typography-audit/`: `applied-glyph-coverage.json`, `qa-vietnamese.epub`, `qa-english.epub`, `qa-vietnamese.txt`, và ảnh trong `screenshots/`.

## Giới hạn

- Responsive được kiểm tra bằng viewport trình duyệt trên Windows; chưa xác nhận trên iPhone/Android thật.
- Không đăng nhập Google trong lần QA font: origin preview `http://127.0.0.1:5181` chưa nằm trong Authorized JavaScript Origins. GIS báo lỗi origin khi mở nút đăng nhập; kết quả này không xác nhận đăng nhập Google trên production hỏng. Bố cục nút vẫn kiểm tra được.
- Không thay font được nhúng trong PDF, CBZ hay ảnh: đó là nội dung tệp, không phải font UI.
- Không suy đoán ngôn ngữ từ nội dung; tài liệu thiếu metadata dùng Be Vietnam Pro. Không đổi ngôn ngữ của sách theo lựa chọn VI/EN trên header.
- Các trang pháp lý giữ Times New Roman theo yêu cầu trước đây; máy không có font này sẽ dùng serif dự phòng. Chưa chứng minh mọi hệ điều hành dùng cùng font hệ thống.
- Mẫu `typography-specimen.html` giữ font **trước/sau** của audit để so sánh, không phải trang runtime của ứng dụng.
