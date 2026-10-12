# Kiểm tra font NoCap Web — 12/10/2026

> Đây là ảnh chụp hiện trạng **trước khi sửa** tại commit `3f93c61`. Sau báo cáo này, người dùng đã duyệt áp dụng font; xem [kết quả triển khai](typography-implementation-2026-10-12.md). Các nhận xét “chưa sửa/chưa kiểm tra EPUB” phía dưới thuộc thời điểm audit ban đầu.

Phạm vi: dự án `D:/du an/nocap-web`, commit `3f93c61`, toàn bộ 8 tệp CSS của ứng dụng, các khai báo font trong TSX, hai trang pháp lý, tệp font đang cài và các font được tải từ Google Fonts. Đây là báo cáo kiểm tra; chưa sửa font hoặc logic của ứng dụng. Android nằm ngoài phạm vi lần này.

## Kết quả chính

Web hiện dùng nhiều font, không phải một font duy nhất. Vấn đề rõ nhất là **DM Sans và Atkinson Hyperlegible trong bản đang bundle không có đủ glyph tiếng Việt**. Trình duyệt phải ghép các ký tự còn thiếu từ font dự phòng. Điều này làm một câu có nhiều kiểu nét và tỷ lệ chữ, dù CSS không thu nhỏ riêng chữ có dấu.

Literata đã có subset Vietnamese. Plus Jakarta Sans và Be Vietnam Pro được kiểm tra có đủ ký tự trong bộ thử nghiệm. Hai trang Điều khoản và Quyền riêng tư hiện đã sử dụng Times New Roman; lỗi font từ ảnh cũ không tái hiện trong lần kiểm tra này trên Windows.

## Cách kiểm tra và giới hạn

- Đọc mọi khai báo `font-family`, font shorthand, `@font-face`, `unicode-range`, font inline và cơ chế đổi `lang`.
- Dùng FontTools đọc trực tiếp bảng `cmap` của tệp WOFF2/TTF, không kết luận chỉ từ tên font hoặc tên subset.
- Bộ thử gồm **146 ký tự khác nhau**: 12 nguyên âm tiếng Việt, 6 thanh, chữ thường/chữ hoa, cộng `đ/Đ`. Bộ này có cả nguyên âm không dấu; số 146 không phải số lượng chữ có dấu riêng.
- Đối chiếu regular/bold/italic, chữ hoa, dấu kép, tiếng Anh và một câu Unicode phân rã NFD trong [mẫu độc lập](<D:/du an/nocap-web/docs/typography-specimen.html>). Mẫu nhúng các tệp font để có thể mở riêng; Times New Roman, Georgia và Segoe UI vẫn lấy từ máy đang xem.
- Kiểm tra computed style và giao diện thực tế của Khám phá, Tài khoản, phần khung Quản trị, Thống kê, Quyền riêng tư và Điều khoản tại localhost. Font đọc được kiểm tra qua source và mẫu dùng đúng tệp font của reader; chưa chạy một EPUB tiếng Việt hoàn chỉnh với mọi tùy chọn.
- Computed style chỉ cho biết danh sách font được khai báo, không chứng minh từng glyph đang dùng font nào. Kết luận thiếu glyph dựa trên tệp font và phạm vi Unicode trong CSS, được đối chiếu bằng mẫu hiển thị.
- Độ phủ ký tự không chứng minh mọi tổ hợp dấu đều đẹp. NFD còn phụ thuộc shaping/normalization của trình duyệt. Mẫu NFD được quan sát trên trình duyệt hiện tại, không coi glyph combining thiếu riêng lẻ là bằng chứng chắc chắn lỗi NFD.
- Chưa kiểm tra thiết bị iOS/Android thật hoặc mọi engine trình duyệt. Các kết quả font hệ thống dưới đây chỉ áp dụng cho các tệp đang cài trên Windows này.

## Font đang dùng và kết quả

