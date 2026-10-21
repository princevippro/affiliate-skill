# Affiliate Control Center — hướng dẫn cho người mua

Trung tâm điều hành affiliate cho **mọi ngành hàng** trên AICoworker:
quét sản phẩm Shopee Affiliate đúng ngách → lấy link affiliate thật →
đăng bài ảnh / reel Facebook hàng loạt → theo dõi sổ đơn, hoa hồng, thuế ước tính.

Mọi dữ liệu (cấu hình, sổ đơn, catalog, lịch sử đăng) nằm **trên máy của bạn**.
App không gửi dữ liệu đi đâu ngoài Shopee Affiliate và Facebook Page của chính bạn.

## Cần có

| Thứ | Ghi chú |
|---|---|
| AICoworker (bản mới) | App chạy bên trong AICoworker |
| Tài khoản Shopee Affiliate | Đã được duyệt |
| Facebook Page | Bạn là quản trị viên |
| Google Chrome | Dùng riêng 1 hồ sơ cho Shopee Affiliate |
| FFmpeg | Chỉ cần nếu đăng **reel** (video) |
| Các skill đi kèm bộ kit | `shopee-affiliate-video`, `facebook-page-posting` — agent dùng để làm poster/video và đăng bài |

## Cài đặt lần đầu (khoảng 5 phút)

1. Mở **AI Apps → Affiliate Control Center**. App hiện trình thiết lập 5 bước:
   1. **Shop & ngành** — tên shop, ngành hàng, khách mục tiêu, giọng văn.
   2. **Từ khoá lọc** — app tự gợi ý theo ngành; sản phẩm nào không chứa ít nhất 1 từ sẽ bị loại khi quét.
   3. **Kênh bán** — link Facebook Page (+ Meta asset_id nếu đăng reel), cổng Chrome Shopee.
   4. **Cách đăng** — poster hay reel, link ở bình luận hay caption, số bài tối đa mỗi lượt, bật/tắt tự đăng.
   5. **Kiểm tra máy** — Chrome Shopee, Page Facebook, FFmpeg.
2. Mở Chrome Shopee Affiliate (làm mỗi lần bật máy):
   `Win + R` → dán
   `chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\affiliate-chrome https://affiliate.shopee.vn/offer/product_offer`
   → đăng nhập Shopee Affiliate (lần đầu) và **giữ cửa sổ mở**.
3. Đăng nhập Facebook Page trong **trình duyệt tích hợp** của AICoworker (1 lần).

App **không bao giờ tự đăng nhập** hay vượt CAPTCHA thay bạn.

## Dùng hằng ngày

1. **Quét & đăng** → nhập từ khoá → **Quét**. Chỉ sản phẩm đúng ngành được giữ lại, xếp theo % hoa hồng.
2. Tick tối đa *N* sản phẩm (đặt ở Cài đặt), chọn **Poster** hoặc **Reel** cho từng cái.
3. **Đăng cả lượt** — app lấy link affiliate thật cho từng sản phẩm, agent làm poster/video, đăng lên Page, mở lại bài để xác minh. Tiến độ hiện ngay trong app.
   - Tắt *Tự đăng*: app soạn sẵn tới bước cuối, bạn tự bấm đăng.
   - Bật *Tự đăng*: bài lên Page luôn.
4. Khi Shopee báo có đơn → **Sổ đơn → Ghi đơn**. Đổi trạng thái *Chờ duyệt → Đã xác nhận → Đã nhận tiền* khi Shopee đối soát.

Thời gian: poster ~1–2 phút/bài, reel ~3–5 phút/bài.

## Lưu ý an toàn cho Page

- Đăng quá dày dễ bị Facebook hạn chế. Khuyến nghị **≤ 5 bài/lượt, vài lượt/ngày**.
- Không bịa công dụng, chính hãng hay giá — app chỉ dùng thông tin Shopee trả về.
- Thuế trong app là **ước tính**; hỏi kế toán trước khi quyết toán.

## Sự cố thường gặp

| Thông báo | Cách xử lý |
|---|---|
| Không kết nối được Chrome Shopee | Mở lại Chrome theo bước 2, đúng cổng đã khai báo |
| Shopee đang ở trang đăng nhập | Đăng nhập trong cửa sổ Chrome đó rồi quét lại |
| 0 sản phẩm đúng ngành | Đổi cụm từ tìm, hoặc thêm từ khoá lọc ở Cài đặt → Mở trình thiết lập |
| Shopee “Không có dữ liệu” | Shopee tạm giới hạn — đợi vài phút hoặc đổi từ khoá |
| Lỗi khi đăng 1 bài | Lượt vẫn chạy tiếp các bài khác; xem lý do ở danh sách tiến độ |

## Chuyển từ bộ kit cũ

Nếu workspace đã có `KIT-CONFIG.json`, `ledger/ledger.json`, `catalog/catalog.json`:
Cài đặt → **Nhập dữ liệu kit cũ** (chạy 1 lần, không trùng đơn khi bấm lại).

## Xoá dữ liệu

Cài đặt → **Xoá toàn bộ dữ liệu** — xoá cấu hình, sổ đơn, catalog, lịch sử đăng trên máy này.
