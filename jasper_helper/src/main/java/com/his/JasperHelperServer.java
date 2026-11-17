package com.his;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import net.sf.jasperreports.engine.*;
import net.sf.jasperreports.engine.data.JsonDataSource;

import java.io.*;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.HttpURLConnection;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipEntry;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import org.json.JSONArray;
import javax.imageio.ImageIO;
import java.text.SimpleDateFormat;
import java.math.BigDecimal;
import org.w3c.dom.*;
import javax.xml.parsers.*;
import javax.xml.transform.*;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.xml.sax.InputSource;

public class JasperHelperServer {
    private static final StringBuilder logBuffer = new StringBuilder();

    static class CapturingOutputStream extends OutputStream {
        private final OutputStream original;

        public CapturingOutputStream(OutputStream original) {
            this.original = original;
        }

        @Override
        public void write(int b) throws IOException {
            original.write(b);
            synchronized (logBuffer) {
                logBuffer.append((char) b);
                if (logBuffer.length() > 50000) {
                    logBuffer.delete(0, 10000);
                }
            }
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            original.write(b, off, len);
            synchronized (logBuffer) {
                logBuffer.append(new String(b, off, len, StandardCharsets.UTF_8));
                if (logBuffer.length() > 50000) {
                    logBuffer.delete(0, 10000);
                }
            }
        }
    }

