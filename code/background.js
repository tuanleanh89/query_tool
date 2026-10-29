const LinkServices = {
    hung_yen: "https://bvhungyen.vncare.vn/vnpthis/RestService",
    thai_binh: "https://bvthaibinh.vncare.vn/vnpthis/RestService"
};

const LoginCredentials = {
    hung_yen: { username: "34343HYN.ADMIN", password: "Pgp@3334#" },
    thai_binh: { username: "PKBATBH.ADMINTBH", password: "Pgp@3334#" }
};

let cachedUsers = { hung_yen: null, thai_binh: null };
const invalidTokens = new Set();

async function logDebug(actionType, detail) {
    try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const logText = `[${timeStr}] | ${actionType} | BG_LOG | ${detail}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        fetch("http://localhost:8080/write-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: dateStr, log: logText }),
            signal: controller.signal
        }).catch(() => {}).finally(() => clearTimeout(timeoutId));
    } catch (e) {}
}

function isJwtExpired(token) {
    if (!token || typeof token !== 'string') return true;
    try {
        const parts = token.split('.');
        if (parts.length < 2) return true;
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const decoded = JSON.parse(atob(base64));
        if (decoded && decoded.exp) {
            return (decoded.exp * 1000) <= (Date.now() + 60000);
        }
    } catch (e) {}
    return false;
}

function isSessionExpired(res) {
    if (!res) return false;
    const msg = (res.error_msg || '').toLowerCase();
    const result = typeof res.result === 'string' ? res.result.trim() : '';
    return (
        result === "session=NULL" ||
        res.error_code === 2 ||
        msg.includes("session") ||
        msg.includes("phiên") ||
        msg.includes("hết hạn") ||
        msg.includes("đã có lỗi xảy ra khi xử lý dữ liệu") ||
        (res.error_code !== 0 && (!res.result || res.result === "" || res.result === "[]"))
    );
}

async function getCachedUser(siteKey) {
    let user = cachedUsers[siteKey];
    if (!user) {
        const result = await chrome.storage.local.get([`cachedUser_${siteKey}`]);
        if (result[`cachedUser_${siteKey}`]) {
            user = result[`cachedUser_${siteKey}`];
            cachedUsers[siteKey] = user;
        }
    }
    if (user && user.UUID) {
        if (isJwtExpired(user.UUID)) {
            await logDebug("TOKEN_EXPIRED", `JWT Token for ${siteKey} is expired. Clearing cached user...`);
            await setCachedUser(siteKey, null);
            return null;
        }
        return user;
    }
    return null;
}

async function setCachedUser(siteKey, data) {
    cachedUsers[siteKey] = data;
    if (data) {
        await chrome.storage.local.set({ [`cachedUser_${siteKey}`]: data });
    } else {
        await chrome.storage.local.remove([`cachedUser_${siteKey}`]);
    }
}

async function checkAndStartJasperHelper() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        const res = await fetch("http://localhost:8080/list-logs", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            return { success: true, running: true };
        }
    } catch (e) {}

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

const actionAPI = (typeof chrome !== "undefined" && chrome.browserAction) ? chrome.browserAction : ((typeof chrome !== "undefined" && chrome.action) ? chrome.action : null);
if (actionAPI && actionAPI.onClicked) {
    actionAPI.onClicked.addListener(() => {
        checkAndStartJasperHelper();
        chrome.tabs.create({ url: chrome.runtime.getURL("ui.html") });
    });
}

chrome.tabs.onCreated.addListener((tab) => {
    if (tab.url && tab.url.includes("ui.html")) {
        checkAndStartJasperHelper();
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if ((changeInfo.url && changeInfo.url.includes("ui.html")) || (tab.url && tab.url.includes("ui.html") && changeInfo.status === "loading")) {
        checkAndStartJasperHelper();
    }
});

async function sendRequest(reqData, url) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: JSON.stringify(reqData),
            credentials: 'include'
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
            let cleaned = text
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
        console.error("API Error:", error);
        throw error;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start_jasper_helper") {
        checkAndStartJasperHelper().then(sendResponse);
        return true;
    }

    if (request.action === "update_session_uuid") {
        // Hoan toan bo qua session trinh duyet de dam bao he thong luon chay bang tai khoan he thong doc lap
        sendResponse({ success: true, ignored: true });
        return true;
    }

    if (request.action === "render_jasper") {
        handleRenderJasper(request)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === "execute_sql") {
        handleSqlExecution(request.sql, request.siteKey || 'hung_yen', request.page || 1, request.pageSize || 50, request.noLimit || false, request.syncCount || false)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === "count_sql") {
        handleSqlCount(request.sql, request.siteKey || 'hung_yen')
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === "call_sp_s") {
        handleCallSPS(request, request.siteKey || 'hung_yen')
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === "execute_query_paging") {
        handleQueryPaging(request)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === "broadcast_backup") {
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
    }

    if (request.action === "check_and_restore_tabs") {
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

async function handleCallSPS(request, siteKey) {
    const currentLink = LinkServices[siteKey];
    if (!currentLink) {
        return { success: false, error: `Không tìm thấy LinkServices cho ${siteKey}` };
    }

    let user = await getCachedUser(siteKey);
    if (!user) {
        const loginSuccess = await loginSite(siteKey);
        if (!loginSuccess) {
            return { success: false, error: `Đăng nhập ${siteKey} thất bại.` };
        }
        user = await getCachedUser(siteKey);
    }

    let uuid = user.UUID;

    try {
        const payload = {
            func: "ajaxCALL_SP_S",
            uuid: uuid,
            params: request.params || []
        };

        console.log(`[BACKEND] Gọi ajaxCALL_SP_S:`, payload);

        let response = await sendRequest(payload, currentLink);

        if (isSessionExpired(response)) {
            console.log(`[BACKEND] Session expired for ajaxCALL_SP_S. Retrying with login credentials...`);
            await logDebug("SP_S_RETRY", `Session expired. Re-logging in...`);
            if (uuid) invalidTokens.add(uuid);
            await setCachedUser(siteKey, null);
            const loginSuccess = await loginSite(siteKey);
            if (loginSuccess) {
                user = await getCachedUser(siteKey);
                payload.uuid = user.UUID;
                response = await sendRequest(payload, currentLink);
            } else {
                return { success: false, error: `Đăng nhập lại ${siteKey} thất bại.` };
            }
        }

        let result = response?.result;

        if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch (e) { }
        }

        return {
            success: true,
            data: result,
            rawResponse: response
        };

    } catch (err) {
        console.error("Call SP_S Error:", err);
        return { success: false, error: err.message };
    }
}

async function loginSite(siteKey) {
    const cred = LoginCredentials[siteKey];
    const currentLink = LinkServices[siteKey];

    const loginParam = {
        func: "doLogin",
        uuid: "",
        params: ["{?=call prc_login(?2S,?3S)}", cred.username, cred.password]
    };

    const loginRes = await sendRequest(loginParam, currentLink);
    let userData = loginRes.result;

    if (typeof userData === 'string') {
        const match = userData.match(/"UUID"\s*:\s*"([^"]+)"/);
        if (match) {
            await setCachedUser(siteKey, { UUID: match[1] });
            return true;
        }
    } else if (userData?.UUID) {
        await setCachedUser(siteKey, userData);
        return true;
    }

    return false;
}

async function handleSqlExecution(sql, siteKey, page = 1, pageSize = 50, noLimit = false, syncCount = false) {
    const currentLink = LinkServices[siteKey];

    console.log(`[BACKEND] Nhận request - page=${page}, pageSize=${pageSize}`);
    await logDebug("SQL_EXEC", `Site: ${siteKey}, Page: ${page}, PageSize: ${pageSize}, SQL: ${sql.substring(0, 150)}`);

    try {
        let user = await getCachedUser(siteKey);
        if (!user) {
            await logDebug("SQL_EXEC_LOGIN", `No cached user. Logging in to ${siteKey}...`);
            const loginSuccess = await loginSite(siteKey);
            if (!loginSuccess) {
                await logDebug("SQL_EXEC_LOGIN_FAIL", `Login failed for ${siteKey}`);
                return { success: false, error: `Đăng nhập ${siteKey} thất bại.` };
            }
            user = await getCachedUser(siteKey);
        }

        let uuid = user.UUID;
        await logDebug("SQL_EXEC_UUID", `Using UUID: ${uuid.substring(0, 20)}...`);
        const trimmedSql = sql.trim();
        const upperSql = trimmedSql.toUpperCase();

        const isProcedure = upperSql.startsWith("BEGIN") || upperSql.includes("=>") || upperSql.includes("CALL ");

        let finalData = [];
        let totalRows = 0;

        if (isProcedure) {
            let procWrapper = trimmedSql;
            if (!procWrapper.endsWith("$$")) procWrapper += "$$";

            let payload = {
                func: "ajaxCALL_SP_O",
                uuid: uuid,
                params: ["S.KQDICHVU.HYN3", procWrapper, 0]
            };

            let procRes = await sendRequest(payload, currentLink);

            if (isSessionExpired(procRes)) {
                console.log(`[BACKEND] Session expired for procedure. Retrying...`);
                await logDebug("PROC_EXEC_RETRY", `Session expired. Re-logging in...`);
                if (uuid) invalidTokens.add(uuid);
                await setCachedUser(siteKey, null);
                const loginSuccess = await loginSite(siteKey);
                if (loginSuccess) {
                    user = await getCachedUser(siteKey);
                    payload.uuid = user.UUID;
                    procRes = await sendRequest(payload, currentLink);
                } else {
                    return { success: false, error: `Đăng nhập lại ${siteKey} thất bại.` };
                }
            }

            if (procRes && procRes.error_code !== 0 && (!procRes.result || procRes.result === "" || procRes.result === "[]")) {
                const errMsg = procRes.error_msg || `Lỗi thực thi thủ tục (mã: ${procRes.error_code})`;
                await logDebug("SQL_EXEC_FAIL", `Procedure error: ${errMsg}`);
                return { success: false, error: errMsg };
            }

            finalData = procRes?.result || [];
            totalRows = Array.isArray(finalData) ? finalData.length : 0;

        } else {
            const MAX_ROWS = 100000;
            if (noLimit) {
                pageSize = MAX_ROWS;
            } else {
                pageSize = Math.min(Math.max(parseInt(pageSize) || 50, 10), 500);
            }

            let dataSql = trimmedSql;

            if (!upperSql.includes("OFFSET") && !upperSql.includes("FETCH NEXT")) {
                if (noLimit) {
                    dataSql += `\nFETCH NEXT ${MAX_ROWS} ROWS ONLY`;
                } else {
                    const offset = (page - 1) * pageSize;
                    dataSql += `\nOFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
                }
            }

            console.log(`[BACKEND] Thực thi SQL noLimit=${noLimit} với OFFSET=${(page - 1) * pageSize}, FETCH=${pageSize}`);

            let dataPayload = {
                func: "ajaxCALL_SP_O",
                uuid: uuid,
                params: ["S.KQDICHVU.HYN3", `$\n\n${dataSql}\n$`, 0]
            };

            let dataRes = await sendRequest(dataPayload, currentLink);
            await logDebug("SQL_EXEC_RES", `dataRes status: ${dataRes ? 'has_resp' : 'null'}, error_msg: ${dataRes?.error_msg || ''}, error_code: ${dataRes?.error_code}, result type: ${typeof dataRes?.result}, isRaw: ${dataRes?.isRaw}, result prefix: ${dataRes?.result ? String(dataRes.result).substring(0, 100) : ''}`);

            if (isSessionExpired(dataRes)) {
                console.log(`[BACKEND] Session expired for data query. Retrying...`);
                await logDebug("SQL_EXEC_RETRY", `Session expired. Re-logging in...`);
                if (uuid) invalidTokens.add(uuid);
                await setCachedUser(siteKey, null);
                const loginSuccess = await loginSite(siteKey);
                if (loginSuccess) {
                    user = await getCachedUser(siteKey);
                    uuid = user.UUID;
                    dataPayload.uuid = uuid;
                    dataRes = await sendRequest(dataPayload, currentLink);
                    await logDebug("SQL_EXEC_RETRY_RES", `Retried dataRes status: ${dataRes ? 'has_resp' : 'null'}, error_msg: ${dataRes?.error_msg || ''}, result type: ${typeof dataRes?.result}`);
                } else {
                    await logDebug("SQL_EXEC_RETRY_FAIL", `Re-login failed for ${siteKey}`);
                    return { success: false, error: `Đăng nhập lại ${siteKey} thất bại.` };
                }
            }

            if (dataRes && dataRes.error_code !== 0 && (!dataRes.result || dataRes.result === "" || dataRes.result === "[]")) {
                const errMsg = dataRes.error_msg || `Lỗi máy chủ VNPT HIS (mã: ${dataRes.error_code})`;
                await logDebug("SQL_EXEC_FAIL", `Server error: ${errMsg}`);
                return { success: false, error: errMsg };
            }

            finalData = dataRes?.result || [];
        }

        if (typeof finalData === 'string') {
            let clean = finalData.trim();
            if (clean.startsWith("'") && clean.endsWith("'")) {
                clean = clean.substring(1, clean.length - 1);
            }

            if (clean.startsWith('[') || clean.startsWith('{')) {
                try {
                    finalData = JSON.parse(clean);
                } catch (e) {
                    finalData = clean;
                }
            } else {
                finalData = clean;
            }
        }

        const dataArray = Array.isArray(finalData) ? finalData : [];

        if (!isProcedure) {
            if (noLimit) {
                totalRows = dataArray.length;
            } else if (upperSql.includes("OFFSET") || upperSql.includes("FETCH NEXT")) {
                totalRows = dataArray.length;
            } else if (dataArray.length < pageSize) {
                // Trang cuối cùng hoặc toàn bộ dữ liệu < pageSize -> Không cần gọi COUNT(*)
                totalRows = (page - 1) * pageSize + dataArray.length;
            } else {
                // Kiểm tra xem câu SQL có sẵn window function COUNT(*) OVER() không (như trong query người dùng)
                let extractedTotal = null;
                if (dataArray.length > 0 && /COUNT\s*\(\s*\*\s*\)\s*OVER\s*\(/i.test(trimmedSql)) {
                    const firstRow = dataArray[0];
                    // Tìm alias sau COUNT(*) OVER(...) [AS] aliasName
                    const matchAlias = trimmedSql.match(/COUNT\s*\(\s*\*\s*\)\s*OVER\s*\([^)]*\)\s*(?:AS\s+)?([a-zA-Z0-9_#$]+)/i);
                    const aliasName = matchAlias ? matchAlias[1] : null;

                    if (aliasName) {
                        for (const key of Object.keys(firstRow)) {
                            if (key.toUpperCase() === aliasName.toUpperCase()) {
                                const val = parseInt(firstRow[key]);
                                if (!isNaN(val) && val > 0) {
                                    extractedTotal = val;
                                    break;
                                }
                            }
                        }
                    }
                    if (extractedTotal === null) {
                        for (const key of Object.keys(firstRow)) {
                            const upperKey = key.toUpperCase();
                            if (upperKey === 'TOTAL' || upperKey === 'TOTAL_ROWS' || upperKey === 'TOTALROWS') {
                                const val = parseInt(firstRow[key]);
                                if (!isNaN(val) && val > 0) {
                                    extractedTotal = val;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (extractedTotal !== null) {
                    totalRows = extractedTotal;
                    console.log(`[BACKEND] Trích xuất totalRows trực tiếp từ COUNT(*) OVER(): ${totalRows}`);
                } else if (syncCount) {
                    const countRes = await handleSqlCount(trimmedSql, siteKey, uuid, currentLink);
                    if (countRes && countRes.success) {
                        totalRows = countRes.totalRows;
                    } else {
                        totalRows = null;
                    }
                } else {
                    // finalData.length === pageSize: Trả về null để UI hiển thị dữ liệu ngay lập tức, đếm ngầm sau
                    totalRows = null;
                }
            }
        }

        console.log(`[BACKEND] Trả về: ${dataArray.length} rows, pageSize=${pageSize}, totalRows=${totalRows}`);
        await logDebug("SQL_EXEC_DONE", `Success: true, Data isArray: ${Array.isArray(finalData)}, length: ${dataArray.length}, totalRows: ${totalRows}`);

        return {
            success: true,
            data: dataArray,
            page: page,
            pageSize: pageSize,
            totalRows: totalRows,
            isProcedure: isProcedure
        };

    } catch (err) {
        console.error("Execution Error:", err);
        await logDebug("SQL_EXEC_ERR", `Error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

async function handleSqlCount(sql, siteKey, passedUuid = null, passedLink = null) {
    const currentLink = passedLink || LinkServices[siteKey];
    if (!currentLink) {
        return { success: false, error: `Không tìm thấy LinkServices cho ${siteKey}` };
    }

    try {
        let uuid = passedUuid;
        if (!uuid) {
            let user = await getCachedUser(siteKey);
            if (!user) {
                const loginSuccess = await loginSite(siteKey);
                if (!loginSuccess) {
                    return { success: false, error: `Đăng nhập ${siteKey} thất bại.` };
                }
                user = await getCachedUser(siteKey);
            }
            uuid = user.UUID;
        }

        let trimmedSql = sql.trim();
        while (trimmedSql.endsWith(';')) {
            trimmedSql = trimmedSql.slice(0, -1).trim();
        }

        let countPayload = {
            func: "ajaxCALL_SP_O",
            uuid: uuid,
            params: ["S.KQDICHVU.HYN3", `$\n\nSELECT COUNT(*) as TOTAL FROM (${trimmedSql})\n$`, 0]
        };

        console.log(`[BACKEND] Bắt đầu thực thi count SQL...`);
        let countRes = await sendRequest(countPayload, currentLink);

        if (isSessionExpired(countRes)) {
            console.log(`[BACKEND] Session expired for count query. Retrying...`);
            if (uuid) invalidTokens.add(uuid);
            await setCachedUser(siteKey, null);
            const loginSuccess = await loginSite(siteKey);
            if (loginSuccess) {
                let user = await getCachedUser(siteKey);
                uuid = user.UUID;
                countPayload.uuid = uuid;
                countRes = await sendRequest(countPayload, currentLink);
            }
        }

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
        return { success: true, totalRows: totalRows };
    } catch (err) {
        console.error("Count Error:", err);
        return { success: false, error: err.message };
    }
}

async function handleRenderJasper(request) {
    const urls = [
        "http://127.0.0.1:8080/fill",
        "http://localhost:8080/fill"
    ];
    let lastErr = null;
    for (const url of urls) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
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
            const bytes = new Uint8Array(buffer);
            return { success: true, pdfBytes: Array.from(bytes) };
        } catch (err) {
            lastErr = err;
        }
    }
    throw (lastErr || new Error("Không thể kết xuất PDF qua Jasper Helper"));
}

async function handleQueryPaging(request) {
    const siteKey = request.siteKey || 'hung_yen';
    const currentLink = LinkServices[siteKey];
    if (!currentLink) {
        return { success: false, error: "Missing link service" };
    }

    let user = await getCachedUser(siteKey);
    if (!user) {
        const loginSuccess = await loginSite(siteKey);
        if (!loginSuccess) {
            return { success: false, error: "Login failed" };
        }
        user = await getCachedUser(siteKey);
    }

    let uuid = request.uuid || user.UUID;
    const payload = {
        func: "ajaxExecuteQueryPaging",
        uuid: uuid,
        params: request.params || [],
        options: request.options || [],
        _search: request._search || "false",
        nd: Date.now(),
        rows: request.rows || "20",
        page: request.page || "1",
        sidx: request.sidx || "",
        sord: request.sord || "asc",
        filters: request.filters || ""
    };

    let response = await sendRequest(payload, currentLink);

    if (isSessionExpired(response)) {
        if (uuid) invalidTokens.add(uuid);
        await setCachedUser(siteKey, null);
        const loginSuccess = await loginSite(siteKey);
        if (loginSuccess) {
            user = await getCachedUser(siteKey);
            payload.uuid = user.UUID;
            response = await sendRequest(payload, currentLink);
        } else {
            return { success: false, error: "Session expired and relogin failed" };
        }
    }

    return { success: true, data: response };
}

