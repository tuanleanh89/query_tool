# Nâng cấp v1.1.2 → v1.2.0 (2026-11-11)

Bản sao lưu bản cũ: `backup_v1.1.2_20261111/` (toàn bộ mã nguồn, cấu hình, tài liệu). `jasper-helper.jar` cũ (53 MB) được giữ nguyên tại `jasper_helper/jasper-helper.jar`; bản mới là `jasper_helper/jasper-helper-1.2.0.jar` và `start.bat` ưu tiên bản mới.

## Đã sửa

| # | Vấn đề ở v1.1.2 | Cách xử lý ở v1.2.0 |
|---|---|---|
| 1 | Mật khẩu tài khoản admin nằm sẵn trong `background.js` | Bỏ khỏi mã nguồn; cấu hình qua nút 🔑 Tài khoản, lưu `chrome.storage.local`, đăng nhập thử trước khi lưu |
| 2 | Daemon `localhost:8080` mở cho mọi trang web (CORS `*`) và nghe trên mọi giao diện mạng; `/update-extension` nhận URL bất kỳ rồi ghi đè mã extension | Chỉ nghe `127.0.0.1`; chỉ nhận Origin của extension; kiểm tra Host; `/update-extension` chỉ HTTPS tới GitHub, bắt buộc SHA-256, chỉ giải nén tệp tĩnh, chặn zip-slip |
| 3 | Path traversal ở `save/get/delete-session` (id dùng làm tên tệp); xóa phiên được bằng GET | `SAFE_ID`; xóa chỉ nhận POST |
| 4 | Thủ tục/lệnh ghi có thể bị chạy lặp sau lỗi thông thường (nhận diện "hết phiên" quá rộng) | Phân biệt đọc/ghi (`strict`); chỉ gọi lại lệnh ghi khi chắc chắn hết phiên; đăng nhập gộp một lần |
| 5 | Kiểm tra UPDATE/DELETE chỉ xét đầu chuỗi thô: bị bỏ lọt khi có comment đứng trước, `WHERE` trong comment/chuỗi, DML/DDL trong khối PL/SQL | `sql_utils.analyze()` phân tích sau khi bỏ comment/chuỗi; xác nhận khối PL/SQL/DDL/SQL động; thêm nút Chỉ đọc (UI + background) |
| 6 | Phân loại thủ tục bằng `includes("=>")`/`includes("CALL ")` dễ sai | Dựa vào từ khóa đầu câu lệnh |
| 7 | Phân trang lỗi khi câu lệnh có `;` cuối hoặc comment cuối; đếm tổng lỗi với comment cuối | Bỏ terminator, xuống dòng trước `)`; cảnh báo thiếu `ORDER BY` |
| 8 | `content.js` quét `localStorage`/`sessionStorage` của trang HIS tìm JWT mà không dùng | Bỏ đoạn quét |
| 9 | Changelog từ `version.json` từ xa chèn thẳng vào HTML | Escape HTML |
| 10 | Quyền thừa `<all_urls>`, `scripting`, `activeTab` | Gỡ bỏ (giữ nguyên `background.service_worker`; không dùng `background.scripts` vì Chrome của người dùng từ chối) |
| 11 | Log chứa SQL tích lũy mãi | Tự xóa log > 30 ngày (`QT_LOG_RETENTION_DAYS`) |
| 12 | Không có test tự động | 40 test (`tests/`), gồm phân tích SQL, phân trang, tự xác thực lại, tài khoản; đã kiểm thử daemon bằng curl và máy chủ HTTPS giả lập |
| 13 | NFR-04 "100%" không đo được | Viết lại thành mục tiêu thực tế |

## Bổ sung sau (cùng v1.2.0)
- Hết treo vòng quay khi chưa nhập tài khoản: kiểm tra tài khoản trước khi hiện loading, ẩn loading khi hỏi tài khoản, hộp thoại SweetAlert nâng z-index.
- Xuất Excel theo khối có thanh tiến trình (100.000 dòng ~0,8 giây, không còn dựng một lần).
- Mật khẩu lưu mã hóa AES-GCM, khóa không thể trích xuất trong IndexedDB; mật khẩu cũ dạng văn bản tự được chuyển đổi. Mất khóa thì nhập lại.
- Tách `ui.js` thành 10 tệp `ui_*.js` (nguyên văn, không đổi logic; đã kiểm tra ghép lại trùng bản gốc và không có tham chiếu tới hàm ở tệp nạp sau). **Cần chạy thử trên trình duyệt thật.**

- **Nguyên nhân thật của lỗi mất tab Thái Bình**: khi bấm đổi site, `switchSession` lưu nhầm danh sách tab rỗng vào phiên đầu tiên của site mới (do getCurrentSession tự lùi về phiên đầu). Đã sửa + có kịch bản kiểm thử `tests/e2e/t4.js`.
- Sửa mất tab/phiên (phòng thủ thêm): mở lại luôn về Hưng Yên nên tưởng mất phiên Thái Bình → nay nhớ site cuối cùng; chặn ghi storage trước khi nạp xong; bỏ ghi đè trường tabsBySite cũ bằng mảng rỗng; lưu ngay khi đóng trang.
- Tài khoản mặc định 2 site được nạp sẵn (công cụ nội bộ).
- Bỏ chế độ chỉ đọc (nút, cờ truyền xuống nền, chặn ở tầng nền).

## Chưa làm
- Chữ ký số cho gói cập nhật: cần sinh/giữ khóa riêng của bạn (SHA-256 hiện chỉ chống lỗi tải/giả mạo đường truyền).
- Danh sách site vẫn khai báo cứng trong `background.js`/`ui.html`.

## Việc người dùng cần làm sau khi cài
1. **Đổi mật khẩu** các tài khoản admin trên HIS nếu kho Git (đặc biệt nếu công khai) từng chứa bản cũ.
2. Nạp lại extension, bấm 🔑 **Tài khoản** nhập tài khoản cho từng site (chỉ một lần).
3. Dừng Jasper Helper đang chạy rồi chạy lại `start.bat` (tự dùng `jasper-helper-1.2.0.jar`). Muốn quay lại bản cũ: xóa `jasper-helper-1.2.0.jar`.
4. Chạy `package_release.bat` để sinh gói mới kèm SHA-256, đẩy `version.json` lên GitHub.