| Font / tệp được kiểm tra | Vai trò hiện tại | Bộ thử tiếng Việt | Kết luận |
|---|---|---:|---|
| DM Sans, bundle Latin + Latin Extended, regular 400/700 | Font gốc của UI: mô tả, form, nút, nhiều nhãn | 56/146 | Thiếu 90 ký tự; cần thay ở UI tiếng Việt |
| Atkinson Hyperlegible, bundle Latin + Latin Extended, normal 400/700 và italic 400 | Reader chọn `sans` | 48/146 | Thiếu 98 ký tự; không nên là font chính cho sách tiếng Việt |
| Literata Variable, Vietnamese + Latin Extended + Latin, normal/italic | Tiêu đề, tên sách, trích dẫn, reader serif | 146/146 | Có thể giữ |
| Plus Jakarta Sans, Google Fonts, normal 400/700 và italic 400 | Menu, trang chủ Swiss, footer | 146/146 | Hỗ trợ tiếng Việt; không có lý do thay chỉ vì tên font |
| Be Vietnam Pro, Google Fonts, normal 400/700 và italic 400 | Font dự phòng sau Jakarta, chưa là font chính của UI Việt | 146/146 | Đề xuất làm font chính cho UI Việt |
| Times New Roman, `times.ttf`, `timesbd.ttf`, `timesi.ttf` | Điều khoản, Quyền riêng tư, một số fallback serif | 146/146 ở cả 3 face | Giữ cho hai trang pháp lý |
| Georgia, regular/bold/italic trên máy này | Fallback sau Literata | 54/146 | Có nguy cơ trộn glyph nếu Literata không tải được |
| Segoe UI regular trên máy này | Fallback UI, giao diện đọc ẩn | 146/146 | Đúng trong môi trường đang kiểm tra |
| Calibri regular trên máy này | Nội dung Excel đọc ẩn | 146/146 | Đúng trong môi trường đang kiểm tra |
| Consolas regular trên máy này | Nội dung VS Code đọc ẩn, đơn cách | 146/146 | Đúng trong môi trường đang kiểm tra |
| Cinzel | Bìa intro và dropped cap | Không có tệp hoặc khai báo tải trong dự án | Thực tế rơi xuống serif dự phòng; chưa thể xác nhận Cinzel đang được dùng |

Ví dụ glyph bị thiếu trong DM Sans: `ơ`, `ư`, `ạ`, `ả`, `ấ`, `ắ`, `ệ`, `ị`, `ộ`, `ở`, `ữ`. Atkinson còn thiếu một số ký tự như `ĩ`, `ũ`, `ỳ`, `ỹ`. Chỉ mở rộng `unicode-range` sẽ không bổ sung glyph vào tệp font.

## Vị trí cần xử lý

| Khu vực / selector | Font hiện tại | Vấn đề và hướng xử lý |
|---|---|---|
| UI kế thừa từ `:root` | DM Sans → system UI | Đổi font UI Việt sang Be Vietnam Pro; dùng token font chung để form, nút và văn bản kế thừa đồng nhất |
| Khám phá: `.banner-eyebrow`, `.banner-text p`, `.search-field input`, `.filter-bar select` | DM Sans kế thừa | Những câu như “Những cuốn sách để đọc…” và các nhãn có dấu bị ghép glyph; thay theo token UI Việt |
| Tủ sách: metadata, tác giả, trạng thái, nút đọc/tải | DM Sans kế thừa | Cùng nguyên nhân; tên sách dùng Literata riêng nên không cần đổi toàn bộ card sang sans |
| Tài khoản: mô tả, nav cài đặt, `.account-profile-fields`, nhãn gói Pro, `.danger-zone-card h2` | DM Sans, có một shorthand đặt cứng | Thay cả khai báo kế thừa và shorthand đặt cứng; giữ tiêu đề Literata |
| Đăng nhập/đăng ký, thêm tài liệu HTTPS, modal ghi chú, thông báo, bộ lọc/tag | DM Sans kế thừa | Các form kế thừa root; cần dùng cùng token UI để tránh còn sót modal |
| Ghi nhớ: mô tả và nút; ôn tập: nhãn, lời nhắc | DM Sans; trích dẫn Literata | Đổi phần sans theo ngôn ngữ; giữ phần trích dẫn serif |
| Thống kê: `.stat-title`, mô tả các panel | DM Sans 11–13 px | Có trộn glyph; cỡ 11 px còn làm dấu khó đọc. Kiểm tra lại độ đọc sau khi đổi font, không thu nhỏ/chỉnh dấu thủ công |
| Quản trị: sidebar, tiêu đề panel h2, form, table, trạng thái | DM Sans kế thừa; h1 Literata | Dùng token UI chung cho table/form; giữ h1 Literata. Bảng dữ liệu được kiểm tra trong source, không thực hiện thao tác quản trị để thử font |
| Reader `fontFamily='sans'`, EPUB và text/HTML/DOCX | Atkinson → DM Sans → system UI | Hai font đầu đều thiếu glyph Việt. Đề xuất font sans cho nội dung Việt là Be Vietnam Pro, đổi nhãn tùy chọn cho đúng font thực tế |
| Reader `serif` | Literata → Georgia → Times New Roman | Giữ Literata; ưu tiên fallback serif có đủ tiếng Việt, như Times New Roman trên môi trường đã kiểm tra |
| Header, phần Swiss trang chủ, footer | Plus Jakarta Sans → Be Vietnam Pro | Hiện có đủ tiếng Việt. Nếu muốn tách Việt/Anh, áp dụng token ngôn ngữ thay vì thay từng dòng tùy ý |
| `.intro-cover-title-text`, `.intro-dropped-cap` | Cinzel chưa tải | Khai báo rõ font có sẵn, ví dụ Literata, hoặc tải đúng Cinzel nếu thực sự chọn font đó. NOCAP và dropped cap hiện chủ yếu là chữ Latin đơn, nên chưa phải lỗi mất dấu chính |
| `/privacy`, `/terms` | Times New Roman | Đã đúng trong source và giao diện kiểm tra; giữ cấu hình hiện tại |

