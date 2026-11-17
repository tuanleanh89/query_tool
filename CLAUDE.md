# CLAUDE.md - Guidelines for Anthropic Claude Code

## Project Overview
**VNPT HIS SQL Query Tool & Report Console Pro** is an enterprise-grade developer tool for engineers and administrators working with the VNPT HIS (Hospital Information System) platform on `vncare.vn`. It runs as a Browser Extension (Manifest V3 for Chromium & Firefox) paired with a local Java/C# Native Daemon (`jasper_helper`) to execute Oracle PL/SQL queries, inspect Stored Procedures/Packages, render JasperReports (.jrxml) to PDF, and maintain a resilient query workspace.

---

## Repository Architecture

```
D:\Project_new\query_tool\
├── code\                       # Browser Extension (Manifest V3)
│   ├── manifest.json           # Extension manifest (v1.2.0, permissions, content_scripts)
│   ├── sql_utils.js            # Phân tích SQL dùng chung (UI + service worker), có unit test
│   ├── background.js           # Service worker: API bridge, auth/JWT management, paging, native host
│   ├── content.js              # Content script: VNPT HIS DOM integration & dual localStorage backup
│   ├── ui.html                 # Main IDE UI layout (Monaco Editor, sessions, tabs, modals, grid)
│   ├── ui_state.js, ui_core.js, ui.js, ui_tabs.js, ui_query.js,
│   │   ui_units.js, ui_system.js, ui_tables.js, ui_sessions.js, ui_search.js
│   │                           # UI logic tách từ ui.js cũ; script cổ điển dùng chung phạm vi toàn cục,
│   │                           # PHẢI nạp đúng thứ tự trong ui.html (state→core→ui→tabs→query→units→system→tables→sessions→search)
│   ├── sites_data.json         # Hospital site metadata (CSYTID, Schema names, Customer names)
│   ├── vs/                     # Embedded Monaco Editor (VS Code web editor engine)
│   ├── package_release.ps1     # PowerShell packaging script for Chrome (.zip) & Firefox (.xpi)
│   ├── package_release.bat     # Batch wrapper for packaging script
│   └── release_dist/           # Output directory for release builds & version.json
├── jasper_helper\              # Local Companion Server (Port 8080) & Native Messaging Host
│   ├── pom.xml                 # Maven configuration (Java, JasperReports 6.x, Spring Boot / Undertow)
│   ├── src\                    # Java backend source code
│   ├── jasper-helper.jar       # Compiled Java daemon (PDF render engine, log DB, session manager)
│   ├── NativeLauncher.cs       # C# wrapper for Native Messaging stdio communication
│   ├── jasper_host.exe         # Compiled native host executable
│   ├── register_native_host.bat# Script to register native messaging manifest in Windows Registry
│   ├── native_host_chrome.json # Chrome Native Messaging manifest (com.his.jasper_helper)
│   ├── native_host_firefox.json# Firefox Native Messaging manifest
│   ├── start.bat               # Starts Jasper Helper in background
│   └── run_hidden.vbs          # VBScript runner for headless background execution
├── tests\                      # Unit test (node --test tests/*.test.js)
├── backup_v1.1.2_20261111\     # Bản sao lưu mã nguồn trước khi nâng cấp v1.2.0 (không commit)
├── docs\                       # Project documentation
│   └── BUSINESS_REQUIREMENTS.md# Comprehensive Business Requirements Document (BRD)
├── query_tool_logs.db          # Local SQLite database for audit operation logs (excluded from git)
├── report_sessions\            # Saved Jasper report preview sessions (JSON + JRXML)
└── CLAUDE.md                   # Agent & coding guidelines (this file)
```

---

## Development, Build & Packaging Commands

### 1. Extension Packaging (Chrome & Firefox)
To package a release build (excludes database files, logs, and report sessions):
```powershell
# From workspace root or code directory:
cd D:\Project_new\query_tool\code
powershell -ExecutionPolicy Bypass -File .\package_release.ps1
```
Or via batch:
```cmd
cd D:\Project_new\query_tool\code
package_release.bat
```
*Output*: Generates `release_dist/query_tool_chrome.zip`, `release_dist/query_tool.xpi`, and updated `release_dist/version.json`.

### 2. Jasper Helper (Java Daemon) Build
```cmd
cd D:\Project_new\query_tool\jasper_helper
# Using Maven:
mvn clean package
```

### 3. Native Messaging Registration (Windows)
Run as Administrator if registering for system-wide native messaging:
```cmd
cd D:\Project_new\query_tool\jasper_helper
register_native_host.bat
```

### 4. Running Jasper Helper Manually
```cmd
cd D:\Project_new\query_tool\jasper_helper
start.bat
# Verifying health:
curl http://localhost:8080/list-logs
```

---

## Code Conventions & Architectural Rules

