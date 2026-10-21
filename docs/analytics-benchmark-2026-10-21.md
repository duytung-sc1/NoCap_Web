# NoCap — đối chiếu thống kê Web và giao dịch Pro

Ngày rà soát: 21/10/2026. Phạm vi: mã Web và Worker backend hiện tại. Báo cáo này kiểm tra khả năng đo trong mã nguồn, không xác nhận rằng mọi lượt truy cập thực tế đều đã được thu thập, cũng không công bố số liệu kinh doanh thực tế.

## Kết luận

NoCap đã có nền tảng thống kê truy cập và thao tác tính năng. Lịch sử giao dịch từng tài khoản đã có sẵn; thay đổi lần này bổ sung báo cáo giao dịch SePay toàn hệ thống. Theo yêu cầu tiếp theo, đã bổ sung nguồn truy cập, UTM và nhóm thiết bị. Chưa đủ để báo cáo hoàn chỉnh về kích hoạt người dùng và giữ chân người học.

Các nhóm dưới đây lặp lại trong tài liệu của nhiều công cụ phổ biến; đây là đối chiếu định tính, không phải bảng xếp hạng có khảo sát về chỉ số nào được dùng nhiều nhất trên toàn thị trường. Không có một bộ chỉ số bắt buộc áp dụng cho mọi dự án.

## Nguồn tham khảo

