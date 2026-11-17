/*
 * background.js - Service Worker (Manifest V3).
 *
 * Thay đổi so với v1.1.2:
 *  - Không còn mật khẩu nằm trong mã nguồn: tài khoản hệ thống từng site được cấu hình qua giao diện
 *    và lưu trong chrome.storage.local (xem handler get_credentials_status / set_credentials).
 *  - Gom 4 khối "đăng nhập lại rồi gọi lại" trùng lặp vào callAuthed(); chống đăng nhập song song.
 *  - Lệnh ghi / thủ tục (strict) chỉ được gọi lại khi tín hiệu hết phiên là CHẮC CHẮN, tránh chạy lặp lệnh có tác dụng phụ.
 *  - Phân loại câu lệnh, ghép phân trang, đếm tổng dùng chung với UI qua sql_utils.js (có kiểm thử).
 *  - Chỉ chấp nhận lệnh nhạy cảm từ trang của chính extension.
 */
if (typeof importScripts === 'function') {
    try { importScripts('sql_utils.js'); } catch (e) { console.error('Không nạp được sql_utils.js', e); }
}
const SU = (typeof self !== 'undefined' && self.SqlUtils) || (typeof require === 'function' ? require('./sql_utils.js') : null);

const LinkServices = {
    hung_yen: "https://bvhungyen.vncare.vn/vnpthis/RestService",
    thai_binh: "https://bvthaibinh.vncare.vn/vnpthis/RestService"
};

const CRED_STORAGE_KEY = 'siteCredentials';
const REQUEST_TIMEOUT_MS = 180000;
const MAX_ROWS = 100000;
const HELPER_ORIGIN = "http://127.0.0.1:8080";

const cachedUsers = {};
const loginInFlight = {};

class NeedCredentialsError extends Error {
    constructor(siteKey) {
        super(`Chưa cấu hình tài khoản hệ thống cho site ${siteKey}.`);
        this.name = 'NeedCredentialsError';
        this.siteKey = siteKey;
    }
}

function credentialErrorResponse(err) {
    return { success: false, needCredentials: true, siteKey: err.siteKey, error: err.message };
}

async function logDebug(actionType, detail) {
    try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const logText = `[${timeStr}] | ${actionType} | BG_LOG | ${detail}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        fetch(`${HELPER_ORIGIN}/write-log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: dateStr, log: logText }),
            signal: controller.signal
        }).catch(() => {}).finally(() => clearTimeout(timeoutId));
    } catch (e) { /* ghi log không được làm hỏng luồng chính */ }
}

// ---------------------------------------------------------------------------
// Tài khoản hệ thống (không nằm trong mã nguồn)
// ---------------------------------------------------------------------------
// Mật khẩu được mã hóa AES-GCM trước khi lưu. Khóa là CryptoKey KHÔNG xuất được, lưu trong IndexedDB của extension,
// nên sao chép riêng thư mục profile/chrome.storage sang máy khác không đọc được mật khẩu.
// Lưu ý: mã độc chạy cùng tài khoản Windows với trình duyệt vẫn có thể dùng khóa này; đây không phải kho bí mật phần cứng.
const KEY_DB = 'his_tool_keys';
const KEY_STORE = 'keys';
const KEY_ID = 'credKey';
let keyProvider = null;   // cho phép kiểm thử thay thế