    static class LogHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "GET, OPTIONS")) return;

            try {
                String logs;
                synchronized (logBuffer) {
                    logs = logBuffer.toString();
                }

                byte[] bytes = logs.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
                exchange.sendResponseHeaders(200, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(bytes);
                }
            } catch (IOException ignored) {
            } catch (Throwable e) {
                e.printStackTrace();
            }
        }
    }

    private static java.sql.Connection dbConn = null;

    // ------------------------------------------------------------------------------------------------
    // Bảo mật cổng cục bộ (v1.2.0)
    //  - Chỉ lắng nghe trên loopback (127.0.0.1), không mở ra mạng LAN.
    //  - Chỉ chấp nhận yêu cầu đến từ extension (Origin chrome-extension:// / moz-extension://) hoặc client cục bộ
    //    không phải trình duyệt (không có Origin / Sec-Fetch-Site). Trang web bất kỳ bị từ chối (CSRF/CORS).
    //  - Kiểm tra Host để chống DNS rebinding.
    //  - Có thể ghim chính xác ID extension qua biến môi trường QT_ALLOWED_ORIGINS (phân tách bằng dấu phẩy).
    // ------------------------------------------------------------------------------------------------
    static final class Security {
        private static final java.util.Set<String> PINNED_ORIGINS = new java.util.HashSet<>();
        static {
            String env = System.getenv("QT_ALLOWED_ORIGINS");
            if (env != null) {
                for (String o : env.split(",")) {
                    String t = o.trim();
                    if (!t.isEmpty()) PINNED_ORIGINS.add(t);
                }
            }
        }

        static boolean isLoopbackHost(String hostHeader) {
            if (hostHeader == null) return false;
            String h = hostHeader.trim().toLowerCase();
            if (h.startsWith("[")) {
                int end = h.indexOf(']');
                h = end > 0 ? h.substring(0, end + 1) : h;
            } else {
                int colon = h.lastIndexOf(':');
                if (colon > 0) h = h.substring(0, colon);
            }
            return h.equals("localhost") || h.equals("127.0.0.1") || h.equals("[::1]");
        }

        static boolean isAllowedOrigin(String origin) {
            if (origin == null) return false;
            if (!PINNED_ORIGINS.isEmpty()) return PINNED_ORIGINS.contains(origin);
            return origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
        }

        private static void deny(HttpExchange ex, int code) throws IOException {
            ex.sendResponseHeaders(code, -1);
            ex.close();
        }

        /** @return true nếu tiếp tục xử lý; false nếu đã trả lời xong (từ chối hoặc OPTIONS). */
        static boolean preflight(HttpExchange ex, String methods) throws IOException {
            com.sun.net.httpserver.Headers req = ex.getRequestHeaders();
            if (!isLoopbackHost(req.getFirst("Host"))) { deny(ex, 403); return false; }

            String origin = req.getFirst("Origin");
            boolean extensionOrigin = isAllowedOrigin(origin);
            if (origin != null && !extensionOrigin) { deny(ex, 403); return false; }

            if (origin == null) {
                String site = req.getFirst("Sec-Fetch-Site");
                if (site != null && !site.equalsIgnoreCase("none") && !site.equalsIgnoreCase("same-origin")) {
                    deny(ex, 403);   // yêu cầu no-cors từ trang web khác
                    return false;
                }
            }

            if (extensionOrigin) {
                com.sun.net.httpserver.Headers h = ex.getResponseHeaders();
                h.set("Access-Control-Allow-Origin", origin);
                h.set("Vary", "Origin");
                h.set("Access-Control-Allow-Methods", methods);
                h.set("Access-Control-Allow-Headers", "Content-Type, Access-Control-Request-Private-Network");
                h.set("Access-Control-Allow-Private-Network", "true");
                h.set("Access-Control-Max-Age", "600");
            }

            if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
                ex.sendResponseHeaders(extensionOrigin ? 204 : 403, -1);
                ex.close();
                return false;
            }
            return true;
        }
    }

    private static final java.util.regex.Pattern SAFE_ID = java.util.regex.Pattern.compile("^[A-Za-z0-9_-]{1,120}$");

    /** Mã phiên chỉ gồm chữ, số, '_' và '-' để không thể thoát khỏi thư mục report_sessions (path traversal). */
    static String requireSafeId(String id) {
        if (id == null || !SAFE_ID.matcher(id).matches()) {
            throw new IllegalArgumentException("Mã phiên không hợp lệ");
        }
        return id;
    }

    /** Xóa log cũ hơn N ngày (mặc định 30; QT_LOG_RETENTION_DAYS=0 để giữ vĩnh viễn). Định dạng log_date: ddMMyyyy. */
    private static void purgeOldLogs() {
        int days = 30;
        try {
            String env = System.getenv("QT_LOG_RETENTION_DAYS");
            if (env != null && !env.trim().isEmpty()) days = Integer.parseInt(env.trim());
        } catch (NumberFormatException ignored) {}
        if (days <= 0 || dbConn == null) return;
        try {
            SimpleDateFormat fmt = new SimpleDateFormat("ddMMyyyy");
            StringBuilder in = new StringBuilder();
            java.util.Calendar cal = java.util.Calendar.getInstance();
            for (int i = 0; i < days; i++) {
                if (in.length() > 0) in.append(',');
                in.append('\'').append(fmt.format(cal.getTime())).append('\'');
                cal.add(java.util.Calendar.DAY_OF_MONTH, -1);
            }
            synchronized (JasperHelperServer.class) {
                try (java.sql.Statement st = dbConn.createStatement()) {
                    // Chỉ xóa các dòng có log_date đúng định dạng 8 chữ số và nằm ngoài cửa sổ lưu giữ
                    int removed = st.executeUpdate("DELETE FROM operation_logs WHERE length(log_date) = 8 " +
                            "AND log_date GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND log_date NOT IN (" + in + ")");
                    if (removed > 0) System.out.println("[INFO] Đã xóa " + removed + " dòng log cũ hơn " + days + " ngày.");
                }
            }
        } catch (Exception e) {
            System.err.println("[WARN] Không dọn được log cũ: " + e.getMessage());
        }
    }

    private static File getSessionsDirectory() {
        File dbFile = getDatabaseFile();
        File parent = dbFile.getParentFile();
        File sessionsDir = new File(parent, "report_sessions");
        if (!sessionsDir.exists()) {
            sessionsDir.mkdirs();
        }
        return sessionsDir;
    }

    private static File getDatabaseFile() {
        File[] candidateBases = null;
        try {
            File cwd = new File(".").getCanonicalFile();
            File codeSourceDir = null;
            try {
                codeSourceDir = new File(JasperHelperServer.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParentFile();
            } catch (Exception ignored) {}
            candidateBases = new File[] {
                cwd,
                cwd.getParentFile(),
                codeSourceDir,
                (codeSourceDir != null ? codeSourceDir.getParentFile() : null),
                (codeSourceDir != null && codeSourceDir.getParentFile() != null ? codeSourceDir.getParentFile().getParentFile() : null)
            };
        } catch (Exception ignored) {}

        if (candidateBases != null) {
            // Priority 1: Check for "code" folder containing manifest.json (the extension folder)
            for (File base : candidateBases) {
                if (base == null) continue;
                if (base.getName().equalsIgnoreCase("code") && new File(base, "manifest.json").exists()) {
                    return new File(base, "query_tool_logs.db");
                }
                File codeDir = new File(base, "code");
                if (codeDir.isDirectory() && new File(codeDir, "manifest.json").exists()) {
                    return new File(codeDir, "query_tool_logs.db");
                }
            }

            // Priority 2: Check for project folder named "query_tool"
            for (File base : candidateBases) {
                if (base == null) continue;
                if (base.getName().toLowerCase().contains("query_tool")) {
                    File codeDir = new File(base, "code");
                    if (codeDir.isDirectory()) {
                        return new File(codeDir, "query_tool_logs.db");
                    }
                    return new File(base, "query_tool_logs.db");
                }
            }
        }

        File userHome = new File(System.getProperty("user.home"), ".query_tool");
        userHome.mkdirs();
        return new File(userHome, "query_tool_logs.db");
    }

    private static synchronized void initDatabase() {
        if (dbConn != null) {
            try {
                if (!dbConn.isClosed()) {
                    return;
                }
            } catch (Exception ignored) {}
        }
        try {
            Class.forName("org.sqlite.JDBC");
            File dbFile = getDatabaseFile();
            File parentDir = dbFile.getParentFile();
            if (parentDir != null && !parentDir.exists()) {
                parentDir.mkdirs();
            }
            String url = "jdbc:sqlite:" + dbFile.getAbsolutePath().replace('\\', '/');
            dbConn = java.sql.DriverManager.getConnection(url);
            try (java.sql.Statement stmt = dbConn.createStatement()) {
                stmt.execute("CREATE TABLE IF NOT EXISTS operation_logs (" +
                             "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                             "log_date TEXT, " +
                             "log_time TEXT, " +
                             "action_type TEXT, " +
                             "site_key TEXT, " +
                             "detail TEXT)");
                stmt.execute("CREATE TABLE IF NOT EXISTS report_sessions (" +
                             "id TEXT PRIMARY KEY, " +
                             "session_name TEXT, " +
                             "jrxml_name TEXT, " +
                             "proc_name TEXT, " +
                             "sql_text TEXT, " +
                             "parameters_json TEXT, " +
                             "site_key TEXT, " +
                             "created_date TEXT, " +
                             "created_time TEXT, " +
                             "data_count INTEGER, " +
                             "has_snapshot INTEGER)");
            }
            getSessionsDirectory();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    static class WriteLogHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "POST, OPTIONS")) return;

            if (!exchange.getRequestMethod().equalsIgnoreCase("POST")) {
                exchange.sendResponseHeaders(405, -1);
                exchange.close();
                return;
            }

            try {
                InputStream is = exchange.getRequestBody();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                int nRead;
                byte[] data = new byte[4096];
                while ((nRead = is.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, nRead);
                }
                String body = new String(buffer.toByteArray(), StandardCharsets.UTF_8);

                initDatabase();

                JSONObject req = new JSONObject(body);
                String date = req.getString("date");
                String logText = req.getString("log");

                String[] parts = logText.split(" \\| ", 4);
                if (parts.length >= 4) {
                    String time = parts[0].replace("[", "").replace("]", "").trim();
                    String action = parts[1].trim();
                    String site = parts[2].trim();
                    String detail = parts[3];

                    if (dbConn != null) {
                        synchronized (JasperHelperServer.class) {
                            String sql = "INSERT INTO operation_logs (log_date, log_time, action_type, site_key, detail) VALUES (?, ?, ?, ?, ?)";
                            try (java.sql.PreparedStatement pstmt = dbConn.prepareStatement(sql)) {
                                pstmt.setString(1, date);
                                pstmt.setString(2, time);
                                pstmt.setString(3, action);
                                pstmt.setString(4, site);
                                pstmt.setString(5, detail);
                                pstmt.executeUpdate();
                            }
                        }
                    } else {
                        System.err.println("[WARN] Database connection unavailable. Log not saved to SQLite: " + logText);
                    }
                }

                byte[] resBytes = "Success".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, resBytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(resBytes);
                }
            } catch (IOException ignored) {
                // Client aborted or closed connection before response could be sent - safe to ignore
            } catch (Throwable e) {
                e.printStackTrace();
                try {
                    byte[] errBytes = e.toString().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(500, errBytes.length);
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(errBytes);
                    }
                } catch (Exception ignored) {}
            }
        }
    }

    static class ListLogsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "GET, OPTIONS")) return;

            try {
                initDatabase();
                JSONArray arr = new JSONArray();
                String sql = "SELECT DISTINCT log_date FROM operation_logs";
                if (dbConn != null) {
                    synchronized (JasperHelperServer.class) {
                        try (java.sql.Statement stmt = dbConn.createStatement();
                             java.sql.ResultSet rs = stmt.executeQuery(sql)) {
                            while (rs.next()) {
                                arr.put(rs.getString("log_date"));
                            }
                        }
                    }
                }

                byte[] bytes = arr.toString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(200, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(bytes);
                }
            } catch (IOException ignored) {
            } catch (Throwable e) {
                e.printStackTrace();
                try {
                    byte[] errBytes = e.toString().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(500, errBytes.length);
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(errBytes);
                    }
                } catch (Exception ignored) {}
            }
        }
    }

    static class GetLogHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "GET, OPTIONS")) return;

            try {
                initDatabase();
                String query = exchange.getRequestURI().getQuery();
                String date = null;
                if (query != null) {
                    for (String param : query.split("&")) {
                        String[] pair = param.split("=");
                        if (pair.length > 1 && pair[0].equals("date")) {
                            date = pair[1];
                        }
                    }
                }

                JSONArray arr = new JSONArray();
                if (date != null && !date.trim().isEmpty() && dbConn != null) {
                    synchronized (JasperHelperServer.class) {
                        String sql = "SELECT log_time, action_type, site_key, detail FROM operation_logs WHERE log_date = ? ORDER BY id DESC";
                        try (java.sql.PreparedStatement pstmt = dbConn.prepareStatement(sql)) {
                            pstmt.setString(1, date.trim());
                            try (java.sql.ResultSet rs = pstmt.executeQuery()) {
                                while (rs.next()) {
                                    JSONObject obj = new JSONObject();
                                    obj.put("time", rs.getString("log_time"));
                                    obj.put("type", rs.getString("action_type"));
                                    obj.put("site", rs.getString("site_key"));
                                    obj.put("detail", rs.getString("detail"));
                                    arr.put(obj);
                                }
                            }
                        }
                    }
                }

                byte[] bytes = arr.toString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(200, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(bytes);
                }
            } catch (IOException ignored) {
            } catch (Throwable e) {
                e.printStackTrace();
                try {
                    byte[] errBytes = e.toString().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(500, errBytes.length);
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(errBytes);
                    }
                } catch (Exception ignored) {}
            }
        }
    }


    static class SaveSessionHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "POST, OPTIONS")) return;

            if (!exchange.getRequestMethod().equalsIgnoreCase("POST")) {
                exchange.sendResponseHeaders(405, -1);
                exchange.close();
                return;
            }

            try {
                InputStream is = exchange.getRequestBody();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                int nRead;
                byte[] data = new byte[8192];
                while ((nRead = is.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, nRead);
                }
                String body = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
                if (body.startsWith("\uFEFF")) {
                    body = body.substring(1);
                }

                JSONObject req = new JSONObject(body);
                String id = requireSafeId(req.optString("id", "session_" + System.currentTimeMillis()));
                String sessionName = req.optString("name", "Báo cáo " + id);
                String jrxmlName = req.optString("jrxmlName", "report.jrxml");
                String jrxmlContent = req.optString("jrxmlContent", "");
                String procName = req.optString("procName", "");
                String sqlText = req.optString("sql", "");
                String parametersJson = req.opt("parameters") != null ? req.get("parameters").toString() : "{}";
                String siteKey = req.optString("siteKey", "");
                String createdDate = req.optString("createdDate", new SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date()));
                String createdTime = req.optString("createdTime", new SimpleDateFormat("HH:mm:ss").format(new java.util.Date()));
                int dataCount = req.optInt("dataCount", 0);
                boolean hasSnapshot = req.has("snapshotData") && !req.isNull("snapshotData");

                // 1. Save files into report_sessions/ folder
                File sessionsDir = getSessionsDirectory();
                
                String safeJrxmlName = jrxmlName.replaceAll("[^a-zA-Z0-9._-]", "_");
                File jrxmlFile = new File(sessionsDir, id + "_" + safeJrxmlName);
                if (!jrxmlContent.isEmpty()) {
                    try (FileOutputStream fos = new FileOutputStream(jrxmlFile)) {
                        fos.write(jrxmlContent.getBytes(StandardCharsets.UTF_8));
                    }
                }

                File jsonFile = new File(sessionsDir, id + ".json");
                try (FileOutputStream fos = new FileOutputStream(jsonFile)) {
                    fos.write(body.getBytes(StandardCharsets.UTF_8));
                }

                // 2. Save index into SQLite
                initDatabase();
                if (dbConn != null) {
                    synchronized (JasperHelperServer.class) {
                        String sql = "INSERT OR REPLACE INTO report_sessions " +
                                     "(id, session_name, jrxml_name, proc_name, sql_text, parameters_json, site_key, created_date, created_time, data_count, has_snapshot) " +
                                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
                        try (java.sql.PreparedStatement pstmt = dbConn.prepareStatement(sql)) {
                            pstmt.setString(1, id);
                            pstmt.setString(2, sessionName);
                            pstmt.setString(3, jrxmlName);
                            pstmt.setString(4, procName);
                            pstmt.setString(5, sqlText);
                            pstmt.setString(6, parametersJson);
                            pstmt.setString(7, siteKey);
                            pstmt.setString(8, createdDate);
                            pstmt.setString(9, createdTime);
                            pstmt.setInt(10, dataCount);
                            pstmt.setInt(11, hasSnapshot ? 1 : 0);
                            pstmt.executeUpdate();
                        }
                    }
                }

                JSONObject resp = new JSONObject();
                resp.put("success", true);
                resp.put("id", id);
                byte[] resBytes = resp.toString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(200, resBytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(resBytes);
                }
            } catch (Throwable e) {
                e.printStackTrace();
                try {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("error", e.getMessage());
                    byte[] errBytes = err.toString().getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                    exchange.sendResponseHeaders(500, errBytes.length);
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(errBytes);
                    }
                } catch (Exception ignored) {}
            }
        }
    }

    static class ListSessionsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "GET, OPTIONS")) return;

            try {
                initDatabase();
                String query = exchange.getRequestURI().getQuery();
                String search = null;
                String date = null;
                if (query != null) {
                    for (String param : query.split("&")) {
                        String[] pair = param.split("=");
                        if (pair.length > 1) {
                            String key = java.net.URLDecoder.decode(pair[0], "UTF-8");
                            String val = java.net.URLDecoder.decode(pair[1], "UTF-8");
                            if (key.equals("search") && !val.trim().isEmpty()) {
                                search = val.trim();
                            } else if (key.equals("date") && !val.trim().isEmpty()) {
                                date = val.trim();
                            }
                        }
                    }
                }

                JSONArray sessionsArr = new JSONArray();
                JSONArray datesArr = new JSONArray();

                if (dbConn != null) {
                    synchronized (JasperHelperServer.class) {
                        try (java.sql.Statement stmt = dbConn.createStatement();
                             java.sql.ResultSet rs = stmt.executeQuery("SELECT DISTINCT created_date FROM report_sessions ORDER BY created_date DESC")) {
                            while (rs.next()) {
                                String d = rs.getString("created_date");
                                if (d != null && !d.isEmpty()) datesArr.put(d);
                            }
                        }

                        StringBuilder sql = new StringBuilder("SELECT id, session_name, jrxml_name, proc_name, sql_text, parameters_json, site_key, created_date, created_time, data_count, has_snapshot FROM report_sessions WHERE 1=1 ");
                        java.util.List<Object> params = new java.util.ArrayList<>();

                        if (date != null) {
                            sql.append(" AND created_date = ? ");
                            params.add(date);
                        }
                        if (search != null) {
                            sql.append(" AND (session_name LIKE ? OR jrxml_name LIKE ? OR proc_name LIKE ? OR sql_text LIKE ?) ");
                            String pattern = "%" + search + "%";
                            params.add(pattern);
                            params.add(pattern);
                            params.add(pattern);
                            params.add(pattern);
                        }

                        sql.append(" ORDER BY created_date DESC, created_time DESC, id DESC");

                        try (java.sql.PreparedStatement pstmt = dbConn.prepareStatement(sql.toString())) {
                            for (int i = 0; i < params.size(); i++) {
                                pstmt.setObject(i + 1, params.get(i));
                            }
                            try (java.sql.ResultSet rs = pstmt.executeQuery()) {
                                while (rs.next()) {
                                    JSONObject item = new JSONObject();
                                    item.put("id", rs.getString("id"));
                                    item.put("name", rs.getString("session_name"));
                                    item.put("jrxmlName", rs.getString("jrxml_name"));
                                    item.put("procName", rs.getString("proc_name"));
                                    item.put("sql", rs.getString("sql_text"));
                                    item.put("parameters", rs.getString("parameters_json"));
                                    item.put("siteKey", rs.getString("site_key"));
                                    item.put("createdDate", rs.getString("created_date"));
                                    item.put("createdTime", rs.getString("created_time"));
                                    item.put("dataCount", rs.getInt("data_count"));
                                    item.put("hasSnapshot", rs.getInt("has_snapshot") == 1);
                                    sessionsArr.put(item);
                                }
                            }
                        }
                    }
                }

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("sessions", sessionsArr);
                result.put("dates", datesArr);

                byte[] bytes = result.toString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(200, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(bytes);
                }
            } catch (Throwable e) {
                e.printStackTrace();
                try {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("error", e.getMessage());
                    byte[] errBytes = err.toString().getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                    exchange.sendResponseHeaders(500, errBytes.length);
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(errBytes);
                    }
                } catch (Exception ignored) {}
            }
        }
    }

    static class GetSessionHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "GET, OPTIONS")) return;

            try {
                String query = exchange.getRequestURI().getQuery();
                String id = null;
                if (query != null) {
                    for (String param : query.split("&")) {
                        String[] pair = param.split("=");
                        if (pair.length > 1 && pair[0].equals("id")) {
                            id = java.net.URLDecoder.decode(pair[1], "UTF-8");
                        }
                    }
                }

                if (id == null || id.trim().isEmpty() || !SAFE_ID.matcher(id).matches()) {
                    exchange.sendResponseHeaders(400, -1);
                    exchange.close();
                    return;
                }

                File sessionsDir = getSessionsDirectory();
                File jsonFile = new File(sessionsDir, id + ".json");
                byte[] responseBytes = null;
                if (jsonFile.exists()) {
                    responseBytes = java.nio.file.Files.readAllBytes(jsonFile.toPath());
                } else {
                    initDatabase();
                    if (dbConn != null) {
                        synchronized (JasperHelperServer.class) {
                            String sql = "SELECT * FROM report_sessions WHERE id = ?";
                            try (java.sql.PreparedStatement pstmt = dbConn.prepareStatement(sql)) {
                                pstmt.setString(1, id);
                                try (java.sql.ResultSet rs = pstmt.executeQuery()) {
                                    if (rs.next()) {
                                        JSONObject obj = new JSONObject();
                                        obj.put("id", rs.getString("id"));
                                        obj.put("name", rs.getString("session_name"));
                                        obj.put("jrxmlName", rs.getString("jrxml_name"));
                                        obj.put("procName", rs.getString("proc_name"));
                                        obj.put("sql", rs.getString("sql_text"));
                                        obj.put("parameters", new JSONObject(rs.getString("parameters_json")));
                                        obj.put("siteKey", rs.getString("site_key"));
                                        obj.put("createdDate", rs.getString("created_date"));
                                        obj.put("createdTime", rs.getString("created_time"));
                                        obj.put("dataCount", rs.getInt("data_count"));
                                        responseBytes = obj.toString().getBytes(StandardCharsets.UTF_8);
                                    }
                                }
                            }
                        }
                    }
                }

                if (responseBytes == null) {
                    exchange.sendResponseHeaders(404, -1);
                    exchange.close();
                    return;
                }

                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(200, responseBytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(responseBytes);
                }
            } catch (Throwable e) {
                e.printStackTrace();
                try {
                    exchange.sendResponseHeaders(500, -1);
                    exchange.close();
                } catch (Exception ignored) {}
            }
        }
    }

    static class DeleteSessionHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "POST, OPTIONS")) return;

            // Thao tác xóa chỉ nhận POST (không cho GET để tránh bị kích hoạt qua thẻ <img>/liên kết)
            if (!exchange.getRequestMethod().equalsIgnoreCase("POST")) {
                exchange.sendResponseHeaders(405, -1);
                exchange.close();
                return;
            }

            try {
                String id = null;
                if (exchange.getRequestMethod().equalsIgnoreCase("POST")) {
                    InputStream is = exchange.getRequestBody();
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    int nRead;
                    byte[] data = new byte[2048];
                    while ((nRead = is.read(data, 0, data.length)) != -1) {
                        buffer.write(data, 0, nRead);
                    }
                    String body = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
                    if (!body.trim().isEmpty()) {
                        JSONObject req = new JSONObject(body);
                        id = req.optString("id", null);
                    }
                }
                if (id == null) {
                    String query = exchange.getRequestURI().getQuery();
                    if (query != null) {
                        for (String param : query.split("&")) {
                            String[] pair = param.split("=");
                            if (pair.length > 1 && pair[0].equals("id")) {
                                id = java.net.URLDecoder.decode(pair[1], "UTF-8");
                            }
                        }
                    }
                }

                if (id != null && !id.trim().isEmpty()) {
                    if (!SAFE_ID.matcher(id).matches()) {
                        exchange.sendResponseHeaders(400, -1);
                        exchange.close();
                        return;
                    }
                    final String deleteId = id;
                    initDatabase();
                    if (dbConn != null) {
                        synchronized (JasperHelperServer.class) {
                            try (java.sql.PreparedStatement pstmt = dbConn.prepareStatement("DELETE FROM report_sessions WHERE id = ?")) {
                                pstmt.setString(1, deleteId);
                                pstmt.executeUpdate();
                            }
                        }
                    }
                    File sessionsDir = getSessionsDirectory();
                    File jsonFile = new File(sessionsDir, deleteId + ".json");
                    if (jsonFile.exists()) {
                        jsonFile.delete();
                    }
                    File[] files = sessionsDir.listFiles((dir, name) -> name.startsWith(deleteId + "_"));
                    if (files != null) {
                        for (File f : files) f.delete();
                    }
                }

                JSONObject resp = new JSONObject();
                resp.put("success", true);
                byte[] bytes = resp.toString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(200, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(bytes);
                }
            } catch (Throwable e) {
                e.printStackTrace();
                try {
                    exchange.sendResponseHeaders(500, -1);
                    exchange.close();
                } catch (Exception ignored) {}
            }
        }
    }


    public static void main(String[] args) throws Exception {
        System.setOut(new PrintStream(new CapturingOutputStream(System.out), true, "UTF-8"));
        System.setErr(new PrintStream(new CapturingOutputStream(System.err), true, "UTF-8"));

        try {
            com.lowagie.text.FontFactory.registerDirectories();
            if (new java.io.File("C:\\Windows\\Fonts").exists()) {
                com.lowagie.text.FontFactory.registerDirectory("C:\\Windows\\Fonts");
            }
            if (new java.io.File("/usr/share/fonts").exists()) {
                com.lowagie.text.FontFactory.registerDirectory("/usr/share/fonts");
            }
        } catch (Exception e) {
            System.err.println("Could not register fonts: " + e.getMessage());
        }
        try {
            initDatabase();
            purgeOldLogs();
        } catch (Exception ignored) {}
        int port = 8080;
        HttpServer server = HttpServer.create(new InetSocketAddress(java.net.InetAddress.getByName("127.0.0.1"), port), 0);
        server.createContext("/fill", new FillHandler());
        server.createContext("/logs", new LogHandler());
        server.createContext("/write-log", new WriteLogHandler());
        server.createContext("/list-logs", new ListLogsHandler());
        server.createContext("/get-log", new GetLogHandler());
        server.createContext("/save-session", new SaveSessionHandler());
        server.createContext("/list-sessions", new ListSessionsHandler());
        server.createContext("/get-session", new GetSessionHandler());
        server.createContext("/delete-session", new DeleteSessionHandler());
        server.createContext("/update-extension", new UpdateExtensionHandler());
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        System.out.println("Jasper Helper Server started on port " + port);
        server.start();
        Thread.currentThread().join();
    }

    static class FillHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "POST, OPTIONS")) return;

            if (!exchange.getRequestMethod().equalsIgnoreCase("POST")) {
                exchange.sendResponseHeaders(405, -1);
                exchange.close();
                return;
            }

            try {
                InputStream is = exchange.getRequestBody();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                int nRead;
                byte[] data = new byte[16384];
                while ((nRead = is.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, nRead);
                }
                byte[] bytes = buffer.toByteArray();
                String body = new String(bytes, StandardCharsets.UTF_8);
                if (body.startsWith("\uFEFF")) {
                    body = body.substring(1);
                }

                JSONObject req = new JSONObject(body);
                String jrxml = fixPdfFontNames(req.getString("jrxml"));
                jrxml = fixDetailBorders(jrxml);
                String jsonData = req.getString("jsonData");
                JSONObject paramsObj = req.optJSONObject("parameters");

                InputStream jrxmlStream = new ByteArrayInputStream(jrxml.getBytes(StandardCharsets.UTF_8));
                JasperReport jasperReport = JasperCompileManager.compileReport(jrxmlStream);

                System.out.println("--- Fields list ---");
                for (JRField jf : jasperReport.getFields()) {
                    System.out.println("Field: " + jf.getName() + " | Type: " + jf.getValueClass().getName());
                }
                System.out.println("--- Variables list ---");
                for (JRVariable jv : jasperReport.getVariables()) {
                    System.out.println("Variable: " + jv.getName() + " | Type: " + jv.getValueClass().getName() + " | Calc: " + jv.getCalculationValue());
                }

                JRField[] jrFields = jasperReport.getFields();
                JSONArray jsonArr = new JSONArray(jsonData);
                System.out.println("JSON Data length: " + jsonArr.length());
                if (jsonArr.length() > 0) {
                    System.out.println("First row keys: " + jsonArr.getJSONObject(0).keySet());
                }

                if (jsonArr.length() == 0) {
                    JSONObject emptyObj = new JSONObject();
                    for (JRField jf : jrFields) {
                        String fName = jf.getName();
                        Class<?> fClass = jf.getValueClass();
                        Object val = getDefaultValueForClass(fName, fClass);
                        emptyObj.put(fName, val);
                        emptyObj.put(fName.toLowerCase(), val);
                        emptyObj.put(fName.toUpperCase(), val);
                    }
                    jsonArr.put(emptyObj);
                }

                for (int i = 0; i < jsonArr.length(); i++) {
                    JSONObject obj = jsonArr.getJSONObject(i);
                    obj = (JSONObject) cleanJsonNumbers(obj);
                    for (JRField jf : jrFields) {
                        String fName = jf.getName();
                        Class<?> fClass = jf.getValueClass();
                        Object val = null;
                        if (obj.has(fName)) {
                            val = obj.get(fName);
                        } else if (obj.has(fName.toLowerCase())) {
                            val = obj.get(fName.toLowerCase());
                        } else if (obj.has(fName.toUpperCase())) {
                            val = obj.get(fName.toUpperCase());
                        }
                        val = coerceFieldValue(fName, val, fClass);
                        obj.put(fName, val);
                        obj.put(fName.toLowerCase(), val);
                        obj.put(fName.toUpperCase(), val);
                    }
                    jsonArr.put(i, obj);
                }
                String cleanedJsonData = jsonArr.toString();

                JRParameter[] jrParams = jasperReport.getParameters();
                Map<String, Class<?>> paramTypes = new HashMap<>();
                for (JRParameter jp : jrParams) {
                    paramTypes.put(jp.getName(), jp.getValueClass());
                }

                Map<String, Object> parameters = new HashMap<>();
                if (paramsObj != null) {
                    for (String key : paramsObj.keySet()) {
                        Object val = paramsObj.get(key);
                        Class<?> targetClass = paramTypes.get(key);
                        if (targetClass != null && val instanceof String) {
                            parameters.put(key, convertValue((String) val, targetClass));
                        } else {
                            parameters.put(key, val);
                        }
                    }
                }

                InputStream jsonStream = new ByteArrayInputStream(cleanedJsonData.getBytes(StandardCharsets.UTF_8));
                JsonDataSource dataSource = new JsonDataSource(jsonStream);

                JasperPrint jasperPrint = JasperFillManager.fillReport(jasperReport, parameters, dataSource);

                byte[] pdfBytes = JasperExportManager.exportReportToPdf(jasperPrint);

                exchange.getResponseHeaders().set("Content-Type", "application/pdf");
                exchange.sendResponseHeaders(200, pdfBytes.length);
                OutputStream os = exchange.getResponseBody();
                os.write(pdfBytes);
                os.close();

            } catch (Throwable e) {
                e.printStackTrace();
                String errorMsg = "Error: " + e.toString();
                byte[] errorBytes = errorMsg.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain");
                exchange.sendResponseHeaders(500, errorBytes.length);
                OutputStream os = exchange.getResponseBody();
                os.write(errorBytes);
                os.close();
            }
        }

        private Object cleanJsonNumbers(Object input) {
            if (input instanceof JSONObject) {
                JSONObject obj = (JSONObject) input;
                Map<String, Object> newPairs = new HashMap<>();
                for (String key : obj.keySet()) {
                    Object cleanedVal = cleanJsonNumbers(obj.get(key));
                    newPairs.put(key, cleanedVal);
                    newPairs.put(key.toLowerCase(), cleanedVal);
                    newPairs.put(key.toUpperCase(), cleanedVal);
                }
                for (String k : newPairs.keySet()) {
                    obj.put(k, newPairs.get(k));
                }
                return obj;
            } else if (input instanceof JSONArray) {
                JSONArray arr = (JSONArray) input;
                for (int i = 0; i < arr.length(); i++) {
                    arr.put(i, cleanJsonNumbers(arr.get(i)));
                }
                return arr;
            } else if (input instanceof String) {
                String s = (String) input;
                String trimmed = s.trim();
                if (trimmed.matches("^-?[1-9]\\d*$") || trimmed.equals("0")) {
                    try {
                        return Long.parseLong(trimmed);
                    } catch (NumberFormatException e) {
                        try {
                            return new BigDecimal(trimmed);
                        } catch (Exception ex) {
                            return s;
                        }
                    }
                } else if (trimmed.matches("^-?(?:[1-9]\\d*|0)\\.\\d+$")) {
                    try {
                        return new BigDecimal(trimmed);
                    } catch (Exception e) {
                        return s;
                    }
                }
            }
            return input;
        }

        private Object convertValue(String val, Class<?> targetClass) {
            if (val == null) {
                return null;
            }
            String trimmed = val.trim();
            if (trimmed.isEmpty()) {
                if (targetClass == String.class) {
                    return "";
                }
                return null;
            }

            if (targetClass == String.class) {
                return val;
            }
            if (targetClass == Integer.class || targetClass == int.class) {
                try { return Integer.parseInt(trimmed); } catch (NumberFormatException e) { return null; }
            }
            if (targetClass == Long.class || targetClass == long.class) {
                try { return Long.parseLong(trimmed); } catch (NumberFormatException e) { return null; }
            }
            if (targetClass == Double.class || targetClass == double.class) {
                try { return Double.parseDouble(trimmed); } catch (NumberFormatException e) { return null; }
            }
            if (targetClass == Float.class || targetClass == float.class) {
                try { return Float.parseFloat(trimmed); } catch (NumberFormatException e) { return null; }
            }
            if (targetClass == BigDecimal.class) {
                try { return new BigDecimal(trimmed); } catch (NumberFormatException e) { return null; }
            }
            if (targetClass == java.util.Date.class || targetClass == java.sql.Date.class || targetClass == java.sql.Timestamp.class) {
                String[] formats = {"yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd", "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy", "yyyy/MM/dd"};
                for (String format : formats) {
                    try {
                        SimpleDateFormat sdf = new SimpleDateFormat(format);
                        java.util.Date parsed = sdf.parse(trimmed);
                        if (targetClass == java.sql.Date.class) {
                            return new java.sql.Date(parsed.getTime());
                        } else if (targetClass == java.sql.Timestamp.class) {
                            return new java.sql.Timestamp(parsed.getTime());
                        }
                        return parsed;
                    } catch (Exception ignored) {}
                }
                return null;
            }
            if (targetClass == java.awt.Image.class) {
                try {
                    if (trimmed.startsWith("data:image/") && trimmed.contains(";base64,")) {
                        String base64Data = trimmed.substring(trimmed.indexOf(";base64,") + 8);
                        byte[] imgBytes = java.util.Base64.getDecoder().decode(base64Data.trim());
                        return ImageIO.read(new ByteArrayInputStream(imgBytes));
                    }
                    try {
                        byte[] imgBytes = java.util.Base64.getDecoder().decode(trimmed);
                        return ImageIO.read(new ByteArrayInputStream(imgBytes));
                    } catch (IllegalArgumentException e) {
                    }
                    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                        return ImageIO.read(new java.net.URL(trimmed));
                    } else {
                        File file = new File(trimmed);
                        if (file.exists()) {
                            return ImageIO.read(file);
                        }
                    }
                } catch (Exception e) {
                    System.err.println("Failed to load image: " + e.getMessage());
                }
                return null;
            }

            return val;
        }

        private Object coerceFieldValue(String fName, Object val, Class<?> fClass) {
            if (fClass == null) {
                return val;
            }
            if (val == null || val == JSONObject.NULL) {
                return getDefaultValueForClass(fName, fClass);
            }
            if (fClass == String.class) {
                String s = val.toString();
                if (s.trim().isEmpty()) {
                    return getDefaultStringForField(fName);
                }
                String upper = fName != null ? fName.toUpperCase() : "";
                if (upper.contains("KETOAN")) {
                    int count = 0;
                    for (char c : s.toCharArray()) if (c == ';') count++;
                    while (count < 8) {
                        s += ";";
                        count++;
                    }
                }
                if (upper.contains("THE") || upper.contains("BHYT") || upper.contains("NGAY") || 
                    upper.contains("DATE") || upper.contains("TIME") || upper.contains("TG") || 
                    upper.contains("MA_") || upper.contains("MATIEPNHAN") || upper.contains("MAKV") || 
                    upper.contains("MAKHOA") || upper.contains("SOTHE") || upper.contains("CCCD") || 
                    upper.contains("CMND") || upper.contains("MST") || upper.contains("MASOTHUE")) {
                    if (s.length() < 20) {
                        return String.format("%-20s", s);
                    }
                }
                return s;
            }
            if (fClass.isInstance(val)) {
                return val;
            }
            if (val instanceof String) {
                String s = ((String) val).trim();
                if (s.isEmpty()) {
                    return getDefaultValueForClass(fName, fClass);
                }
                try {
                    if (fClass == BigDecimal.class || fClass == Number.class) {
                        return new BigDecimal(s);
                    } else if (fClass == Integer.class || fClass == int.class) {
                        return Integer.parseInt(s);
                    } else if (fClass == Long.class || fClass == long.class) {
                        return Long.parseLong(s);
                    } else if (fClass == Double.class || fClass == double.class) {
                        return Double.parseDouble(s);
                    } else if (fClass == Float.class || fClass == float.class) {
                        return Float.parseFloat(s);
                    } else if (fClass == Short.class || fClass == short.class) {
                        return Short.parseShort(s);
                    } else if (fClass == Byte.class || fClass == byte.class) {
                        return Byte.parseByte(s);
                    } else if (Number.class.isAssignableFrom(fClass)) {
                        return new BigDecimal(s);
                    }
                } catch (NumberFormatException e) {
                    return getDefaultValueForClass(fName, fClass);
                }
            }
            if (val instanceof Number) {
                Number num = (Number) val;
                if (fClass == BigDecimal.class || fClass == Number.class) {
                    return new BigDecimal(num.toString());
                } else if (fClass == Integer.class || fClass == int.class) {
                    return num.intValue();
                } else if (fClass == Long.class || fClass == long.class) {
                    return num.longValue();
                } else if (fClass == Double.class || fClass == double.class) {
                    return num.doubleValue();
                } else if (fClass == Float.class || fClass == float.class) {
                    return num.floatValue();
                } else if (fClass == Short.class || fClass == short.class) {
                    return num.shortValue();
                } else if (fClass == Byte.class || fClass == byte.class) {
                    return num.byteValue();
                } else if (Number.class.isAssignableFrom(fClass)) {
                    return new BigDecimal(num.toString());
                }
            }
            return getDefaultValueForClass(fName, fClass);
        }

        private Object getDefaultValueForClass(String fName, Class<?> fClass) {
            if (fClass == null) {
                return null;
            }
            if (fClass == BigDecimal.class || fClass == Number.class) {
                return BigDecimal.ZERO;
            } else if (fClass == Integer.class || fClass == int.class) {
                return 0;
            } else if (fClass == Long.class || fClass == long.class) {
                return 0L;
            } else if (fClass == Double.class || fClass == double.class) {
                return 0.0;
            } else if (fClass == Float.class || fClass == float.class) {
                return 0.0f;
            } else if (fClass == Short.class || fClass == short.class) {
                return (short) 0;
            } else if (fClass == Byte.class || fClass == byte.class) {
                return (byte) 0;
            } else if (fClass == String.class) {
                return getDefaultStringForField(fName);
            } else if (Number.class.isAssignableFrom(fClass)) {
                return BigDecimal.ZERO;
            }
            return null;
        }

        private String getDefaultStringForField(String fName) {
            if (fName == null) {
                return "                    ";
            }
            String upper = fName.toUpperCase();
            if (upper.contains("KETOAN")) {
                return ";;;;;;BHYT;;";
            }
            if (upper.contains("NGAY") || upper.contains("DATE") || upper.contains("TG") || 
                upper.contains("TIME") || upper.contains("BD") || upper.contains("KT") || 
                upper.contains("HSD") || upper.contains("THANG") || upper.contains("NAM")) {
                return "18062026000000      ";
            }
            return "                    ";
        }

        private String fixPdfFontNames(String jrxml) {
            java.util.regex.Pattern fontPattern = java.util.regex.Pattern.compile("<font\\b[^>]*>");
            java.util.regex.Matcher fontMatcher = fontPattern.matcher(jrxml);
            StringBuffer sb = new StringBuffer();
            while (fontMatcher.find()) {
                String tag = fontMatcher.group();
                tag = fixTagFonts(tag, "font");
                fontMatcher.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(tag));
            }
            fontMatcher.appendTail(sb);
            jrxml = sb.toString();

            java.util.regex.Pattern stylePattern = java.util.regex.Pattern.compile("<style\\b[^>]*>");
            java.util.regex.Matcher styleMatcher = stylePattern.matcher(jrxml);
            sb = new StringBuffer();
            while (styleMatcher.find()) {
                String tag = styleMatcher.group();
                tag = fixTagFonts(tag, "style");
                styleMatcher.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(tag));
            }
            styleMatcher.appendTail(sb);
            return sb.toString();
        }

        private String fixTagFonts(String tag, String tagName) {
            String fontName = getAttrValue(tag, "fontName");
            if (fontName == null || fontName.trim().isEmpty()) {
                if ("font".equals(tagName)) {
                    fontName = "Times New Roman";
                } else {
                    return tag;
                }
            }
            boolean isBold = "true".equalsIgnoreCase(getAttrValue(tag, "isBold"));
            boolean isItalic = "true".equalsIgnoreCase(getAttrValue(tag, "isItalic"));
            String mappedPdfFont = getMappedFontPath(fontName, isBold, isItalic);
            tag = setAttrValue(tag, "pdfFontName", mappedPdfFont);
            tag = setAttrValue(tag, "pdfEncoding", "Identity-H");
            if ("font".equals(tagName)) {
                tag = setAttrValue(tag, "isPdfEmbedded", "true");
            }
            return tag;
        }

        private String getAttrValue(String tag, String attrName) {
            java.util.regex.Pattern p = java.util.regex.Pattern.compile(attrName + "\\s*=\\s*[\"']([^\"']*)[\"']");
            java.util.regex.Matcher m = p.matcher(tag);
            if (m.find()) {
                return m.group(1);
            }
            return null;
        }

        private String setAttrValue(String tag, String attrName, String value) {
            if (tag.contains(attrName + "=") || tag.contains(attrName + " =")) {
                return tag.replaceAll(attrName + "\\s*=\\s*[\"']([^\"']*)[\"']", attrName + "=\"" + java.util.regex.Matcher.quoteReplacement(value) + "\"");
            } else {
                if (tag.endsWith("/>")) {
                    return tag.substring(0, tag.length() - 2) + " " + attrName + "=\"" + value + "\"/>";
                } else if (tag.endsWith(">")) {
                    return tag.substring(0, tag.length() - 1) + " " + attrName + "=\"" + value + "\">";
                }
            }
            return tag;
        }

        private String resolveFont(String fileName) {
            String[] candidateDirs = new String[] {
                "C:\\Windows\\Fonts\\",
                "/usr/share/fonts/truetype/msttcorefonts/",
                "/usr/share/fonts/truetype/",
                "/usr/share/fonts/TTF/",
                "/usr/share/fonts/",
                "fonts/"
            };
            for (String dir : candidateDirs) {
                java.io.File f = new java.io.File(dir + fileName);
                if (f.exists()) {
                    return f.getAbsolutePath();
                }
            }
            return "C:\\Windows\\Fonts\\" + fileName;
        }

        private String getMappedFontPath(String fontName, boolean isBold, boolean isItalic) {
            String fn = fontName.trim().toLowerCase();
            String fileName;
            if (fn.contains("arial")) {
                if (isBold && isItalic) fileName = "arialbi.ttf";
                else if (isBold) fileName = "arialbd.ttf";
                else if (isItalic) fileName = "ariali.ttf";
                else fileName = "arial.ttf";
            } else if (fn.contains("tahoma")) {
                if (isBold) fileName = "tahomabd.ttf";
                else fileName = "tahoma.ttf";
            } else if (fn.contains("courier")) {
                if (isBold && isItalic) fileName = "courbi.ttf";
                else if (isBold) fileName = "courbd.ttf";
                else if (isItalic) fileName = "couri.ttf";
                else fileName = "cour.ttf";
            } else {
                if (isBold && isItalic) fileName = "timesbi.ttf";
                else if (isBold) fileName = "timesbd.ttf";
                else if (isItalic) fileName = "timesi.ttf";
                else fileName = "times.ttf";
            }
            return resolveFont(fileName);
        }

        private static String fixDetailBorders(String jrxml) {
            try {
                DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
                factory.setNamespaceAware(true);
                factory.setValidating(false);
                factory.setFeature("http://xml.org/sax/features/validation", false);
                factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
                DocumentBuilder builder = factory.newDocumentBuilder();
                builder.setEntityResolver(new org.xml.sax.EntityResolver() {
                    @Override
                    public org.xml.sax.InputSource resolveEntity(String publicId, String systemId) {
                        return new org.xml.sax.InputSource(new java.io.StringReader(""));
                    }
                });
                Document doc = builder.parse(new InputSource(new StringReader(jrxml)));
                NodeList detailList = doc.getElementsByTagName("detail");
                for (int d = 0; d < detailList.getLength(); d++) {
                    Node detailNode = detailList.item(d);
                    if (detailNode instanceof Element) {
                        Element detailElement = (Element) detailNode;
                        NodeList textFields = detailElement.getElementsByTagName("textField");
                        for (int t = 0; t < textFields.getLength(); t++) {
                            Element textField = (Element) textFields.item(t);
                            NodeList reportElements = textField.getElementsByTagName("reportElement");
                            if (reportElements.getLength() > 0) {
                                Element reportElement = (Element) reportElements.item(0);
                                NodeList printWhenList = reportElement.getElementsByTagName("printWhenExpression");
                                if (printWhenList.getLength() > 0) {
                                    Element printWhenExpr = (Element) printWhenList.item(0);
                                    String condition = printWhenExpr.getTextContent();
                                    reportElement.removeChild(printWhenExpr);
                                    NodeList exprList = textField.getElementsByTagName("textFieldExpression");
                                    if (exprList.getLength() > 0) {
                                        Element exprElem = (Element) exprList.item(0);
                                        String originalExpr = exprElem.getTextContent();
                                        String newExpr = "(" + condition + ") ? (" + originalExpr + ") : null";
                                        exprElem.setTextContent(newExpr);
                                    }
                                }
                            }
                        }
                    }
                }
                TransformerFactory tf = TransformerFactory.newInstance();
                Transformer transformer = tf.newTransformer();
                transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "no");
                transformer.setOutputProperty(OutputKeys.METHOD, "xml");
                transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
                transformer.setOutputProperty(OutputKeys.INDENT, "no");
                StringWriter writer = new StringWriter();
                transformer.transform(new DOMSource(doc), new StreamResult(writer));
                return writer.toString();
            } catch (Exception e) {
                e.printStackTrace();
                return jrxml;
            }
        }
    }

    /**
     * Cập nhật extension (v1.2.0 - đã siết bảo mật).
     *  - Chỉ nhận yêu cầu từ extension (xem Security.preflight).
     *  - URL phải là HTTPS và thuộc danh sách host cho phép (GitHub); kiểm tra lại ở MỌI lần chuyển hướng.
     *  - Bắt buộc có SHA-256 của gói; so khớp sau khi tải, sai là hủy, không giải nén gì cả.
     *  - Chỉ giải nén các loại tệp tĩnh của extension (js/html/css/json/ảnh/font), từ chối .exe/.jar/.bat/.vbs/...
     *  - Chặn zip-slip bằng đường dẫn chuẩn hóa; giới hạn dung lượng gói và tổng dung lượng giải nén.
     * Lưu ý: SHA-256 lấy từ cùng kho với gói nên bảo vệ trước lỗi tải/giả mạo đường truyền và lệnh từ trang web lạ,
     * nhưng không thay thế chữ ký số nếu chính kho phát hành bị chiếm quyền.
     */
    static class UpdateExtensionHandler implements HttpHandler {
        private static final long MAX_PACKAGE_BYTES = 120L * 1024 * 1024;
        private static final long MAX_EXTRACT_BYTES = 400L * 1024 * 1024;
        private static final java.util.Set<String> ALLOWED_EXT = new java.util.HashSet<>(java.util.Arrays.asList(
                "js", "html", "css", "json", "png", "jpg", "jpeg", "svg", "ico", "ttf", "woff", "woff2", "map", "txt", "md"));
        private static final java.util.Set<String> DEFAULT_HOSTS = new java.util.HashSet<>(java.util.Arrays.asList(
                "raw.githubusercontent.com", "github.com", "objects.githubusercontent.com",
                "release-assets.githubusercontent.com", "codeload.github.com"));

        private static java.util.Set<String> allowedHosts() {
            java.util.Set<String> hosts = new java.util.HashSet<>(DEFAULT_HOSTS);
            String env = System.getenv("QT_UPDATE_HOSTS");
            if (env != null) {
                for (String h : env.split(",")) {
                    String t = h.trim().toLowerCase();
                    if (!t.isEmpty()) hosts.add(t);
                }
            }
            return hosts;
        }

        static boolean isAllowedUpdateUrl(String url) {
            try {
                URL u = new URL(url);
                return "https".equalsIgnoreCase(u.getProtocol()) && u.getHost() != null
                        && allowedHosts().contains(u.getHost().toLowerCase());
            } catch (Exception e) {
                return false;
            }
        }

        static String extensionOf(String name) {
            int dot = name.lastIndexOf('.');
            int slash = name.lastIndexOf('/');
            return (dot > slash && dot >= 0) ? name.substring(dot + 1).toLowerCase() : "";
        }

        static boolean isProtectedName(String lower) {
            return lower.equals("query_tool_logs.db") || lower.startsWith("query_tool_logs.db-") ||
                    lower.startsWith("report_sessions/") || lower.equals("report_sessions") ||
                    lower.endsWith(".log") || lower.startsWith("update_temp_");
        }

        private static String toHex(byte[] bytes) {
            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) sb.append(String.format("%02x", b));
            return sb.toString();
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!Security.preflight(exchange, "POST, OPTIONS")) return;

            if (!exchange.getRequestMethod().equalsIgnoreCase("POST")) {
                sendJsonResponse(exchange, 405, "{\"success\":false,\"error\":\"Method not allowed\"}");
                return;
            }

            File tempZip = null;
            try {
                InputStream is = exchange.getRequestBody();
                ByteArrayOutputStream reqBuf = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                int n;
                while ((n = is.read(b)) != -1) {
                    reqBuf.write(b, 0, n);
                    if (reqBuf.size() > 65536) {
                        sendJsonResponse(exchange, 413, "{\"success\":false,\"error\":\"Request too large\"}");
                        return;
                    }
                }
                JSONObject json;
                try {
                    json = new JSONObject(new String(reqBuf.toByteArray(), StandardCharsets.UTF_8));
                } catch (Exception parseErr) {
                    sendJsonResponse(exchange, 400, "{\"success\":false,\"error\":\"Invalid JSON\"}");
                    return;
                }
                String downloadUrl = json.optString("downloadUrl", "").trim();
                String expectedSha = json.optString("sha256", "").trim().toLowerCase();

                if (downloadUrl.isEmpty()) {
                    sendJsonResponse(exchange, 400, "{\"success\":false,\"error\":\"downloadUrl is required\"}");
                    return;
                }
                if (!isAllowedUpdateUrl(downloadUrl)) {
                    sendJsonResponse(exchange, 403, "{\"success\":false,\"error\":\"URL cập nhật không thuộc danh sách máy chủ được phép (chỉ HTTPS tới GitHub).\"}");
                    return;
                }
                if (!expectedSha.matches("^[0-9a-f]{64}$")) {
                    sendJsonResponse(exchange, 400, "{\"success\":false,\"error\":\"Thiếu hoặc sai định dạng SHA-256 của gói cập nhật.\"}");
                    return;
                }

                File extDir = getDatabaseFile().getParentFile();
                if (extDir == null || !extDir.exists()) {
                    sendJsonResponse(exchange, 500, "{\"success\":false,\"error\":\"Extension directory not found\"}");
                    return;
                }
                String extRoot = extDir.getCanonicalPath() + File.separator;

                tempZip = new File(extDir, "update_temp_" + System.currentTimeMillis() + ".zip");
                String currentUrl = downloadUrl;
                HttpURLConnection conn = null;

                // Theo dõi chuyển hướng (GitHub Releases -> CDN) nhưng kiểm tra lại từng chặng
                for (int redirectCount = 0; ; redirectCount++) {
                    if (redirectCount >= 8) {
                        sendJsonResponse(exchange, 502, "{\"success\":false,\"error\":\"Quá nhiều lần chuyển hướng\"}");
                        return;
                    }
                    URL u = new URL(currentUrl);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setRequestProperty("User-Agent", "QueryTool-AutoUpdater/1.2");
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(90000);

                    int status = conn.getResponseCode();
                    if (status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_MOVED_PERM ||
                            status == HttpURLConnection.HTTP_SEE_OTHER || status == 307 || status == 308) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (loc == null || loc.isEmpty()) {
                            sendJsonResponse(exchange, 502, "{\"success\":false,\"error\":\"Chuyển hướng không hợp lệ\"}");
                            return;
                        }
                        String next = new URL(new URL(currentUrl), loc).toString();
                        if (!isAllowedUpdateUrl(next)) {
                            sendJsonResponse(exchange, 403, "{\"success\":false,\"error\":\"Bị chuyển hướng tới máy chủ không được phép.\"}");
                            return;
                        }
                        currentUrl = next;
                        continue;
                    }
                    if (status != 200) {
                        sendJsonResponse(exchange, 502, "{\"success\":false,\"error\":\"Download failed with HTTP " + status + "\"}");
                        return;
                    }
                    break;
                }

                // Tải về tệp tạm, vừa tải vừa băm SHA-256, giới hạn dung lượng
                java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(tempZip)) {
                    byte[] buffer = new byte[16384];
                    int bytesRead;
                    while ((bytesRead = in.read(buffer)) != -1) {
                        total += bytesRead;
                        if (total > MAX_PACKAGE_BYTES) {
                            sendJsonResponse(exchange, 413, "{\"success\":false,\"error\":\"Gói cập nhật vượt quá dung lượng cho phép\"}");
                            return;
                        }
                        md.update(buffer, 0, bytesRead);
                        out.write(buffer, 0, bytesRead);
                    }
                }
                String actualSha = toHex(md.digest());
                if (!actualSha.equals(expectedSha)) {
                    System.err.println("[SECURITY] SHA-256 không khớp. Mong đợi " + expectedSha + ", thực tế " + actualSha);
                    sendJsonResponse(exchange, 400, "{\"success\":false,\"error\":\"Mã SHA-256 của gói không khớp. Đã hủy cập nhật, không có tệp nào bị ghi đè.\"}");
                    return;
                }

                // Giải nén có chọn lọc
                int extractedCount = 0;
                int skippedCount = 0;
                long extractedBytes = 0;
                try (ZipInputStream zis = new ZipInputStream(new FileInputStream(tempZip))) {
                    ZipEntry entry;
                    while ((entry = zis.getNextEntry()) != null) {
                        String entryName = entry.getName().replace('\\', '/');
                        if (entryName.startsWith("code/")) {
                            entryName = entryName.substring(5);
                        }
                        if (entryName.isEmpty() || entryName.startsWith("/") || entryName.contains("..") || entryName.contains(":")) {
                            skippedCount++;
                            zis.closeEntry();
                            continue;
                        }
                        String lower = entryName.toLowerCase();
                        if (isProtectedName(lower)) {   // Không bao giờ ghi đè DB, log, phiên báo cáo
                            zis.closeEntry();
                            continue;
                        }
                        if (entry.isDirectory() || entryName.endsWith("/")) {
                            zis.closeEntry();
                            continue;
                        }
                        if (!ALLOWED_EXT.contains(extensionOf(lower))) {
                            System.err.println("[SECURITY] Bỏ qua tệp không thuộc loại cho phép: " + entryName);
                            skippedCount++;
                            zis.closeEntry();
                            continue;
                        }

                        File targetFile = new File(extDir, entryName);
                        if (!targetFile.getCanonicalPath().startsWith(extRoot)) {   // zip-slip
                            skippedCount++;
                            zis.closeEntry();
                            continue;
                        }
                        File parent = targetFile.getParentFile();
                        if (parent != null && !parent.exists()) {
                            parent.mkdirs();
                        }
                        try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                            byte[] buffer = new byte[16384];
                            int len;
                            while ((len = zis.read(buffer)) != -1) {
                                extractedBytes += len;
                                if (extractedBytes > MAX_EXTRACT_BYTES) {
                                    throw new IOException("Dung lượng giải nén vượt giới hạn");
                                }
                                fos.write(buffer, 0, len);
                            }
                        }
                        extractedCount++;
                        zis.closeEntry();
                    }
                }

                sendJsonResponse(exchange, 200, "{\"success\":true,\"extractedFiles\":" + extractedCount + ",\"skippedFiles\":" + skippedCount + ",\"message\":\"Extension updated successfully\"}");
            } catch (Throwable e) {
                e.printStackTrace();
                String msg = (e.getMessage() != null) ? e.getMessage() : e.toString();
                msg = msg.replace("\\", "\\\\").replace("\"", "\\\"");
                try {
                    sendJsonResponse(exchange, 500, "{\"success\":false,\"error\":\"" + msg + "\"}");
                } catch (Exception ignored) {}
            } finally {
                if (tempZip != null && tempZip.exists()) {
                    try {
                        tempZip.delete();
                    } catch (Exception ignored) {}
                }
            }
        }

        private void sendJsonResponse(HttpExchange exchange, int statusCode, String json) throws IOException {
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(statusCode, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }
}
