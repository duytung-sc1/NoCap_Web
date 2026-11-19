# Kiểm tra tìm kiếm cho NoCap

Trang công khai trong sitemap là `/` và `/explore`. Trang đọc, sách, tài khoản, quản trị, tủ sách, ghi nhớ và thống kê có thể chứa thông tin cá nhân nên không được đưa vào sitemap; `_headers` và metadata client chỉ dẫn `noindex` cho các đường dẫn tương ứng. Chỉ dẫn tìm kiếm không thay thế đăng nhập, phân quyền hoặc bảo vệ dữ liệu.

Trang chủ cung cấp mô tả và hỏi đáp công khai bằng tiếng Việt ngay cả khi JavaScript tắt; khi ứng dụng chạy, nội dung hỏi đáp hiển thị trong giao diện Việt hoặc Anh. Bản build tạo `explore.html` cho tuyến `/explore` với title, description và canonical riêng. Ngôn ngữ được chọn trong cùng một URL, do đó không khai báo các URL `hreflang` giả. Khi service worker đang dùng shell offline, client vẫn cập nhật metadata theo route sau khi React tải xong.

## Sau khi phát hành

1. Kiểm tra trực tiếp `https://nocap.rest/robots.txt` trả nội dung văn bản và `https://nocap.rest/sitemap.xml` trả XML. Xác minh `/explore` trả HTML có title/canonical cho trang Khám phá.
2. Kiểm tra phản hồi các đường dẫn cá nhân như `/account` và `/read/test` có `X-Robots-Tag: noindex`; kiểm tra `/explore` không có header này. Kiểm tra quyền truy cập thật tách biệt với chỉ dẫn crawler.
3. Xác minh quyền sở hữu website trong Google Search Console, gửi `https://nocap.rest/sitemap.xml`, rồi dùng URL Inspection để kiểm tra `/` và `/explore` và nội dung đã render. Cần tài khoản Google có quyền sở hữu hoặc quyền thích hợp để thao tác.
4. Theo dõi tình trạng lập chỉ mục và số lượt hiển thị theo thời gian; không cộng lượt truy cập ẩn danh của bảng thống kê web với lượt hiển thị tìm kiếm như thể chúng là cùng một chỉ số.

Không đảm bảo thứ hạng, thời gian lập chỉ mục, hay việc trang được một hệ thống AI trích dẫn. Google cho biết các tính năng AI trong Search không yêu cầu schema hoặc tệp riêng cho AI; ưu tiên nội dung hữu ích và SEO thông thường: https://developers.google.com/search/docs/appearance/ai-features