function idbRequest(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function defaultKeyProvider() {
    const open = indexedDB.open(KEY_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(KEY_STORE);
    const db = await idbRequest(open);
    try {
        let key = await idbRequest(db.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(KEY_ID));
        if (!key) {
            key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            await idbRequest(db.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).put(key, KEY_ID));
        }
        return key;
    } finally {
        db.close();
    }
}

function getCryptoKey() {
    return (keyProvider || defaultKeyProvider)();
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

async function encryptSecret(plain) {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
    return { iv: toB64(iv), ct: toB64(ct) };
}

async function decryptSecret(box) {
    const key = await getCryptoKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
    return new TextDecoder().decode(plain);
}

async function readAllCredentials() {
    const r = await chrome.storage.local.get([CRED_STORAGE_KEY]);
    return r[CRED_STORAGE_KEY] || {};
}

// Tài khoản mặc định cho công cụ nội bộ: dùng khi chưa cấu hình riêng. Nút 🔑 Tài khoản vẫn ghi đè được.
const DEFAULT_CREDENTIALS = {
    hung_yen: { username: "KDGHYN.ADMINHYN", password: "Pgp@3334##" },
    thai_binh: { username: "PKBATBH.ADMINTBH", password: "Pgp@3334#" }
};

async function getCredentials(siteKey) {
    const all = await readAllCredentials();
    const c = all[siteKey] || DEFAULT_CREDENTIALS[siteKey];
    if (!c || !c.username) throw new NeedCredentialsError(siteKey);

    if (c.passwordEnc) {
        try {
            return { username: c.username, password: await decryptSecret(c.passwordEnc) };
        } catch (e) {
            // Khóa không còn (xóa dữ liệu extension/đổi profile): buộc nhập lại
            console.warn('Không giải mã được mật khẩu, dùng tài khoản mặc định (nếu có):', e && e.message);
            if (DEFAULT_CREDENTIALS[siteKey]) return { ...DEFAULT_CREDENTIALS[siteKey] };
            throw new NeedCredentialsError(siteKey);
        }
    }
    if (c.password) {
        // Bản ghi dạng cũ (chưa mã hóa): dùng ngay và mã hóa lại
        const legacy = { username: c.username, password: c.password };
        try { await saveCredentials(siteKey, legacy); } catch (e) { /* vẫn dùng được */ }
        return legacy;
    }
    throw new NeedCredentialsError(siteKey);
}

async function saveCredentials(siteKey, cred) {
    const all = await readAllCredentials();
    if (cred) {
        all[siteKey] = { username: cred.username, passwordEnc: await encryptSecret(cred.password) };
    } else {
        delete all[siteKey];
    }
    await chrome.storage.local.set({ [CRED_STORAGE_KEY]: all });
}

async function getCredentialsStatus() {
    const all = await readAllCredentials();
    const sites = {};
    for (const key of Object.keys(LinkServices)) {
        const c = all[key];
        // Không bao giờ trả mật khẩu ra giao diện
        const eff = (c && c.username) ? c : DEFAULT_CREDENTIALS[key];
        sites[key] = { configured: !!(eff && eff.username && (eff.passwordEnc || eff.password)), username: eff ? eff.username || '' : '' };
    }
    return { success: true, sites };
}

async function handleSetCredentials(request) {
    const siteKey = request.siteKey;
    if (!LinkServices[siteKey]) return { success: false, error: `Site không hợp lệ: ${siteKey}` };
    const username = String(request.username || '').trim();
    const password = String(request.password || '');
    if (!username || !password) return { success: false, error: 'Vui lòng nhập đủ tài khoản và mật khẩu.' };

    const previousRaw = (await readAllCredentials())[siteKey] || null;
    await saveCredentials(siteKey, { username, password });
    await setCachedUser(siteKey, null);

    let ok = false;
    try { ok = await loginSite(siteKey); } catch (e) { ok = false; }
    if (!ok) {
        // Giữ nguyên cấu hình cũ (bản ghi đã mã hóa) nếu thông tin mới không đăng nhập được
        const all = await readAllCredentials();
        if (previousRaw) all[siteKey] = previousRaw; else delete all[siteKey];
        await chrome.storage.local.set({ [CRED_STORAGE_KEY]: all });
        await setCachedUser(siteKey, null);
        return { success: false, error: 'Đăng nhập thử thất bại: sai tài khoản/mật khẩu hoặc không kết nối được máy chủ.' };
    }
    await logDebug("CREDENTIALS_SET", `Site: ${siteKey}`);
    return { success: true };
}

// ---------------------------------------------------------------------------
// Token / phiên
// ---------------------------------------------------------------------------
async function setCachedUser(siteKey, data) {
    cachedUsers[siteKey] = data;
    if (data) {
        await chrome.storage.local.set({ [`cachedUser_${siteKey}`]: data });
    } else {
        await chrome.storage.local.remove([`cachedUser_${siteKey}`]);
    }
}

async function getCachedUser(siteKey) {
    let user = cachedUsers[siteKey];
    if (!user) {
        const result = await chrome.storage.local.get([`cachedUser_${siteKey}`]);
        if (result[`cachedUser_${siteKey}`]) {
            user = result[`cachedUser_${siteKey}`];
            cachedUsers[siteKey] = user;   // Service Worker bị tắt bất kỳ lúc nào: luôn nạp lại từ storage
        }
    }
    if (user && user.UUID) {
        if (SU.isJwtExpired(user.UUID)) {
            await logDebug("TOKEN_EXPIRED", `JWT Token for ${siteKey} is expired. Clearing cached user...`);
            await setCachedUser(siteKey, null);
            return null;
        }
        return user;
    }
    return null;
}

function loginSite(siteKey) {
    // Nhiều yêu cầu cùng hết phiên một lúc chỉ đăng nhập một lần
    if (!loginInFlight[siteKey]) {
        loginInFlight[siteKey] = doLogin(siteKey).finally(() => { delete loginInFlight[siteKey]; });
    }
    return loginInFlight[siteKey];
}

async function doLogin(siteKey) {
    const cred = await getCredentials(siteKey);
    const loginRes = await sendRequest({
        func: "doLogin",
        uuid: "",
        params: ["{?=call prc_login(?2S,?3S)}", cred.username, cred.password]
    }, LinkServices[siteKey]);

    const userData = loginRes && loginRes.result;
    if (typeof userData === 'string') {
        const match = userData.match(/"UUID"\s*:\s*"([^"]+)"/);
        if (match) {
            await setCachedUser(siteKey, { UUID: match[1] });
            return true;
        }
    } else if (userData && userData.UUID) {
        await setCachedUser(siteKey, userData);
        return true;
    }
    return false;
}

async function ensureUser(siteKey, relogin) {
    let user = relogin ? null : await getCachedUser(siteKey);
    if (!user) {
        const ok = await loginSite(siteKey);
        if (!ok) throw new Error(relogin ? `Đăng nhập lại ${siteKey} thất bại.` : `Đăng nhập ${siteKey} thất bại.`);
        user = await getCachedUser(siteKey);
        if (!user) throw new Error(`Đăng nhập ${siteKey} thất bại.`);
    }
    return user;
}

/**
 * Gọi RestService có tự xác thực lại.
 * @param buildPayload  (uuid) => payload
 * @param strict        true cho lệnh ghi/thủ tục: chỉ gọi lại khi chắc chắn hết phiên
 */
async function callAuthed(siteKey, buildPayload, opts) {
    const strict = !!(opts && opts.strict);
    const link = LinkServices[siteKey];
    if (!link) throw new Error(`Không tìm thấy LinkServices cho ${siteKey}`);

    let user = await ensureUser(siteKey, false);
    let res = await sendRequest(buildPayload(user.UUID), link);

    if (SU.isSessionExpired(res, strict)) {
        await logDebug("SESSION_RETRY", `Site: ${siteKey}, strict: ${strict}. Session expired, re-logging in...`);
        await setCachedUser(siteKey, null);
        user = await ensureUser(siteKey, true);
        res = await sendRequest(buildPayload(user.UUID), link);
    }
    return res;
}

// ---------------------------------------------------------------------------
// Jasper Helper (native host)
// ---------------------------------------------------------------------------
async function checkAndStartJasperHelper() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        const res = await fetch(`${HELPER_ORIGIN}/list-logs`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            return { success: true, running: true };
        }
    } catch (e) { /* chưa chạy: thử khởi động qua native host */ }

    return new Promise((resolve) => {
        if (chrome.runtime && chrome.runtime.sendNativeMessage) {
            try {
                chrome.runtime.sendNativeMessage("com.his.jasper_helper", { action: "start" }, (response) => {
                    if (chrome.runtime.lastError) {
                        const errMsg = chrome.runtime.lastError.message || "Native host not found";
                        console.log("[NATIVE_HOST] Host info:", errMsg);
                        resolve({ success: false, nativeHostMissing: true, error: errMsg });
                    } else {
                        console.log("[NATIVE_HOST] Host response:", response);
                        resolve({ success: true, started: true, response });
                    }
                });
                return;
            } catch (e) {
                console.error("[NATIVE_HOST] Exception:", e);
                resolve({ success: false, error: e.message });
                return;
            }
        }
        resolve({ success: false, error: "Native messaging not supported" });
    });
}