### 1. Frontend & Extension (`code/`)
- **Vanilla Modern JavaScript**: No heavy UI frameworks (React/Vue/Angular). Uses ES6+, async/await, and event-driven patterns.
- **Monaco Editor Integration**: Loaded via `vs/loader.js`. Use `editor.executeEdits(...)` for programmatic text mutations (clean SQL, format, template insertions).
- **Asynchronous Non-blocking Operations**:
  - Grid rendering must not block when executing queries.
  - Row counting (`COUNT(*)`) must always run asynchronously in the background (`chkAutoCount`), leaving the first page to render instantly.
  - Check for `COUNT(*) OVER()` window functions before triggering secondary count queries.
- **Dual-Layer Persistence**:
  - Always persist tabs and session states through `chrome.storage.local`.
  - Content script (`content.js`) mirrors state into `localStorage` of open VNPT HIS tabs (`his_sql_tool_backup`) as a disaster recovery fallback.
- **UI Libraries**:
  - Modals and tooltips: Bootstrap 5 (`bootstrap.bundle.min.js`).
  - Alerts & prompts: SweetAlert2 (`sweetalert2.all.min.js`).
  - Excel Export: SheetJS (`xlsx.full.min.js`).
  - SQL Formatting: `sql-formatter.min.js`.

### 2. Service Worker (`background.js`)
- **Manifest V3 Lifecycles**: Service workers are ephemeral. Do not store critical persistent state only in in-memory global variables; use `chrome.storage.local` with in-memory caching.
- **Session Auto-Healing & Token Resilience**:
  - Validate JWT expiration via base64 decoding of `exp` claim.
  - Automatically detect session expiration (`session=NULL`, `error_code: 2`, `"phiên"`, `"hết hạn"`).
  - Silently re-authenticate using `prc_login` via `doLogin` and transparently retry the failed request without throwing errors to the user.
- **PL/SQL Procedure Calling**:
  - Auto-wrap procedure payloads with trailing `$$` when calling `ajaxCALL_SP_O`.
  - Use `ajaxCALL_SP_S` for structured positional parameter calls.

### 3. Local Daemon (`jasper_helper`)
- **Endpoints**:
  - `POST /fill`: Accepts `{ jrxml, jsonData, parameters }`, compiles JRXML in-memory, fills report, returns binary PDF.
  - `POST /write-log` & `GET /list-logs` & `GET /get-log`: SQLite log manager.
  - `GET /list-sessions`, `GET /get-session`, `POST /save-session`, `POST /delete-session`: Report session snapshot CRUD.
  - `POST /update-extension`: In-place extension update trigger.

### 4. Language & Localization
- **Vietnamese (`vi-VN`)**: All user-facing UI labels, error messages, alerts, tooltips, and log descriptors are in Vietnamese. Maintain consistent terminology (e.g., CSYTID, Đơn vị y tế, Phiên làm việc, Bảng kê, Thẻ BHYT).

### 5. Git & Security Hygiene
- **Never commit**:
  - SQLite database files (`query_tool_logs.db`, `*.db`).
  - Runtime logs (`*.log`, `jasper_start.log`).
  - User session report snapshots (`report_sessions/session_*.json`).
  - Sensitive credentials or tokens outside the isolated service worker context.

---

## Quy tắc bổ sung từ v1.2.0

### Kiểm thử
```cmd
cd D:\Project_new\query_tool
node --test tests/*.test.js
```
Mọi thay đổi ở `sql_utils.js` hoặc `background.js` phải giữ cho bộ test này đạt. Logic phân loại/ghép phân trang/xử lý phiên đặt trong `sql_utils.js` hoặc `background.js` (có test), **không** viết lại rải rác trong các tệp `ui_*.js`.

### Bảo mật
- Công cụ nội bộ: tài khoản mặc định của 2 site nằm trong `DEFAULT_CREDENTIALS` (`background.js`) để khỏi nhập lại; nút "Tài khoản" ghi đè (lưu mã hóa trong `chrome.storage.local`, khóa `siteCredentials`). **Không đưa repo này lên nơi công khai.** Không còn chế độ chỉ đọc: người dùng toàn quyền SQL (vẫn có hộp xác nhận cho lệnh rủi ro/UPDATE-DELETE không WHERE).
- Lưu phiên/tab: `saveTabs` chỉ ghi sau khi nạp xong (`storageReady`), lưu thêm khi đóng/ẩn trang, nhớ site đang dùng (`lastSiteKey`).
- Lệnh ghi/thủ tục gọi RestService qua `callAuthed(..., { strict: true })`; chỉ lệnh đọc dùng `strict: false`.
- Jasper Helper: mọi handler mới phải gọi `Security.preflight(exchange, "<methods>")` đầu tiên; mọi mã định danh dùng làm tên tệp phải qua `SAFE_ID`/`requireSafeId`.
- Gói cập nhật phải kèm `sha256` trong `version.json` (do `package_release.ps1` sinh). Chỉ thêm host mới vào danh sách cập nhật qua biến môi trường `QT_UPDATE_HOSTS`.
- Thêm tệp mới vào extension thì phải thêm vào `$includeFiles` của `package_release.ps1` và danh sách `zip` của `update_extension.sh`.
- Không commit: `backup_*/`, DB, log, phiên báo cáo. Nếu mật khẩu cũ từng nằm trong lịch sử Git thì phải đổi mật khẩu trên HIS.