Các file liên quan:

- [src/index.css](<D:/du an/nocap-web/src/index.css:1>) — font gốc và `font-synthesis:none`.
- [src/fonts.css](<D:/du an/nocap-web/src/fonts.css:2>) — font bundle. Chú thích “Vietnamese-capable” ở đầu file không đúng cho DM Sans/Atkinson đang khai báo.
- [index.html](<D:/du an/nocap-web/index.html:11>) — tải Be Vietnam Pro và Plus Jakarta Sans từ Google Fonts.
- [src/App.tsx](<D:/du an/nocap-web/src/App.tsx:105>) — đã cập nhật `document.documentElement.lang` khi đổi ngôn ngữ.
- [src/App.css](<D:/du an/nocap-web/src/App.css:703>) — font đặt cứng ở các thành phần Swiss, cùng nhiều font serif/DM Sans khác.
- [src/AccountSettings.css](<D:/du an/nocap-web/src/AccountSettings.css:54>) — shorthand đặt cứng DM Sans ở vùng nguy hiểm.
- [src/AccountSettings.tsx](<D:/du an/nocap-web/src/AccountSettings.tsx:130>) — nhãn chọn font đọc.
- [src/Reader.tsx](<D:/du an/nocap-web/src/Reader.tsx:64>) — font stack; khai báo font EPUB riêng trong iframe, không tự kế thừa font của trang chính.
- [src/admin/AdminWorkspace.css](<D:/du an/nocap-web/src/admin/AdminWorkspace.css:3>) — heading serif và form kế thừa.
- [src/IntroExperience.css](<D:/du an/nocap-web/src/IntroExperience.css:298>) — Cinzel chưa tải; prose dùng Literata.
- [src/stealth/StealthReader.css](<D:/du an/nocap-web/src/stealth/StealthReader.css:60>) và [ExcelView.tsx](<D:/du an/nocap-web/src/stealth/ExcelView.tsx:239>) — font hệ thống của giao diện đọc ẩn.
- [public/privacy-policy.html](<D:/du an/nocap-web/public/privacy-policy.html:26>) và [public/terms-of-service.html](<D:/du an/nocap-web/public/terms-of-service.html:9>) — Times New Roman.

## Đề xuất bộ font cho NoCap

| Vai trò | Tiếng Việt | Tiếng Anh |
|---|---|---|
| UI: menu, nội dung, form, nút, quản trị | **Be Vietnam Pro** | **Plus Jakarta Sans**; có thể giữ DM Sans ở các form Anh nếu muốn giữ nguyên typography cũ |
| Tiêu đề, tên sách, trích dẫn | **Literata** | **Literata** |
| Nội dung đọc serif | **Literata** | **Literata** |
| Nội dung đọc sans | **Be Vietnam Pro** | **Atkinson Hyperlegible** nếu tiếp tục giữ tùy chọn hiện tại |
| Điều khoản / Quyền riêng tư | **Times New Roman** | **Times New Roman** |
| Excel / VS Code đọc ẩn | Giữ font công sở, bổ sung fallback nếu cần | Giữ font công sở |