- [Plausible — metric definitions](https://plausible.io/docs/metrics-definitions): lượt truy cập, phiên, lượt xem, tương tác; điều hướng tài liệu đến nguồn truy cập, trang và thiết bị. Cách nhận diện khách của Plausible khác NoCap nên không so số tuyệt đối trực tiếp.
- [Google Analytics — user engagement](https://support.google.com/analytics/answer/11109416?hl=en): thời gian tương tác khi trang hoặc ứng dụng được sử dụng. Khái niệm này phù hợp hơn thời gian mở tab để xem mức độ sử dụng.
- [Mixpanel — funnels](https://docs.mixpanel.com/docs/reports/funnels/funnels-overview): theo dõi các bước theo trình tự, cửa sổ thời gian và điểm rơi rụng.
- [Mixpanel — retention](https://docs.mixpanel.com/docs/reports/retention): đo việc quay lại sau một hành động khởi đầu; có thể xem cả số người và tỷ lệ.
- [Stripe — payments analytics](https://docs.stripe.com/payments/analytics): lọc lịch sử và phân tích kết quả thanh toán. Chỉ tham khảo cách tổ chức báo cáo; NoCap vẫn dùng SePay, không tích hợp Stripe trong thay đổi này.

## Đối chiếu từng nhóm

| Nhóm / chỉ số | Trạng thái NoCap | Đang có và giới hạn | Bước tiếp theo nếu cần |
|---|---|---|---|
| Khách truy cập, phiên, lượt xem trang | Đã có | Đếm trình duyệt ước tính, phiên và lượt xem; 1/7/30/90 ngày, biểu đồ ngày. Không phải người thật hoặc tài khoản duy nhất. | Giữ định nghĩa rõ và báo thời điểm bắt đầu thu thập. |
| Tổng và trung bình thời gian tương tác | Đã có | Tổng `activeMs`, chia số phiên; tab phải hiển thị, có tiêu điểm và không quá 60 giây không thao tác. Không phải toàn bộ thời gian đọc hay thời gian mở tab. | Có thể bổ sung thời gian trên trang đọc từ dữ liệu theo loại trang; chưa có báo cáo riêng. |
| Trang được dùng nhiều | Đã có | Gộp loại trang như reader, library, memory; không lưu URL sách cụ thể hay nội dung cá nhân. | Giữ gộp loại trang để tránh lộ tài liệu đang đọc. |
| Tổng tài khoản / đăng ký mới | Một phần | Tổng quan admin có số tài khoản và số tài khoản ở trạng thái ACTIVE. Có `createdAt` trong bảng tài khoản nhưng chưa có biểu đồ đăng ký mới theo ngày. ACTIVE ở đây là tài khoản được bật, không có nghĩa là có truy cập trong kỳ. | Có thể bổ sung đăng ký mới theo ngày từ dữ liệu tài khoản, tách rõ với khách truy cập. |
| Tần suất dùng tính năng | Đã có ở mức số sự kiện | 8 loại: mở sách, lưu ghi chú, bắt đầu/hoàn thành ôn, tìm trong sách, nhập tài liệu, tải tệp, bắt đầu thanh toán. Không có số người duy nhất dùng từng tính năng trên giao diện hiện tại. | Tính riêng số trình duyệt dùng tính năng và số lần dùng; tránh gọi số sự kiện là người dùng. |
| DAU / WAU / MAU | Một phần | Có thể xem số trình duyệt xuất hiện trong hôm nay/7/30 ngày từ bộ lọc hiện tại. Chưa định nghĩa “active learner”, không phải DAU/WAU/MAU theo tài khoản, chưa có bộ thẻ chỉ số này. | Chọn hành vi có giá trị như mở sách hoặc ôn bài trước khi đặt tên “người học hoạt động”. |
| Người mới / quay lại | Đã có | Dựa trên thời điểm thấy trình duyệt lần đầu trước hay trong kỳ. Không chứng minh giữ chân D1/D7/D30. | Hiển thị cùng giới hạn nhận diện và lịch sử lưu trữ. |
| D1/D7/D30 retention theo cohort | Chưa có báo cáo | Có mã trình duyệt đã băm và ngày sự kiện để phát triển trong cửa sổ dữ liệu còn lưu. Chưa có truy vấn cohort hoặc báo cáo trở lại làm hành vi học. | Ưu tiên D7 với hành vi đọc/ôn; chỉ tính cohort đã đủ 7 ngày quan sát. |
| Activation, phễu Read → Note → Review | Chưa có báo cáo | Có một số sự kiện đầu vào, nhưng chưa đo chuỗi theo cùng trình duyệt trong cửa sổ xác định. Không có mã tài liệu hay phiên ôn chung để chứng minh cùng một nội dung đi qua các bước. | Định nghĩa “mở sách → lưu ghi chú → hoàn thành ôn trong 7 ngày” như một phễu hành vi cấp trình duyệt; không gọi đó là hiệu quả ghi nhớ. |
| Nguồn truy cập / UTM / referrer | Bổ sung theo yêu cầu tiếp theo | Nguồn/kênh của phiên, nhãn utm_source/utm_medium/utm_campaign, tên miền nguồn công khai; không lưu URL đầy đủ. Dashboard và CSV có tối đa 20 nhóm nguồn/chiến dịch và báo rõ nếu còn nhóm khác. | Chỉ có dữ liệu từ phiên mới sau cập nhật; không suy doanh thu chiến dịch từ các số này. |
| Nhóm thiết bị | Bổ sung theo yêu cầu tiếp theo | Máy tính, điện thoại, máy tính bảng, chưa xác định; ước tính từ trình duyệt, không lưu chuỗi user-agent. Có số trình duyệt và số phiên. | Hệ điều hành/phiên bản trình duyệt chi tiết chưa được bổ sung. |
| Bounce / engaged-session rate | Chưa có | Có sự kiện và thời gian thô để thiết kế sau, chưa có định nghĩa hoặc phép tính đang hiển thị. | Không lấy ngưỡng của công cụ khác rồi mặc định số liệu tương đương; với app đọc, ít chuyển trang có thể vẫn là phiên tốt. |
| Giao dịch, tiền đã thanh toán, khách trả tiền, gói tháng/năm | Bổ sung lần này | Báo cáo toàn hệ thống từ đơn SePay; lọc theo ngày, trạng thái, gói, tài khoản/mã; biểu đồ ngày và CSV. Chỉ `PAID` được cộng vào tiền và khách trả tiền. | Đối soát tiền đã thanh toán với hệ thống thanh toán khi chốt báo cáo. |
| Checkout → trả tiền | Chưa có phễu chuyển đổi | Có sự kiện checkout và dữ liệu đơn, nhưng analytics không gắn tài khoản hoặc mã đơn; không được chia hai tổng khác tập người để gọi là tỷ lệ chuyển đổi. Đơn chờ trả tiền có thể hoàn tất ngoài kỳ. | Nếu cần, tính theo cohort ngày tạo đơn và theo dõi kết quả chính các đơn đó trong cửa sổ cố định. |
| Lỗi nhập tệp / đồng bộ / thanh toán và độ trễ | Chưa có báo cáo quản trị tập trung | Có xử lý lỗi chức năng và đếm xung đột đồng bộ ở tổng quan; không có chuỗi sự kiện success/failure/duration để đo tỷ lệ lỗi và độ trễ theo ngày ở dashboard Web. | Đo số lần thử, thành công, thất bại, thời gian xử lý; không gửi nội dung tệp hay ghi chú. |
| Xuất dữ liệu báo cáo | Đã có và mở rộng lần này | Analytics CSV đã có. CSV giao dịch mới xuất đầy đủ kết quả đã lọc, tối đa 10.000 đơn; không chỉ 50 dòng đang xem. | Lưu snapshot định kỳ để làm báo cáo dài hơn cửa sổ sự kiện. |

## Cách tính báo cáo Giao dịch & Pro mới

- Tiền đã thanh toán = tổng `amount` của đơn `PAID` thỏa bộ lọc. Đây là tiền ghi nhận từ đơn đã trả, chưa trừ chi phí/hoàn tiền; không gọi là lợi nhuận hoặc doanh thu kế toán.
- Đơn thanh toán thành công = số đơn `PAID` trong kết quả.
- Khách trả tiền = số `user_id` khác nhau có đơn `PAID` trong kết quả. Không đếm lặp tài khoản có nhiều đơn.
- Phân chia gói: 30 ngày và 365 ngày; các thời hạn lịch sử khác vẫn giữ nguyên. Một tài khoản có thể mua nhiều gói nên không cộng khách của từng gói để suy ra tổng khách.
- Ngày lọc: đơn `PAID` theo `paid_at`; trạng thái khác theo `created_at`. Ngày theo Việt Nam UTC+7, gồm cả hai đầu, tối đa 366 ngày; không nhận ngày tương lai.
- Đơn `PENDING` đã hết thời hạn hiển thị thành `EXPIRED` khi đọc báo cáo; thao tác đọc không sửa đơn hoặc cấp quyền Pro.
- Đơn `PAID` thiếu `paid_at` bị loại khỏi báo cáo theo ngày và có cảnh báo số lượng trên toàn bộ các ngày phù hợp bộ lọc trạng thái/gói/tìm kiếm.
- Pro cấp bằng quyền admin không phải giao dịch trả tiền. Không suy doanh số từ entitlement. Báo cáo này không phải sổ doanh số Google Play hay sao kê tài khoản ngân hàng.
- Không bổ sung chỉ số mua lại/gia hạn theo yêu cầu. Không có MRR/ARR, tỷ lệ nâng cấp, CAC hoặc LTV được suy đoán từ dữ liệu chưa đủ.
- Các thẻ, biểu đồ và bảng đều dùng cùng bộ lọc; phân trang không thay đổi tổng. CSV gọi endpoint xuất riêng để lấy đầy đủ các dòng. Nếu quá 10.000 đơn, hệ thống báo cần thu hẹp bộ lọc, không cắt ngầm.
- CSV có khoảng ngày, bộ lọc, thời điểm tạo, tổng hợp và chi tiết. Timestamp ở cột `_utc` dùng ISO UTC; ngày nhóm ở `date_vietnam` dùng UTC+7. Ô văn bản được trích dẫn và xử lý tiền tố công thức bảng tính.

## Bộ tracking nên ưu tiên cho NoCap

1. **Quy mô sử dụng:** trình duyệt hoạt động 7 ngày, phiên, mở sách, lưu ghi chú, hoàn thành lượt ôn — hiển thị số tuyệt đối trước.
2. **Giá trị sản phẩm:** số trình duyệt hoàn thành chuỗi đọc → ghi chú → ôn trong 7 ngày; cần triển khai truy vấn và định nghĩa chính xác trước khi đưa số lên slide.
3. **Giữ chân:** số quay lại và tỷ lệ D7 trong cohort đã đủ thời gian; không thay bằng số trình duyệt “returning” hiện tại.
4. **Thanh toán:** tiền đã thanh toán, đơn PAID, khách trả tiền, gói 30/365 ngày — thay đổi lần này đáp ứng nhóm này cho SePay.
5. **Độ tin cậy:** số lần nhập tệp/đồng bộ/thanh toán thất bại và thời gian xử lý; hiện còn thiếu pipeline báo cáo.

Nếu phải chọn việc tiếp theo sau thanh toán: ưu tiên phễu Read → Note → Review và D7 để kiểm chứng giá trị học tập, sau đó nguồn truy cập để đánh giá kênh tăng trưởng. Đây là đề xuất, chưa được triển khai trong thay đổi lần này.

## Giới hạn khi đưa số vào báo cáo

- Web analytics không bao gồm Android. Tắt thống kê, DNT/GPC, chặn theo dõi, đổi thiết bị hoặc xóa dữ liệu trình duyệt làm số đo thiếu hay đếm khác người thật. Không đổi cơ chế đồng ý trong thay đổi này.
- Sự kiện Web giữ khoảng 90 ngày; không thể khôi phục dữ liệu chưa từng thu thập. Mốc `trackingStartedAt` được hiển thị để biết từ khi nào có dữ liệu.
- `book_open` là mở giao diện đọc, không chứng minh đọc hết. `download` là giao lệnh lưu tệp cho trình duyệt, không chứng minh tệp đã được lưu xong. `review_complete` là hoàn thành lượt ôn theo luồng hiện có, không chứng minh kiến thức đã nhớ lâu.
- Bộ dữ liệu đơn hiện hữu có liên kết xóa theo tài khoản; dashboard giao dịch không phải sổ cái tài chính bất biến. Cần snapshot/đối soát riêng nếu làm báo cáo tài chính dài hạn hoặc sau khi tài khoản bị xóa.
- Tỷ lệ luôn cần nêu cả tử số, mẫu số, đơn vị và cửa sổ thời gian; với mẫu nhỏ nên trình bày cả số lượng. Không cần ép mọi chỉ số thành phần trăm.

## Mã nguồn đã đối chiếu

- Web: `src/admin/AdminAnalytics.tsx`, `src/admin/AdminPayments.tsx`, `src/admin/paymentReportCsv.ts`, `src/webAnalytics.ts`, `src/useWebAnalytics.ts`, các điểm phát sự kiện ở `App.tsx`, `ReaderSearchPanel.tsx`, `SePayCheckout.tsx`.
- Backend: `worker/src/web-analytics.js`, `worker/src/admin-payment-report.js`, `worker/src/admin-transactions.js`, `worker/src/admin.js`, các migration và bài kiểm thử tương ứng.

Đợt phát hành tiếp theo bao gồm báo cáo giao dịch và thống kê nguồn/UTM/nhóm thiết bị. Không thay đổi bản Android. Kiểm tra thông tin triển khai thực tế trong báo cáo phát hành, không xem tài liệu này như bằng chứng xác nhận production.