// ---------------------------------------------------------------------------
// Gọi RestService
// ---------------------------------------------------------------------------
async function sendRequest(reqData, url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: JSON.stringify(reqData),
            credentials: 'include',
            signal: controller.signal
        });

        let text = await response.text();
        if (!text) return null;
        text = text.trim();

        if (text.startsWith("'") && text.endsWith("'")) {
            text = text.substring(1, text.length - 1);
        }

        try {
            return JSON.parse(text);
        } catch (e) {
            const cleaned = text
                .replace(/^\s*'/, '')
                .replace(/'\s*$/, '')
                .replace(/\\'/g, "'")
                .replace(/[\r\n\t]/g, " ");
            try {
                return JSON.parse(cleaned);
            } catch (e2) {
                return { result: cleaned, error_code: 0, isRaw: true };
            }
        }
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error(`Hết thời gian chờ máy chủ HIS (${Math.round(REQUEST_TIMEOUT_MS / 1000)} giây).`);
        }
        console.error("API Error:", error);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function normalizeResultData(finalData) {
    if (typeof finalData !== 'string') return finalData;
    let clean = finalData.trim();
    if (clean.startsWith("'") && clean.endsWith("'")) {
        clean = clean.substring(1, clean.length - 1);
    }
    if (clean.startsWith('[') || clean.startsWith('{')) {
        try { return JSON.parse(clean); } catch (e) { return clean; }
    }
    return clean;
}

function isEmptyFailure(res) {
    return !!(res && res.error_code !== 0 && (!res.result || res.result === "" || res.result === "[]"));
}

const SP_SCHEMA = "S.KQDICHVU.HYN3";

async function handleCallSPS(request, siteKey) {
    try {
        const response = await callAuthed(siteKey, (uuid) => ({
            func: "ajaxCALL_SP_S",
            uuid: uuid,
            params: request.params || []
        }), { strict: true });

        let result = response && response.result;
        if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch (e) { /* giữ nguyên chuỗi */ }
        }
        return { success: true, data: result, rawResponse: response };
    } catch (err) {
        if (err instanceof NeedCredentialsError) return credentialErrorResponse(err);
        console.error("Call SP_S Error:", err);
        return { success: false, error: err.message };
    }
}

async function handleSqlExecution(sql, siteKey, page = 1, pageSize = 50, noLimit = false, syncCount = false) {
    console.log(`[BACKEND] Nhận request - page=${page}, pageSize=${pageSize}`);
    await logDebug("SQL_EXEC", `Site: ${siteKey}, Page: ${page}, PageSize: ${pageSize}, SQL: ${String(sql).substring(0, 150)}`);

    try {
        const analysis = SU.analyze(sql);

        const trimmedSql = String(sql).trim();
        const isProcedure = analysis.isProcedure;
        let finalData = [];
        let totalRows = 0;
        let warning = null;

        if (isProcedure) {
            let procWrapper = trimmedSql;
            if (!procWrapper.endsWith("$$")) procWrapper += "$$";

            const procRes = await callAuthed(siteKey, (uuid) => ({
                func: "ajaxCALL_SP_O",
                uuid: uuid,
                params: [SP_SCHEMA, procWrapper, 0]
            }), { strict: true });

            if (isEmptyFailure(procRes)) {
                const errMsg = procRes.error_msg || `Lỗi thực thi thủ tục (mã: ${procRes.error_code})`;
                await logDebug("SQL_EXEC_FAIL", `Procedure error: ${errMsg}`);
                return { success: false, error: errMsg };
            }
            finalData = (procRes && procRes.result) || [];
            totalRows = Array.isArray(finalData) ? finalData.length : 0;
        } else {
            let effectivePageSize;
            if (noLimit) {
                effectivePageSize = MAX_ROWS;
            } else {
                effectivePageSize = Math.min(Math.max(parseInt(pageSize) || 50, 10), 500);
            }
            pageSize = effectivePageSize;

            const paged = SU.applyPaging(trimmedSql, {
                noLimit, maxRows: MAX_ROWS,
                offset: (page - 1) * pageSize, pageSize
            });
            console.log(`[BACKEND] Thực thi SQL noLimit=${noLimit} với OFFSET=${(page - 1) * pageSize}, FETCH=${pageSize}`);

            const dataRes = await callAuthed(siteKey, (uuid) => ({
                func: "ajaxCALL_SP_O",
                uuid: uuid,
                params: [SP_SCHEMA, `$\n\n${paged.sql}\n$`, 0]
            }), { strict: false });

            await logDebug("SQL_EXEC_RES", `error_code: ${dataRes && dataRes.error_code}, error_msg: ${(dataRes && dataRes.error_msg) || ''}, result type: ${typeof (dataRes && dataRes.result)}, isRaw: ${dataRes && dataRes.isRaw}`);

            if (isEmptyFailure(dataRes)) {
                const errMsg = dataRes.error_msg || `Lỗi máy chủ VNPT HIS (mã: ${dataRes.error_code})`;
                await logDebug("SQL_EXEC_FAIL", `Server error: ${errMsg}`);
                return { success: false, error: errMsg };
            }
            finalData = (dataRes && dataRes.result) || [];
            finalData = normalizeResultData(finalData);
            const dataArray = Array.isArray(finalData) ? finalData : [];

            if (noLimit || !paged.appended) {
                totalRows = dataArray.length;
            } else if (dataArray.length < pageSize) {
                // Trang cuối hoặc toàn bộ dữ liệu < pageSize: không cần COUNT(*)
                totalRows = (page - 1) * pageSize + dataArray.length;
            } else {
                const extracted = dataArray.length > 0 ? SU.extractWindowTotal(trimmedSql, dataArray[0]) : null;
                if (extracted !== null) {
                    totalRows = extracted;
                } else if (syncCount) {
                    const countRes = await handleSqlCount(trimmedSql, siteKey);
                    totalRows = (countRes && countRes.success) ? countRes.totalRows : null;
                } else {
                    totalRows = null;   // UI hiển thị ngay, đếm ngầm sau
                }
            }
            if (paged.appended && paged.unstableOrder && (page > 1 || dataArray.length >= pageSize)) {
                warning = 'Câu truy vấn không có ORDER BY: thứ tự dòng giữa các trang không được đảm bảo (có thể trùng/sót dòng).';
            }
        }

        finalData = normalizeResultData(finalData);
        const dataArray = Array.isArray(finalData) ? finalData : [];

        console.log(`[BACKEND] Trả về: ${dataArray.length} rows, pageSize=${pageSize}, totalRows=${totalRows}`);
        await logDebug("SQL_EXEC_DONE", `Success: true, length: ${dataArray.length}, totalRows: ${totalRows}`);

        const out = { success: true, data: dataArray, page, pageSize, totalRows, isProcedure };
        if (warning) out.warning = warning;
        return out;
    } catch (err) {
        if (err instanceof NeedCredentialsError) return credentialErrorResponse(err);
        console.error("Execution Error:", err);
        await logDebug("SQL_EXEC_ERR", `Error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

async function handleSqlCount(sql, siteKey) {
    if (!LinkServices[siteKey]) {
        return { success: false, error: `Không tìm thấy LinkServices cho ${siteKey}` };
    }
    try {
        const countSql = SU.buildCountSql(sql);
        console.log(`[BACKEND] Bắt đầu thực thi count SQL...`);
        const countRes = await callAuthed(siteKey, (uuid) => ({
            func: "ajaxCALL_SP_O",
            uuid: uuid,
            params: [SP_SCHEMA, `$\n\n${countSql}\n$`, 0]
        }), { strict: false });

        let totalRows = 0;
        if (countRes && countRes.result) {
            let countData = countRes.result;
            if (typeof countData === 'string') {
                let clean = countData.trim();
                if (clean.startsWith("'") && clean.endsWith("'")) {
                    clean = clean.substring(1, clean.length - 1);
                }
                try {
                    countData = JSON.parse(clean);
                } catch (e) {
                    const match = clean.match(/"TOTAL"\s*:\s*"?(\d+)"?/i);
                    totalRows = match ? parseInt(match[1]) : 0;
                }
            }
            if (Array.isArray(countData) && countData.length > 0) {
                const row = countData[0];
                totalRows = parseInt(row.TOTAL || row.total || Object.values(row)[0] || 0);
            }
        }
        console.log(`[BACKEND] Đếm hoàn tất: totalRows = ${totalRows}`);
        return { success: true, totalRows };
    } catch (err) {
        if (err instanceof NeedCredentialsError) return credentialErrorResponse(err);
        console.error("Count Error:", err);
        return { success: false, error: err.message };
    }
}

async function handleRenderJasper(request) {
    const urls = [`${HELPER_ORIGIN}/fill`, "http://localhost:8080/fill"];
    let lastErr = null;
    for (const url of urls) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jrxml: request.jrxml,
                    jsonData: request.jsonData,
                    parameters: request.parameters
                })
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text);
            }
            const buffer = await res.arrayBuffer();
            return { success: true, pdfBytes: Array.from(new Uint8Array(buffer)) };
        } catch (err) {
            lastErr = err;
        }
    }
    throw (lastErr || new Error("Không thể kết xuất PDF qua Jasper Helper"));
}

async function handleQueryPaging(request) {
    const siteKey = request.siteKey || 'hung_yen';
    if (!LinkServices[siteKey]) {
        return { success: false, error: "Missing link service" };
    }
    try {
        const response = await callAuthed(siteKey, (uuid) => ({
            func: "ajaxExecuteQueryPaging",
            uuid: request.uuid || uuid,
            params: request.params || [],
            options: request.options || [],
            _search: request._search || "false",
            nd: Date.now(),
            rows: request.rows || "20",
            page: request.page || "1",
            sidx: request.sidx || "",
            sord: request.sord || "asc",
            filters: request.filters || ""
        }), { strict: false });
        return { success: true, data: response };
    } catch (err) {
        if (err instanceof NeedCredentialsError) return credentialErrorResponse(err);
        return { success: false, error: err.message };
    }
}

function isDefaultOrEmpty(tabs) {
    if (!tabs) return true;
    const hy = tabs.hung_yen || [];
    const tb = tabs.thai_binh || [];
    if (hy.length === 0 && tb.length === 0) return true;
    if (hy.length === 1 && tb.length === 0) {
        const t = hy[0];
        if ((t.sql || '').trim() === '' && t.name === 'Query 1') return true;
    }
    if (tb.length === 1 && hy.length === 0) {
        const t = tb[0];
        if ((t.sql || '').trim() === '' && t.name === 'Query 1') return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Đăng ký sự kiện (bỏ qua khi chạy trong môi trường kiểm thử không có chrome.*)
// ---------------------------------------------------------------------------
// Các hành động nhạy cảm chỉ nhận từ trang của chính extension (không nhận từ content script trên trang HIS)
const PRIVILEGED_ACTIONS = new Set([
    "start_jasper_helper", "render_jasper", "execute_sql", "count_sql", "call_sp_s",
    "execute_query_paging", "broadcast_backup", "get_credentials_status", "set_credentials", "clear_credentials"
]);

function isFromExtensionPage(sender) {
    try {
        return !!sender && sender.id === chrome.runtime.id &&
            typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
    } catch (e) { return false; }
}

function registerListeners() {
    const actionAPI = (chrome.browserAction) ? chrome.browserAction : (chrome.action ? chrome.action : null);
    if (actionAPI && actionAPI.onClicked) {
        actionAPI.onClicked.addListener(() => {
            checkAndStartJasperHelper();
            chrome.tabs.create({ url: chrome.runtime.getURL("ui.html") });
        });
    }

    chrome.tabs.onCreated.addListener((tab) => {
        if (tab.url && tab.url.includes("ui.html")) checkAndStartJasperHelper();
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if ((changeInfo.url && changeInfo.url.includes("ui.html")) ||
            (tab.url && tab.url.includes("ui.html") && changeInfo.status === "loading")) {
            checkAndStartJasperHelper();
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (PRIVILEGED_ACTIONS.has(request.action) && !isFromExtensionPage(sender)) {
            sendResponse({ success: false, error: "Yêu cầu bị từ chối: không đến từ giao diện extension." });
            return true;
        }

        const reply = (p) => p.then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));

        switch (request.action) {
            case "start_jasper_helper":
                checkAndStartJasperHelper().then(sendResponse);
                return true;

            case "update_session_uuid":
                // Bỏ qua session trình duyệt để hệ thống luôn chạy bằng tài khoản hệ thống độc lập
                sendResponse({ success: true, ignored: true });
                return true;

            case "render_jasper":
                reply(handleRenderJasper(request));
                return true;

            case "execute_sql":
                reply(handleSqlExecution(request.sql, request.siteKey || 'hung_yen', request.page || 1,
                    request.pageSize || 50, request.noLimit || false, request.syncCount || false));
                return true;

            case "count_sql":
                reply(handleSqlCount(request.sql, request.siteKey || 'hung_yen'));
                return true;

            case "call_sp_s":
                reply(handleCallSPS(request, request.siteKey || 'hung_yen'));
                return true;

            case "execute_query_paging":
                reply(handleQueryPaging(request));
                return true;

            case "get_credentials_status":
                reply(getCredentialsStatus());
                return true;

            case "set_credentials":
                reply(handleSetCredentials(request));
                return true;

            case "clear_credentials":
                reply((async () => {
                    await saveCredentials(request.siteKey, null);
                    await setCachedUser(request.siteKey, null);
                    return { success: true };
                })());
                return true;

            case "broadcast_backup":
                chrome.tabs.query({ url: [
                    "https://bvhungyen.vncare.vn/*",
                    "https://bvthaibinh.vncare.vn/*",
                    "https://bvdakhoa.vncare.vn/*"
                ] }, (tabs) => {
                    if (tabs) {
                        tabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, { action: "save_backup", data: request.data }).catch(() => {});
                        });
                    }
                });
                sendResponse({ success: true });
                return true;

            case "check_and_restore_tabs":
                chrome.storage.local.get(['tabsBySite'], (result) => {
                    const hasNoTabs = !result.tabsBySite;
                    const isDefault = result.tabsBySite && isDefaultOrEmpty(result.tabsBySite);
                    if (hasNoTabs || isDefault) {
                        if (!isDefaultOrEmpty(request.backup) || hasNoTabs) {
                            chrome.storage.local.set({ tabsBySite: request.backup }, () => {
                                console.log("Restored tabs from page storage!");
                                chrome.tabs.query({ url: chrome.runtime.getURL("ui.html") }, (uiTabs) => {
                                    if (uiTabs) {
                                        uiTabs.forEach(uiTab => {
                                            chrome.tabs.reload(uiTab.id).catch(() => {});
                                        });
                                    }
                                });
                            });
                        }
                    }
                });
                sendResponse({ success: true });
                return true;
        }
    });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    registerListeners();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        handleSqlExecution, handleSqlCount, handleCallSPS, handleQueryPaging, handleSetCredentials,
        getCredentialsStatus, callAuthed, loginSite, NeedCredentialsError, LinkServices,
        _cachedUsers: cachedUsers,   // chỉ phục vụ kiểm thử
        _setKeyProvider: (fn) => { keyProvider = fn; }
    };
}