Be Vietnam Pro được nhóm tác giả thiết kế và tinh chỉnh letterform/dấu tiếng Việt, phù hợp để thử làm font UI Việt. [Nguồn tác giả](https://github.com/bettergui/BeVietnamPro/blob/main/README.md).

Plus Jakarta Sans được Google Fonts ghi rõ subset Vietnamese, và tệp tải trong lần kiểm tra có đủ bộ ký tự thử nghiệm. [Metadata chính thức](https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/METADATA.pb).

Literata được thiết kế cho đọc dài trên màn hình và hỗ trợ tiếng Việt; phù hợp với phong cách sách hiện tại. [Nguồn tác giả](https://github.com/googlefonts/literata).

Không cần đổi mọi font serif sang Be Vietnam Pro. Tách vai trò UI/tiêu đề/nội dung đọc giữ được phong cách NoCap và tránh mất nét sách.

## Cách sửa được đề xuất cho bước tiếp theo

1. Tạo token font UI/serif/pháp lý, dùng `:lang(vi)` và `:lang(en)` cho UI. Source đã đổi thuộc tính `lang`, nhưng hiện không có selector font theo ngôn ngữ trong 8 tệp CSS.
2. Thay các font sans đặt cứng và font shorthand bằng token phù hợp. Kiểm tra đủ menu, footer, modal, quản trị và breakpoint mobile.
3. Bundle Be Vietnam Pro/Plus Jakarta Sans theo convention font tự host hiện có. Hai font này đang lấy qua Google Fonts; nếu không tải được, typography đổi theo font hệ thống.
4. Chuẩn bị đủ weight/style cần dùng. DM Sans hiện chỉ khai báo normal 400/500/600/700, trong khi một số UI yêu cầu 800 hoặc italic; Atkinson thiếu bold-italic trong các face đang bundle. `font-synthesis:none` có thể khiến style yêu cầu không xuất hiện như mong muốn.
5. Sửa font đọc ở cả trang chính và iframe EPUB. Ngôn ngữ nội dung sách có thể khác ngôn ngữ UI; không chọn font đọc chỉ dựa vào nút VI/EN. Với sách thiếu metadata ngôn ngữ, dùng font có đủ ký tự hoặc cho người đọc chọn rõ.
6. Kiểm tra cùng cỡ chữ với các mẫu dấu kép, regular/bold/italic, chữ hoa và NFD. Độ phủ glyph tốt là điều kiện cần, còn baseline/độ đậm/khoảng cách và clipping cần kiểm tra bằng mắt.
7. Không sửa nguyên văn sách hoặc locator để “sửa dấu”. Thay font không nên làm hỏng CFI/highlight; cần kiểm tra lại vị trí đọc sau khi thay vì metrics font sẽ khác.

## Ngôn ngữ khác và các định dạng tài liệu

UI hiện hỗ trợ `vi` và `en` trong `src/i18n.ts`. Không tìm thấy cấu hình UI riêng cho ngôn ngữ thứ ba.

Literata gốc có hỗ trợ thêm Greek/Cyrillic, nhưng project chỉ bundle Latin/Latin Extended/Vietnamese. Không thể coi bundle hiện tại là đủ cho mọi ngôn ngữ của sách nhập vào. Nếu xuất hiện sách dùng chữ viết khác, cần chọn/tải bộ font tương ứng sau khi kiểm tra tài liệu thật.

PDF được PDF.js vẽ bằng font của tài liệu; CBZ/ảnh chứa chữ trong ảnh. Đổi font UI không sửa được font lỗi đã nằm trong PDF hoặc ảnh. Phần text/HTML/DOCX và EPUB lại chịu tác động trực tiếp của `fontStack` trong reader.

## Bằng chứng và tệp tạo

- [Mẫu so sánh font độc lập](<D:/du an/nocap-web/docs/typography-specimen.html>) — nhúng font bundle và font đề xuất, không thay cấu hình app.
- [Kết quả độ phủ glyph](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/glyph-coverage.json>) — danh sách tệp, ký tự thiếu và kết quả từng face.
- [Danh sách khai báo font](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/source-font-inventory.json>) — inventory source; các số dòng tự sinh chỉ để tìm kiếm, một số bắt đầu ở khoảng trắng trước selector.
- [Ảnh mẫu so sánh](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/screenshots/font-comparison.jpg>).
- [Ảnh Khám phá tiếng Việt](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/screenshots/explore-vi.jpg>).
- [Ảnh Tài khoản tiếng Việt](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/screenshots/account-vi.jpg>).
- [Ảnh Quyền riêng tư tiếng Việt](<D:/du an/nocap-web/.deploy-backup.local/typography-audit/screenshots/privacy-vi.jpg>).

Các công cụ và bằng chứng trong `.deploy-backup.local` được giữ ngoài Git. Hai tệp mới trong `docs` là báo cáo và mẫu kiểm tra. Chưa thay source runtime, chưa commit/push/deploy trong task kiểm tra font này.
