
(function () {
    'use strict';

    const TARGET_FUNC = '../danhmuc/UTILS_PE_TLEE';

    function traceDebug(msg) {
        console.log(`[VNPT_HIS_AUTO] ${msg}`);
    }

    async function clearAndTypeInput(input, text) {
        if (!input) return false;
        input.focus();
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
        });
        input.dispatchEvent(enterEvent);
        return true;
    }

    function isTargetPage() {
        return window.location.href.includes(`func=${TARGET_FUNC}`);
    }

    async function clickMatchingResult(query) {
        traceDebug(`Searching for result matching: ${query}`);
        const normalizedQuery = query.trim().toUpperCase();

        for (let i = 0; i < 40; i++) {
            const items = document.querySelectorAll('.procedure_item, .function_item, a[data-vl]');
            for (const item of items) {
                const val = (item.getAttribute('data-vl') || '').trim().toUpperCase();
                const text = (item.textContent || '').trim().toUpperCase();

                if (val === normalizedQuery || text === normalizedQuery || text.endsWith(normalizedQuery)) {
                    traceDebug(`Found matching item: ${text}. Clicking...`);
                    item.click();
                    return true;
                }
            }
            await new Promise(r => setTimeout(r, 250));
        }
        traceDebug(`No matching result found for: ${query} after 10 seconds.`);
        return false;
    }

    async function autoSearchOnTargetPage() {
        if (!isTargetPage()) return;

        const hash = window.location.hash;
        if (!hash.startsWith('#search=')) return;

        const query = decodeURIComponent(hash.replace('#search=', ''));
        traceDebug(`Detect search query: ${query}`);

        let input = null;
        for (let i = 0; i < 40; i++) {
            input = document.getElementById('txtSEARCHOBJECT');
            if (input) break;
            await new Promise(r => setTimeout(r, 250));
        }

        if (input) {
            traceDebug('Found txtSEARCHOBJECT, typing keyword...');
            await new Promise(r => setTimeout(r, 500)); 
            await clearAndTypeInput(input, query);

            await new Promise(r => setTimeout(r, 800));
            await clickMatchingResult(query);

            history.replaceState(null, null, window.location.pathname + window.location.search);
        } else {
            traceDebug('Could not find txtSEARCHOBJECT element after 10 seconds.');
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "save_backup") {
            try {
                localStorage.setItem('his_sql_tool_backup', JSON.stringify(request.data));
                traceDebug("Backup saved to localStorage.");
                sendResponse({ success: true });
            } catch (e) {
                console.error("[VNPT_HIS_AUTO] Failed to save backup:", e);
                sendResponse({ success: false, error: e.message });
            }
            return true;
        }

        if (request.action === "get_backup") {
            try {
                const backupStr = localStorage.getItem('his_sql_tool_backup');
                if (backupStr) {
                    sendResponse({ success: true, data: JSON.parse(backupStr) });
                } else {
                    sendResponse({ success: false, error: "No backup found" });
                }
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
            return true;
        }

    });

    function checkAndRestore() {
        try {
            const backupStr = localStorage.getItem('his_sql_tool_backup');
            if (backupStr) {
                const backup = JSON.parse(backupStr);
                chrome.runtime.sendMessage({ action: "check_and_restore_tabs", backup: backup });
            }
        } catch (e) {
            console.error("[VNPT_HIS_AUTO] Failed to restore backup:", e);
        }
        try {
            const jwtRegex = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
            let token = null;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key === 'his_sql_tool_backup') continue;
                const val = localStorage.getItem(key);
                if (val) {
                    const match = val.match(jwtRegex);
                    if (match) {
                        token = match[0];
                        break;
                    }
                }
            }
            if (!token) {
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key === 'his_sql_tool_backup') continue;
                    const val = sessionStorage.getItem(key);
                    if (val) {
                        const match = val.match(jwtRegex);
                        if (match) {
                            token = match[0];
                            break;
                        }
                    }
                }
            }
            // Da loai bo dong bo session trinh duyet, background tu dong xac thuc doc lap
        } catch (e) {
            console.error("[VNPT_HIS_AUTO] Failed:", e);
        }
    }

    function init() {
        if (document.body && document.head) {
            autoSearchOnTargetPage();
            checkAndRestore();
        } else {
            setTimeout(init, 200);
        }
    }

    init();
})();
