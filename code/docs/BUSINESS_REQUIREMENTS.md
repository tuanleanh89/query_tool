# BẢN PHÂN TÍCH YÊU CẦU NGHIỆP VỤ PHẦN MỀM (BUSINESS REQUIREMENTS DOCUMENT - BRD)
## DỰ ÁN: VNPT HIS SQL QUERY TOOL & REPORT CONSOLE PRO (v1.2.0)

---

### MỤC LỤC
1. [TỔNG QUAN DỰ ÁN & BỐI CẢNH NGHIỆP VỤ](#1-tổng-quan-dự-án--bối-cảnh-nghiệp-vụ)
2. [TÁC NHÂN & CHÂN DUNG NGƯỜI DÙNG (USER PERSONAS)](#2-tác-nhân--chân-dung-người-dùng-user-personas)
3. [KIẾN TRÚC HỆ THỐNG & MÔ HÌNH TƯƠNG TÁC](#3-kiến-trúc-hệ-thống--mô-hình-tương-tác)
4. [YÊU CẦU NGHIỆP VỤ CHỨC NĂNG CHI TIẾT (FUNCTIONAL REQUIREMENTS)](#4-yêu-cầu-nghiệp-vụ-chức-năng-chi-tiết-functional-requirements)
   - [FR-01: Quản trị Đa Phân vùng / Đa Điểm kết nối (Multi-site Management)](#fr-01-quản-trị-đa-phân-vùng--đa-điểm-kết-nối-multi-site-management)
   - [FR-02: Quản lý Danh mục Đơn vị Y tế, CSYTID & Oracle Schema](#fr-02-quản-lý-danh-mục-đơn-vị-y-tế-csytid--oracle-schema)
   - [FR-03: Soạn thảo, Tối ưu & Thực thi Truy vấn SQL (Monaco IDE & Query Engine)](#fr-03-soạn-thảo-tối-ưu--thực-thi-truy-vấn-sql-monaco-ide--query-engine)
   - [FR-04: Khám phá, Phân tích & Thực thi Thủ tục / Hàm (Stored Procedure / Function Runner)](#fr-04-khám-phá-phân-tích--thực-thi-thủ-tục--hàm-stored-procedure--function-runner)
   - [FR-05: Kết xuất Báo cáo Jasper (.jrxml) & Quản lý Phiên Preview (JasperReports Engine)](#fr-05-kết-xuất-báo-cáo-jasper-jrxml--quản-lý-phiên-preview-jasperreports-engine)
   - [FR-06: Quản lý Phiên làm việc (Sessions) & Tab Truy vấn Đa tầng (Hierarchical Tab Management)](#fr-06-quản-lý-phiên-làm-việc-sessions--tab-truy-vấn-đa-tầng-hierarchical-tab-management)
   - [FR-07: Tìm kiếm Toàn cục Xuyên Phiên / Xuyên Tab (Global Full-text Search)](#fr-07-tìm-kiếm-toàn-cục-xuyên-phiên--xuyên-tab-global-full-text-search)
   - [FR-08: Lưu trữ, Quản lý & Chỉnh sửa Dữ liệu Bảng Kết quả (Saved Tables & Inline Row Editor)](#fr-08-lưu-trữ-quản-lý--chỉnh-sửa-dữ-liệu-bảng-kết-quả-saved-tables--inline-row-editor)
   - [FR-09: Hệ thống Nhật ký Kiểm toán & Giám sát Hoạt động (Audit Logging & Log Viewer)](#fr-09-hệ-thống-nhật-ký-kiểm-toán--giám-sát-hoạt-động-audit-logging--log-viewer)
   - [FR-10: Tự động Tái xác thực & Chống Gián đoạn Phiên (Session Auto-healing & Resilience)](#fr-10-tự-động-tái-xác-thực--chống-gián-đoạn-phiên-session-auto-healing--resilience)
   - [FR-11: Quản lý Tiến trình Hỗ trợ Cục bộ (Native Messaging) & Tự động Cập nhật (Auto-update)](#fr-11-quản-lý-tiến-trình-hỗ-trợ-cục-bộ-native-messaging--tự-động-cập-nhật-auto-update)
5. [YÊU CẦU PHI CHỨC NĂNG (NON-FUNCTIONAL REQUIREMENTS - NFR)](#5-yêu-cầu-phi-chức-năng-non-functional-requirements---nfr)
6. [MÔ HÌNH DỮ LIỆU & ĐẶC TẢ GIAO THỨC TÍCH HỢP](#6-mô-hình-dữ-liệu--đặc-tả-giao-thức-tích-hợp)
7. [QUY TẮC NGHIỆP VỤ CỐT LÕI (BUSINESS RULES - BR)](#7-quy-tắc-nghiệp-vụ-cốt-lõi-business-rules---br)
8. [MA TRẬN KIỂM THỬ & NGHIỆM THU (ACCEPTANCE CRITERIA)](#8-ma-trận-kiểm-thử--nghiệm-thu-acceptance-criteria)

---

### 1. TỔNG QUAN DỰ ÁN & BỐI CẢNH NGHIỆP VỤ

#### 1.1. Bối cảnh bài toán
- **Hệ thống mục tiêu**: Phần mềm Quản lý Thông tin Bệnh viện **VNPT HIS** (thuộc hệ sinh thái `vncare.vn`), triển khai phân tán trên nhiều cụm máy chủ và tỉnh/thành (Hưng Yên `bvhungyen.vncare.vn`, Thái Bình `bvthaibinh.vncare.vn`, Bệnh viện Đa khoa `bvdakhoa.vncare.vn`,...).
- **Cấu trúc dữ liệu**: Lưu trữ trên hệ quản trị cơ sở dữ liệu Oracle Database theo mô hình Multi-tenant. Mỗi Cơ sở Y tế (CSYT) được định danh bởi một mã `CSYTID` và sở hữu một `Schema` dữ liệu riêng biệt (ví dụ: `HIS_DATA_HYN_VANGIANG`, `HIS_DATA_HYN_PHONOI`,...).
- **Nỗi đau vận hành (Pain points)**:
  1. Kỹ sư triển khai và IT bệnh viện khi cần kiểm tra dữ liệu, trích xuất báo cáo BHYT (theo QĐ 6556, QĐ 130, thông tư BHXH) hoặc sửa lỗi nghiệp vụ phải thao tác qua các màn hình web hành chính (`../danhmuc/UTILS_PE_TLEE`), tốc độ phản hồi chậm, không hỗ trợ soạn thảo cú pháp nâng cao, dễ mất phiên làm việc.
  2. Báo cáo Jasper (.jrxml) dùng để in phôi BHYT hoặc bảng kê viện phí đòi hỏi quá trình kiểm thử (preview/fill data) rất phức tạp khi cần ghép nối giữa câu lệnh PL/SQL Cursor (`ORACLE_REF_CURSOR`) và dữ liệu thực tế tại bệnh viện.
  3. Dữ liệu công việc (câu lệnh SQL, tham số, phiên test) thường xuyên bị mất khi trình duyệt reload hoặc ngắt kết nối.

#### 1.2. Mục tiêu của phần mềm
Xây dựng một môi trường làm việc tập trung (HIS SQL Console Pro) dưới dạng **Browser Extension (Manifest V3)** kết hợp với máy chủ phụ trợ cục bộ (**Jasper Helper Daemon**):
- Cung cấp trình soạn thảo PL/SQL chuyên nghiệp (Monaco Editor) ngay trên trình duyệt.
- Tự động hóa phân trang dữ liệu Oracle, đếm tổng bản ghi bất đồng bộ, xuất Excel khối lượng lớn.
- Cho phép tra cứu, xem mã nguồn DDL và chạy trực tiếp Stored Procedure / Function với form tham số thông minh.
- Biên dịch, nạp dữ liệu và kết xuất file PDF xem trước từ mã nguồn Jasper `.jrxml`.
- Cơ chế bảo vệ dữ liệu chống mất mát 100% qua mô hình lưu trữ đối xứng kép.

---

### 2. TÁC NHÂN & CHÂN DUNG NGƯỜI DÙNG (USER PERSONAS)

| Mã tác nhân | Tên vai trò | Mục tiêu sử dụng | Tần suất |
| :--- | :--- | :--- | :--- |
| **ACT-01** | **Kỹ sư Triển khai / Hỗ trợ HIS (Support Engineer)** | - Chạy truy vấn tra cứu hồ sơ bệnh nhân, thông tin thẻ BHYT, giao dịch viện phí.<br>- Bù dữ liệu, chạy thủ tục tính toán chi phí.<br>- Chuyển đổi nhanh giữa các cơ sở y tế (CSYT) trong cùng một tỉnh. | Hàng ngày (liên tục) |
| **ACT-02** | **Lập trình viên Báo cáo (Jasper Report Developer)** | - Nạp file `.jrxml`, kiểm tra giao diện bảng kê, biên dịch và render ra PDF trực tiếp để đối chiếu mẫu in.<br>- Lưu các phiên preview để tái kiểm tra khi thay đổi logic SQL. | Thường xuyên |
| **ACT-03** | **Quản trị viên Hệ thống CSDL (DBA / HIS Admin)** | - Khám phá các package, procedure, function hệ thống (`DMC`, `S`, `MED`, `KQDICHVU`).<br>- Giám sát câu lệnh thực thi thông qua bảng điều khiển nhật ký (Log Viewer). | Định kỳ / Khi xử lý sự cố |

---

### 3. KIẾN TRÚC HỆ THỐNG & MÔ HÌNH TƯƠNG TÁC

Hệ thống hoạt động theo mô hình 4 tầng phối hợp:

```
+-------------------------------------------------------------------------+
|                  BROWSER EXTENSION (Chrome / Firefox MV3)               |
|                                                                         |
|  +---------------------------+       +-------------------------------+  |
|  |   UI Tab (ui.html/ui.js)  | <---> | Content Script (content.js)   |  |
|  | - Monaco Editor           |       | - Injected vào trang HIS      |  |
|  | - Result Grid & Row Editor|       | - Auto search UTILS_PE_TLEE   |  |
|  | - Modals & Layout Manager |       | - LocalStorage Storage Mirror |  |
|  +---------------------------+       +-------------------------------+  |
|               ^                                                         |
|               | (chrome.runtime.sendMessage)                            |
|               v                                                         |
|  +-------------------------------------------------------------------+  |
|  |             Service Worker Background (background.js)             |  |
|  | - Authentication & Token Cache (JWT Management)                   |  |
|  | - Session Auto-healing & Transparent Relogin                      |  |
|  | - Server-side Query Paging (OFFSET/FETCH) & Async Row Count       |  |
|  | - Native Messaging Dispatcher                                     |  |
|  +-------------------------------------------------------------------+  |
+-----------------------------------|-------------------------------------+
                                    |
            +-----------------------+-----------------------+
            | (Native Host:         | (HTTPS RestService:  |
            | com.his.jasper_helper)| doLogin, ajaxCALL_SP) |
            v                       v                       v
+------------------------+      +-----------------------------------------+
| LOCAL NATIVE DAEMON    |      | VNPT HIS CLOUD / BACKEND                |
| (Jasper Helper Server) |      |                                         |
| Port: localhost:8080   |      | RestService:                            |
| - JasperReports Engine |      | - prc_login                             |
| - SQLite Logs DB       |      | - ajaxCALL_SP_O (SQL & Procedures)      |
| - Report Sessions JSON |      | - ajaxCALL_SP_S / ajaxExecuteQueryPaging|
| - Local Extension Update      | Oracle Database (DMC, S, MED, Schemas)  |
+------------------------+      +-----------------------------------------+
```

---

### 4. YÊU CẦU NGHIỆP VỤ CHỨC NĂNG CHI TIẾT (FUNCTIONAL REQUIREMENTS)

#### FR-01: Quản trị Đa Phân vùng / Đa Điểm kết nối (Multi-site Management)
- **FR-01.1**: Hỗ trợ chuyển đổi độc lập giữa các site triển khai:
  - Site Hưng Yên (`hung_yen`): RestService tại `https://bvhungyen.vncare.vn/vnpthis/RestService`.
  - Site Thái Bình (`thai_binh`): RestService tại `https://bvthaibinh.vncare.vn/vnpthis/RestService`.
- **FR-01.2**: Mỗi site duy trì không gian làm việc độc lập bao gồm:
  - Danh sách phiên (Sessions), danh sách tab truy vấn (Tabs), nội dung SQL, trạng thái con trỏ và vùng chọn trong editor (Monaco ViewState).
- **FR-01.3**: Khi chuyển đổi Site trên Sidebar, hệ thống tự động lưu lại toàn bộ trạng thái của Site cũ vào bộ nhớ (`tabsBySite`, `sessionsBySite`) trước khi kích hoạt không gian làm việc của Site mới.

#### FR-02: Quản lý Danh mục Đơn vị Y tế, CSYTID & Oracle Schema
- **FR-02.1 - Tra cứu CSYT**: Cung cấp công cụ tìm kiếm cơ sở y tế từ tập dữ liệu `sites_data.json`:
  - Tìm kiếm tức thời (live search) theo Tên cơ sở y tế, Mã `CSYTID`, hoặc Tên `Schema`.
  - Hỗ trợ loại bỏ dấu tiếng Việt (unaccent) và không phân biệt chữ hoa/thường.
- **FR-02.2 - Lịch sử đơn vị gần nhất**: Lưu tối đa 10 đơn vị y tế được chọn gần nhất để hiển thị dạng badge truy cập nhanh trên Sidebar và Modal chạy thủ tục.
- **FR-02.3 - Tự động thay thế tham số đơn vị (Smart Replace)**:
  - Cung cấp nút thao tác 1 chạm ("Thay thế I_HID, I_SCH") để quét nội dung SQL đang soạn thảo và thay thế:
    + Cặp tham số `I_HID` hoặc `[HID]` thành giá trị `CSYTID` đang chọn.
    + Cặp tham số `I_SCH` hoặc `[SCH]` thành chuỗi `Schema` đang chọn.
  - Cho phép sao chép nhanh `CSYTID` và `Schema` vào Clipboard với thông báo trực quan.

#### FR-03: Soạn thảo, Tối ưu & Thực thi Truy vấn SQL (Monaco IDE & Query Engine)
- **FR-03.1 - Môi trường soạn thảo chuyên nghiệp**:
  - Tích hợp Monaco Editor (nhân của VS Code) hỗ trợ tô màu cú pháp (Syntax Highlighting) cho SQL và PL/SQL.
  - Phím tắt chuẩn: `Ctrl + Enter` (Thực thi), `Ctrl + W` / `Alt + W` / `Ctrl + Q` (Đóng tab hiện tại), `Ctrl + Shift + F` (Tìm kiếm toàn cục).
  - Khả năng thực thi có chọn lọc: Nếu người dùng bôi đen đoạn text, chỉ thực thi đoạn bôi đen đó; nếu không bôi đen, thực thi toàn bộ nội dung trong tab.
- **FR-03.2 - Phân loại truy vấn thông minh** (v1.2.0: dùng `sql_utils.js`, phân tích sau khi đã loại bỏ comment và chuỗi ký tự):
  - Nhận diện theo từ khóa đầu tiên của câu lệnh:
    + `BEGIN`/`DECLARE`/`CALL`/`EXEC[UTE]`, hoặc lời gọi dùng tham số có tên (`=>`) mà không phải `SELECT`/`WITH`: đóng gói dưới dạng **Stored Procedure** (`ajaxCALL_SP_O` bọc đuôi `$$`).
    + `SELECT`/`WITH` (kể cả có `=>` bên trong): áp dụng phân trang phía máy chủ.
  - Từ khóa nằm trong comment hoặc chuỗi (ví dụ `'PLEASE CALL ME'`, `-- UPDATE`) không còn làm phân loại sai.
- **FR-03.2b - Kiểm soát lệnh nguy hiểm & Chế độ chỉ đọc** (mới v1.2.0):
  - `UPDATE`/`DELETE` thiếu `WHERE` (tính trên mã đã bỏ comment/chuỗi): bị CHẶN nếu là lệnh DML trực tiếp; cảnh báo mức cao nếu nằm trong khối PL/SQL.
  - Khối PL/SQL chứa DML, DDL (`DROP`/`TRUNCATE`/`ALTER`/`GRANT`...), `EXECUTE IMMEDIATE`/`DBMS_SQL`, hoặc `SELECT ... FOR UPDATE`: hiện hộp thoại xác nhận liệt kê lý do trước khi chạy.
  - Nút **Chỉ đọc** trên thanh công cụ: khi bật chỉ cho phép `SELECT`/`WITH`; mọi lệnh khác bị chặn ở cả UI lẫn `background.js` (phòng thủ nhiều lớp). Mặc định Tắt, trạng thái lưu cục bộ.
- **FR-03.3 - Phân trang dữ liệu phía Server (Server-side Pagination)**:
  - Mặc định mỗi trang tải 50 dòng (tùy chọn: 10, 20, 50, 100, 200, 500).
  - Tự động bổ sung mệnh đề phân trang Oracle:
    `OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY` (v1.2.0: bỏ dấu `;`/`/` cuối câu trước khi ghép; chữ `OFFSET`/`FETCH` nằm trong chuỗi hoặc comment không còn làm bỏ qua phân trang).
  - Cảnh báo khi câu truy vấn không có `ORDER BY` ở mức ngoài cùng: thứ tự giữa các trang không được đảm bảo (có thể trùng/sót dòng).
  - Bộ điều khiển phân trang đầy đủ: `« Đầu`, `‹ Trước`, `Trang X / Y`, `Sau ›`, `Cuối »`.
- **FR-03.4 - Cơ chế đếm tổng bản ghi bất đồng bộ (Smart Background Row Count)**:
  - Khi người dùng chọn "Đếm tổng":
    + Câu truy vấn lấy dữ liệu được gửi đi trước để render ngay kết quả trang đầu.
    + Nếu câu lệnh có sẵn Window Function `COUNT(*) OVER(...)`, bóc tách trực tiếp tổng bản ghi từ cột kết quả đầu tiên mà không tạo thêm request đếm.
    + Nếu không có Window Function, tự động kích hoạt luồng đếm ngầm: `SELECT COUNT(*) as TOTAL FROM ( <câu_sql_gốc> )`.
- **FR-03.5 - Định dạng & Làm sạch SQL**:
  - **Clean SQL**: Tự động loại bỏ comment (`--`, `/* ... */`) và khoảng trắng thừa.
  - **Format SQL**: Căn lề chuẩn PL/SQL; chuẩn hóa hàm `DECODE` phức tạp nhiều tầng thành các khối thụt lề dễ đọc.
- **FR-03.6 - Xuất dữ liệu Excel chuyên sâu**:
  - Xuất dữ liệu ra file `.xlsx` bằng `SheetJS`.
  - Nếu kết quả nhiều hơn số dòng trên 1 trang, hiển thị hộp thoại lựa chọn:
    1. **Chỉ xuất trang hiện tại** (nhanh).
    2. **Xuất toàn bộ kết quả** (kích hoạt `noLimit = true`, tự động lấy tối đa 100.000 dòng từ máy chủ).

#### FR-04: Khám phá, Phân tích & Thực thi Thủ tục / Hàm (Stored Procedure / Function Runner)
- **FR-04.1 - Tra cứu Object trên Database**:
  - Tra cứu đối tượng từ các view hệ thống Oracle: `USER_OBJECTS` và `ALL_OBJECTS` (giới hạn các Schema cốt lõi: `DMC`, `S`, `MED`, `KQDICHVU`).
  - Hỗ trợ lọc theo loại đối tượng: `PROCEDURE`, `FUNCTION`, `PACKAGE`, `PACKAGE BODY`.
- **FR-04.2 - Bóc tách mã nguồn (DDL Extraction)**:
  - Tải mã nguồn đối tượng từ view `ALL_SOURCE`, ghép dòng và đưa trực tiếp vào Monaco Editor để xem và chỉnh sửa.
- **FR-04.3 - Bóc tách tham số tự động (Parameter Parsing Engine)**:
  - Tự động phân tích cú pháp khai báo tham số để xác định:
    + Tên tham số, chiều tham số (`IN`, `OUT`, `IN/OUT`), kiểu dữ liệu (`VARCHAR2`, `NUMBER`, `DATE`, `TIMESTAMP`, `SYS_REFCURSOR`).
    + Danh sách các Subprogram con trong Package.
- **FR-04.4 - Sinh Form nhập tham số động (Dynamic Runner Modal)**:
  - Giao diện nhập giá trị cho từng tham số đầu vào:
    + Tự động nhận diện và điền nhanh giá trị từ đơn vị đang chọn cho các tham số CSYTID (`I_HID`, `P_HID`) và Schema (`I_SCH`, `P_SCH`).
    + Tham số kiểu `DATE` / `TIMESTAMP` cung cấp trình chọn ngày giờ trực quan, tự động chuyển đổi thành `TO_DATE('...', 'DD/MM/YYYY HH24:MI:SS')` hoặc `TO_TIMESTAMP(...)`.
    + Ghi nhớ giá trị tham số đã nhập theo tên hàm vào `localStorage`.
- **FR-04.5 - Xử lý kết quả trả về từ Cursor**:
  - Tự động bẫy kết quả con trỏ `OUT SYS_REFCURSOR` và hiển thị danh sách dòng dữ liệu trực tiếp lên Grid kết quả.

#### FR-05: Kết xuất Báo cáo Jasper (.jrxml) & Quản lý Phiên Preview (JasperReports Engine)
- **FR-05.1 - Trình đọc & Phân tích cấu trúc JRXML**:
  - Nhận file mẫu in `.jrxml` qua upload hoặc paste trực tiếp.
  - Tự động phân tích XML để bóc tách:
    + Khối `queryString`: Nhận diện câu gọi thủ tục báo cáo (ví dụ: `{call INBK697_HYN_07062026($P{[UID]}, $P{[HID]}, ...)}`).
    + Danh sách thẻ `<parameter>`: Trích xuất các tham số báo cáo cần truyền (`[HID]`, `[SCH]`, `tiepnhanid`,...).
- **FR-05.2 - Quy trình kết xuất 2 bước**:
  - Bước 1: Thực thi câu lệnh SQL/Thủ tục khai báo trong JRXML để lấy dữ liệu thô JSON từ CSDL HIS.
  - Bước 2: Gửi gói tin `{ jrxml, jsonData, parameters }` sang **Jasper Helper Server** (`http://localhost:8080/fill`).
- **FR-05.3 - Trình xem PDF nhúng (Embedded PDF Viewer)**:
  - Nhận Binary Stream PDF, tạo `Blob URL` và nhúng vào `<iframe>` trong modal.
  - Cung cấp đầy đủ công cụ: In trực tiếp (Print), phóng to/thu nhỏ, tải file PDF về máy.
- **FR-05.4 - Quản lý Phiên Báo cáo (Report Sessions Management)**:
  - Lưu toàn bộ trạng thái báo cáo (mã `.jrxml`, giá trị tham số, snapshot dữ liệu JSON) thành phiên trên ổ đĩa (`report_sessions/session_<timestamp>.json`).
  - Hỗ trợ 2 chế độ mở lại phiên:
    1. **Kết xuất bằng dữ liệu cũ (Old Data)**: Xem lại bản snapshot dữ liệu đã lưu.
    2. **Kết xuất bằng dữ liệu mới (Live Data)**: Tự động chạy lại câu lệnh SQL trên CSDL thời điểm hiện tại và render bản in mới.

#### FR-06: Quản lý Phiên làm việc (Sessions) & Tab Truy vấn Đa tầng
- **FR-06.1 - Cấu trúc quản trị 2 tầng (Hierarchical Tabs)**:
  - **Tầng 1 (Session Tab Bar)**: Đại diện cho phiên làm việc/nhiệm vụ lớn.
  - **Tầng 2 (Query Tab Bar)**: Các câu truy vấn con bên trong phiên.
- **FR-06.2 - Cơ chế Ghim Tab (Pin Tab)**:
  - Tab ghim được tô màu nhận diện riêng biệt, luôn được xếp lên đầu và được bảo vệ không thể đóng khi chưa bỏ ghim.
- **FR-06.3 - Lưu trữ Đa tầng Chống mất dữ liệu (Resilient Persistence)**:
  - Tự động lưu tức thời (`Debounce Auto-Save`) khi gõ phím hoặc thao tác tab.
  - Cơ chế ghi kép đối xứng:
    1. `chrome.storage.local`: Bộ nhớ chính của Extension.
    2. `localStorage` của các tab web VNPT HIS đang mở: Hoạt động như Storage Mirror. Khi trình duyệt gặp sự cố hoặc extension bị xóa dữ liệu, hệ thống tự động khôi phục toàn bộ tab từ `localStorage`.

#### FR-07: Tìm kiếm Toàn cục Xuyên Phiên / Xuyên Tab (Global Full-text Search)
- **FR-07.1 - Kích hoạt**: Phím tắt `Ctrl + Shift + F` hoặc nút "Tìm Text" trên thanh công cụ.
- **FR-07.2 - Phạm vi quét**: Quét toàn bộ các phiên làm việc và toàn bộ các tab con (kể cả tab đang mở hoặc tab ẩn). Tùy chọn khớp hoa/thường (Match Case) hoặc khớp toàn từ (Whole Word).
- **FR-07.3 - Điều hướng chính xác**: Nhấp vào dòng kết quả tự động chuyển sang đúng Phiên, kích hoạt đúng Tab, đưa con trỏ Monaco Editor đến chính xác dòng/cột và highlight từ khóa.

#### FR-08: Lưu trữ, Quản lý & Chỉnh sửa Dữ liệu Bảng Kết quả (Saved Tables & Inline Row Editor)
- **FR-08.1 - Chụp ảnh bảng kết quả**: Lưu tập dữ liệu hiện tại vào bộ nhớ lưu trữ kèm tên và mô tả.
- **FR-08.2 - Chỉnh sửa dữ liệu dòng (Inline Row Editor Modal)**:
  - Quản lý danh sách các bảng đã lưu.
  - Chỉnh sửa giá trị từng cột trên một dòng thông qua form modal động.
  - Thêm dòng mới, xóa dòng dữ liệu.
  - Tạo bảng trống thủ công với danh sách cột tùy chọn để nhập liệu thử nghiệm.
  - Xuất bảng đã lưu ra Excel bất kỳ lúc nào.

#### FR-09: Hệ thống Nhật ký Kiểm toán & Giám sát Hoạt động (Audit Logging & Log Viewer)
- **FR-09.1 - Ghi log tự động**: Ghi nhận chi tiết mọi hành vi: `SQL_EXEC`, `SEARCH_PROC`, `RUN_PROC`, `TOKEN_EXPIRED`, `SP_S_RETRY`, `JASPER_FILL`.
- **FR-09.2 - Lưu trữ bền vững**: Gửi log về Jasper Helper Server để ghi vào CSDL SQLite cục bộ `query_tool_logs.db`.
- **FR-09.3 - Giao diện tra cứu (Log Viewer Modal)**: Lọc log theo ngày, tìm kiếm nội dung theo từ khóa, lọc theo loại hành động.

#### FR-10: Tự động Tái xác thực & Chống Gián đoạn Phiên (Session Auto-healing & Resilience)
- **FR-10.1 - Quản lý độc lập tài khoản hệ thống**: Extension duy trì thông tin xác thực riêng biệt với tài khoản admin hệ thống cho từng Site, không phụ thuộc vào phiên làm việc trên tab web người dùng.
  - (v1.2.0) Tài khoản/mật khẩu **không còn nằm trong mã nguồn**. Người dùng nhập qua nút **🔑 Tài khoản** (hoặc tự hiện hộp thoại ở lần chạy đầu khi site chưa có cấu hình); extension đăng nhập thử, chỉ lưu khi thành công và giữ nguyên cấu hình cũ nếu thông tin mới sai. Mật khẩu lưu trong `chrome.storage.local`, không bao giờ được trả ngược ra giao diện.
- **FR-10.2 - Cơ chế phát hiện hết hạn phiên**:
  - Kiểm tra hạn token JWT (`isJwtExpired`): Nếu `exp <= Date.now() + 60s` xem như hết hạn.
  - Bắt các mã lỗi nghiệp vụ từ VNPT HIS: `session=NULL`, `error_code: 2`, hoặc các chuỗi `"phiên"`, `"hết hạn"`, `"đã có lỗi xảy ra khi xử lý dữ liệu"`.
- **FR-10.3 - Tự động tái đăng nhập ngầm**:
  - Khi token hết hạn hoặc session timeout: Xóa token cache, tự động gọi `doLogin` lấy JWT mới, tự động thực thi lại câu lệnh ban đầu mà không làm gián đoạn trải nghiệm người dùng.
  - (v1.2.0) **Phân biệt lệnh đọc và lệnh ghi**: với `SELECT`/đếm/liệt kê, giữ cơ chế nhận diện rộng như cũ. Với thủ tục/lệnh ghi, chỉ gọi lại khi tín hiệu hết phiên là chắc chắn (`session=NULL`, `error_code: 2`, thông báo chứa "phiên"/"hết hạn"); lỗi Oracle thông thường không bị chạy lặp.
  - Nhiều yêu cầu cùng hết phiên chỉ kích hoạt **một** lần đăng nhập; mỗi lệnh gọi RestService có thời gian chờ tối đa 180 giây.

#### FR-11: Quản lý Tiến trình Hỗ trợ Cục bộ (Native Messaging) & Tự động Cập nhật
- **FR-11.1 - Khởi chạy Native Host**:
  - Kiểm tra tình trạng máy chủ Jasper Helper tại `http://localhost:8080/list-logs`.
  - Nếu chưa chạy, tự động khởi động thông qua Native Messaging Host `com.his.jasper_helper`.
  - Hiển thị badge trạng thái (Xanh: Sẵn sàng, Đỏ: Mất kết nối).
- **FR-11.2 - Tự động cập nhật (Auto-update System)**:
  - Đọc phiên bản từ `version.json` trên Cloud (GitHub).
  - So sánh Semantic Version với phiên bản hiện tại.
  - Hiển thị thông báo Changelog (đã escape HTML) và nút cập nhật tự động qua endpoint `/update-extension` của Jasper Helper hoặc tải gói nén.
  - (v1.2.0) **Cập nhật an toàn**: `version.json` phải kèm `sha256` của gói (do `package_release.ps1` tự sinh); Jasper Helper chỉ tải từ HTTPS tới các host GitHub được phép (kiểm tra lại ở mọi lần chuyển hướng), so khớp SHA-256 rồi mới giải nén, chỉ giải nén tệp tĩnh (js/html/css/json/ảnh/font), từ chối `.exe/.jar/.bat/.vbs...`, chặn zip-slip, giới hạn dung lượng. Thiếu SHA-256 thì chuyển sang tải thủ công.

---

### 5. YÊU CẦU PHI CHỨC NĂNG (NON-FUNCTIONAL REQUIREMENTS - NFR)

- **NFR-01 (Hiệu năng thao tác)**: Phản hồi gõ phím trên Monaco Editor đạt độ trễ < 16ms (60fps).
- **NFR-02 (Không chặn luồng UI)**: Việc đếm tổng số dòng dữ liệu (`COUNT(*)`) phải thực thi bất đồng bộ, tuyệt đối không làm chậm việc render dữ liệu bảng của trang hiện tại.
- **NFR-03 (Quản lý bộ nhớ xuất file)**: Thao tác xuất Excel với tập dữ liệu lớn (lên tới 100.000 dòng) phải được chia khối hoặc hiển thị thanh tiến trình rõ ràng, tránh tràn bộ nhớ trình duyệt.
- **NFR-04 (Toàn vẹn dữ liệu)**: Cơ chế ghi kép vào cả `chrome.storage.local` và `localStorage` đảm bảo khôi phục toàn bộ tab/phiên đã được lưu; do dùng auto-save có debounce nên phần gõ dở trong khoảng debounce cuối cùng trước sự cố có thể chưa được lưu (mục tiêu: mất tối đa vài giây thao tác, không mất tab/phiên).
- **NFR-05 (Xử lý lỗi toàn diện)**: Mọi lỗi mạng phát sinh từ API VNPT HIS hoặc Jasper Helper phải được bẫy và hiển thị rõ ràng qua hộp thoại SweetAlert2, không để xảy ra unhandled promise rejection.
- **NFR-06 (Bảo mật thông tin đăng nhập)**: Mật khẩu và thông tin đăng nhập hệ thống **không được nằm trong mã nguồn hay kho Git**; chỉ lưu trong `chrome.storage.local` và chỉ được `background.js` (Service Worker) sử dụng, không bao giờ trả ra giao diện. Các lệnh nhạy cảm chỉ được nhận từ trang của chính extension.
- **NFR-09 (Bảo mật cổng cục bộ)**: Jasper Helper chỉ lắng nghe trên `127.0.0.1`, chỉ chấp nhận `Origin` là extension (`chrome-extension://`/`moz-extension://`, có thể ghim ID qua `QT_ALLOWED_ORIGINS`) hoặc client cục bộ không phải trình duyệt; kiểm tra `Host` chống DNS rebinding; mã phiên báo cáo chỉ gồm `[A-Za-z0-9_-]` (chống path traversal); thao tác xóa chỉ nhận `POST`.
- **NFR-10 (Lưu giữ dữ liệu)**: Log thao tác cũ hơn 30 ngày được tự xóa khi Helper khởi động (đổi bằng `QT_LOG_RETENTION_DAYS`, `0` = giữ vĩnh viễn). Phiên báo cáo do người dùng lưu không tự xóa.
- **NFR-07 (Bảo vệ dữ liệu y tế)**: Không gửi dữ liệu bệnh nhân hay thông tin y tế ra bất kỳ máy chủ bên ngoài nào ngoại trừ các endpoint được cấp quyền trong file `manifest.json`.
- **NFR-08 (Đa nền tảng trình duyệt)**: Tương thích hoàn chỉnh trên Chromium (Chrome, Edge, Cốc Cốc - MV3) và Mozilla Firefox (gói `.xpi`).

---

### 6. MÔ HÌNH DỮ LIỆU & ĐẶC TẢ GIAO THỨC TÍCH HỢP

#### 6.1. Cấu trúc dữ liệu lưu trữ Tab & Session (`tabsBySite`)
```json
{
  "hung_yen": [
    {
      "id": "tab_1710000000000_1",
      "name": "Kiểm tra thẻ BHYT",
      "sql": "SELECT * FROM DMC.DMC_THE_BHYT WHERE ROWNUM <= 50",
      "pinned": true,
      "page": 1,
      "pageSize": 50,
      "totalRows": 1250,
      "objectName": null,
      "objectType": null,
      "createdAt": "10/11/2026, 14:00:00"
    }
  ],
  "thai_binh": []
}
```

#### 6.2. Đặc tả giao thức API VNPT HIS RestService
1. **Đăng nhập (`doLogin`)**:
   - `func`: `"doLogin"`, `uuid`: `""`
   - `params`: `["{?=call prc_login(?2S,?3S)}", "<USERNAME>", "<PASSWORD>"]`
   - Trả về: Đối tượng chứa trường `UUID` (JWT Token).

2. **Thực thi SQL / Stored Procedure (`ajaxCALL_SP_O`)**:
   - `func`: `"ajaxCALL_SP_O"`, `uuid`: `"<JWT_UUID>"`
   - `params`: `["S.KQDICHVU.HYN3", "$\n\n<NỘI_DUNG_SQL>\n$", 0]`
   - Trả về: Mảng JSON kết quả dữ liệu hoặc thông báo lỗi từ Oracle.

3. **Thực thi thủ tục tham số mảng (`ajaxCALL_SP_S`)**:
   - `func`: `"ajaxCALL_SP_S"`, `uuid`: `"<JWT_UUID>"`
   - `params`: `["<P1>", "<P2>", ...]`

#### 6.3. Đặc tả giao thức Jasper Helper Server (Port 8080)
- **POST `/fill`**: Input `{ jrxml, jsonData, parameters }` -> Output Binary Stream PDF (`application/pdf`).
- **POST `/write-log`**: Input `{ date, log }` -> Ghi log vào SQLite.
- **GET `/list-logs`**: Output danh sách ngày có log `["10112026", "09112026"]`.
- **POST `/save-session`**: Input JSON cấu hình phiên báo cáo -> Lưu vào thư mục `report_sessions/`.

---

### 7. QUY TẮC NGHIỆP VỤ CỐT LÕI (BUSINESS RULES - BR)

- **BR-01 (Giới hạn dòng xuất tối đa)**: Khi xuất toàn bộ kết quả (`noLimit = true`), số dòng tối đa cho phép lấy về máy trạm là `100.000` dòng.
- **BR-02 (Quy tắc bao đóng Stored Procedure)**: Khối lệnh PL/SQL gửi qua cổng `ajaxCALL_SP_O` phải luôn được kết thúc bằng ký tự `$$`.
- **BR-03 (Bảo vệ Tab được Ghim)**: Không cho phép đóng tab khi tab đang ở trạng thái Ghim (`pinned = true`) trừ khi người dùng thực hiện bỏ ghim trước.
- **BR-04 (Xử lý định dạng ngày tháng y tế)**:
  - Tham số dạng ngày (`DD/MM/YYYY`) tự động ghép `00:00:00` và chuyển đổi thành `TO_DATE(..., 'DD/MM/YYYY HH24:MI:SS')`.
  - Tham số dạng timestamp chuyển đổi thành `TO_TIMESTAMP(...)`.
- **BR-06 (Không thực thi lặp lệnh ghi)**: Lệnh ghi/thủ tục không được gọi lại tự động sau lỗi trừ khi máy chủ báo hết phiên một cách chắc chắn.
- **BR-07 (Chế độ chỉ đọc)**: Khi bật, chỉ `SELECT`/`WITH` không có `FOR UPDATE`/DML/DDL được phép thực thi từ trình soạn thảo chính.
- **BR-05 (Thứ tự ưu tiên đơn vị y tế)**: Khi chọn CSYT trên Sidebar, cặp `CSYTID` và `Schema` tự động làm giá trị mặc định cho modal gọi thủ tục và modal Jasper.

---

### 8. MA TRẬN KIỂM THỬ & NGHIỆM THU (ACCEPTANCE CRITERIA)

| Mã TC | Kịch bản kiểm thử (Test Scenario) | Kết quả kỳ vọng (Expected Result) |
| :--- | :--- | :--- |
| **TC-01** | Thực thi câu lệnh `SELECT` thông thường với phân trang. | Dữ liệu hiển thị đúng 50 dòng trên Grid, thanh phân trang báo đúng số trang, thời gian chạy hiển thị chính xác ở thanh trạng thái. |
| **TC-02** | Thực thi câu lệnh có `COUNT(*) OVER()`. | Hệ thống trích xuất tổng số dòng ngay lập tức từ dòng kết quả đầu tiên mà không tạo thêm request đếm thứ hai. |
| **TC-03** | Mô phỏng JWT token hết hạn khi đang chạy truy vấn. | Background phát hiện token hết hạn, gọi `doLogin` lấy UUID mới, chạy lại truy vấn thành công mà người dùng không bị văng lỗi. |
| **TC-04** | Tìm kiếm từ khóa bằng `Ctrl + Shift + F`. | Modal tìm kiếm liệt kê đúng vị trí từ khóa ở mọi phiên/tab; click vào dòng kết quả tự động nhảy tới đúng dòng trên editor. |
| **TC-05** | Tải file `.jrxml` và bấm "Render Báo Cáo". | Hệ thống lấy dữ liệu qua SQL trong jrxml, gọi tới `localhost:8080/fill`, và hiển thị tài liệu PDF trực tiếp trên khung preview iframe. |
| **TC-06** | Đóng trình duyệt đột ngột khi đang soạn dở SQL, sau đó mở lại. | 100% nội dung các tab, phiên làm việc được khôi phục nguyên vẹn từ bộ nhớ đệm `storage.local` hoặc bản sao lưu `localStorage`. |
| **TC-07** | Nhấn phím tắt `Ctrl + Enter` khi đang bôi đen 1 khối lệnh. | Chỉ khối lệnh được bôi đen được gửi đi thực thi, các dòng lệnh còn lại ngoài vùng chọn không bị ảnh hưởng. |
| **TC-08** | Chưa cấu hình tài khoản cho site rồi chạy `SELECT`. | Hiện hộp thoại nhập tài khoản; lưu thành công thì truy vấn tự chạy lại; sai mật khẩu thì giữ cấu hình cũ. |
| **TC-09** | Chạy `-- ghi chú` xuống dòng rồi `UPDATE t SET a=1` (không WHERE). | Bị chặn hoàn toàn (bản cũ bỏ lọt vì chỉ xét đầu chuỗi thô). |
| **TC-10** | Bật nút Chỉ đọc rồi chạy `UPDATE`/`BEGIN...END`. | Bị chặn với thông báo chế độ chỉ đọc; `SELECT` vẫn chạy bình thường. |
| **TC-11** | `SELECT ... ORDER BY id;` (có dấu `;` cuối) và `SELECT ... -- ghi chú`. | Phân trang và đếm tổng chạy đúng, không lỗi cú pháp. |
| **TC-12** | Thủ tục trả `ORA-` lỗi thông thường. | Chỉ gọi RestService đúng 1 lần, không đăng nhập lại và chạy lặp. |
| **TC-13** | Trang web bất kỳ gọi `fetch('http://localhost:8080/update-extension')`. | Bị từ chối `403`; các endpoint khác cũng không đọc được từ trang web lạ. |
| **TC-14** | Cập nhật với gói sai SHA-256 / chứa `.exe` / có `../`. | Sai hash: hủy, không ghi tệp nào. `.exe`, `.bat`, `../` bị bỏ qua. DB/log/phiên báo cáo không bị ghi đè. |
| **TC-15** | Chạy bộ kiểm thử tự động `node --test tests/*.test.js`. | Toàn bộ test đạt (phân tích SQL, phân trang, tự xác thực lại, tài khoản).
