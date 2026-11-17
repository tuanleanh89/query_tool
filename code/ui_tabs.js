/*
 * ui_tabs.js - Quản lý tab truy vấn và lưu trữ (saveTabs).
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
function getCurrentSession() {
    if (!sessionsBySite[currentSiteKey]) sessionsBySite[currentSiteKey] = [];
    let sess = sessionsBySite[currentSiteKey].find(s => s.id === currentSessionId);
    if (!sess && sessionsBySite[currentSiteKey].length > 0) {
        sess = sessionsBySite[currentSiteKey][0];
        currentSessionId = sess.id;
        currentSessionIdBySite[currentSiteKey] = sess.id;
    }
    return sess;
}

function getCurrentTab() {
	if (!tabsBySite) return null;
	const list = tabsBySite[currentSiteKey] || [];
	return list.find(t => t.id === currentTabId);
}

function renderTabs() {
    const container = document.getElementById('tabsContainer');
    if (!container) return;
    container.innerHTML = '';

    const currentTabs = tabsBySite[currentSiteKey] || [];

    // Cập nhật tabs vào currentSession và cập nhật badge số tab trên Tab To
    const curSess = getCurrentSession();
    if (curSess) {
        curSess.tabs = currentTabs;
    }
    if (currentSessionId) {
        const badgeEl = document.querySelector(`.session-tab[data-id="${currentSessionId}"] .session-tab-badge`);
        if (badgeEl) {
            badgeEl.innerText = currentTabs.length;
            badgeEl.title = `${currentTabs.length} tab con`;
        }
    }

    currentTabs.forEach((tab, index) => {
        const tabEl = document.createElement('div');
        const isRunTab = (tab.name || '').startsWith('Run:');
        tabEl.className = `tab ${tab.id === currentTabId ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${isRunTab ? 'run-tab' : ''} ${tab.isProcFunc ? 'proc-func-tab' : ''}`;
        tabEl.setAttribute('draggable', 'true');
        tabEl.setAttribute('data-id', tab.id);
        tabEl.setAttribute('data-index', index);

        tabEl.innerHTML = `
            <span class="tab-name" title="${escapeHtml(tab.name)}">${escapeHtml(tab.name)}</span>
            <span class="pin-tab" data-id="${tab.id}" title="${tab.pinned ? 'Bỏ ghim tab' : 'Ghim tab lên đầu'}">📌</span>
            <span class="close-tab" data-id="${tab.id}">×</span>
        `;

        tabEl.addEventListener('click', (e) => {
            if (!e.target.classList.contains('close-tab') && !e.target.classList.contains('pin-tab')) {
                switchTab(tab.id);
            }
        });

        tabEl.querySelector('.close-tab').addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });

        tabEl.querySelector('.pin-tab').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePinTab(tab.id);
        });

        tabEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', tab.id);
            tabEl.classList.add('dragging');
        });

        tabEl.addEventListener('dragend', () => {
            tabEl.classList.remove('dragging');
        });

        tabEl.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        tabEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const sourceId = e.dataTransfer.getData('text/plain');
            const targetId = tab.id;
            if (sourceId === targetId) return;

            const list = tabsBySite[currentSiteKey];
            const sourceIndex = list.findIndex(t => t.id === sourceId);
            const targetIndex = list.findIndex(t => t.id === targetId);

            if (sourceIndex > -1 && targetIndex > -1) {
                const [draggedTab] = list.splice(sourceIndex, 1);
                list.splice(targetIndex, 0, draggedTab);

                renderTabs();
                saveTabs();
            }
        });

        container.appendChild(tabEl);
    });
}

function togglePinTab(tabId) {
    const siteTabs = tabsBySite[currentSiteKey];
    const tabIndex = siteTabs.findIndex(t => t.id === tabId);
    if (tabIndex !== -1) {
        const tab = siteTabs[tabIndex];
        tab.pinned = !tab.pinned;

        const pinned = siteTabs.filter(t => t.pinned);
        const unpinned = siteTabs.filter(t => !t.pinned);
        tabsBySite[currentSiteKey] = [...pinned, ...unpinned];

        renderTabs();
        saveTabs();
    }
}

function addNewTab() {
    const newTab = {
        id: 'tab_' + Date.now(),
        name: `Query ${(tabsBySite[currentSiteKey] || []).length + 1}`,
        sql: '',
        data: [],
        currentPage: 1,
        totalRows: 0,
        lastSql: '',
        statusText: '',
        siteKey: currentSiteKey
    };
    if (!tabsBySite[currentSiteKey]) tabsBySite[currentSiteKey] = [];
    tabsBySite[currentSiteKey].push(newTab);
    renderTabs();
    switchTab(newTab.id);
    saveTabs();
}

function switchTab(tabId) {
    const oldTab = getCurrentTab();
    if (oldTab && editor) {
        tabViewStates[oldTab.id] = editor.saveViewState();
        oldTab.sql = editor.getValue();
    }

    currentTabId = tabId;
    const tab = getCurrentTab();
    if (!tab) return;

    // Cập nhật activeTabId trong phiên hiện tại
    const curSess = getCurrentSession();
    if (curSess) {
        curSess.activeTabId = tabId;
    }

    const runBtn = document.getElementById('btnRunProcFunc');
    if (runBtn) {
        if (tab.objectType) {
            runBtn.style.display = 'inline-block';
        } else {
            runBtn.style.display = 'none';
        }
    }

    if (editor) {
        if (!tabModels[tab.id]) {
            tabModels[tab.id] = monaco.editor.createModel(tab.sql || '', 'sql');
        }
        editor.setModel(tabModels[tab.id]);
        if (tabViewStates[tab.id]) {
            editor.restoreViewState(tabViewStates[tab.id]);
        }
        editor.focus();
    }

    currentData = tab.data || [];
    currentPage = tab.currentPage || 1;
    totalRows = tab.totalRows || 0;
    lastSql = tab.lastSql || '';

    const statusEl = document.getElementById('status');
    const statusText = tab.statusText || '';
    statusEl.innerText = statusText;
    statusEl.className = statusText.includes('✅') ? "text-success" :
        statusText.includes('❌') ? "text-danger" : "text-secondary";

    const executionTimeEl = document.getElementById('executionTime');
    if (executionTimeEl) {
        executionTimeEl.innerText = tab.executionTimeText || '';
        executionTimeEl.className = tab.executionTimeIsError ? "text-danger small fw-bold ms-auto" : "text-secondary small fw-bold ms-auto";
    }

    renderTable(currentData);
    updatePaginationUI();
    renderTabs();
    applyTabLayoutState(tab);
}

async function closeTab(tabId, skipConfirm = false) {
	if (tabsBySite[currentSiteKey].length === 1) {
		Swal.fire({
			icon: 'warning',
			title: 'Thông báo',
			text: 'Phải giữ ít nhất 1 tab trong phiên này!'
		});
		return;
	}
	let shouldClose = skipConfirm;
	if (!shouldClose) {
		const result = await Swal.fire({
			title: 'Xác nhận',
			text: 'Bạn có chắc chắn muốn đóng tab này?',
			icon: 'question',
			showCancelButton: true,
			confirmButtonText: 'Đồng ý',
			cancelButtonText: 'Hủy'
		});
		shouldClose = result.isConfirmed;
	}
	if (shouldClose) {
		const originalIndex = tabsBySite[currentSiteKey].findIndex(t => t.id === tabId);

        tabsBySite[currentSiteKey] = tabsBySite[currentSiteKey].filter(t => t.id !== tabId);

        if (tabModels[tabId]) {
            tabModels[tabId].dispose();
            delete tabModels[tabId];
        }
        if (tabViewStates[tabId]) {
            delete tabViewStates[tabId];
        }

        if (currentTabId === tabId && tabsBySite[currentSiteKey].length > 0) {
            let nextIndex = originalIndex;
            if (nextIndex >= tabsBySite[currentSiteKey].length) {
                nextIndex = tabsBySite[currentSiteKey].length - 1;
            }
            if (nextIndex < 0) nextIndex = 0;
            switchTab(tabsBySite[currentSiteKey][nextIndex].id);
        } else {
            renderTabs();
        }
        saveTabs();
    }
}

function prepareTabsForStorage(tabsList) {
    if (!Array.isArray(tabsList)) return [];
    return tabsList.map(t => {
        const copy = { ...t };
        // Giới hạn dữ liệu lưu tạm trong storage tối đa 50 dòng để không làm tràn quota
        if (Array.isArray(copy.data) && copy.data.length > 50) {
            copy.data = copy.data.slice(0, 50);
        }
        return copy;
    });
}

function prepareSessionsForStorage(sessionsObj) {
    if (!sessionsObj || typeof sessionsObj !== 'object') return sessionsObj;
    const cleanSessions = {};
    for (const site of Object.keys(sessionsObj)) {
        if (!Array.isArray(sessionsObj[site])) {
            cleanSessions[site] = [];
            continue;
        }
        cleanSessions[site] = sessionsObj[site].map(sess => {
            const sessCopy = { ...sess };
            if (Array.isArray(sessCopy.tabs)) {
                sessCopy.tabs = prepareTabsForStorage(sessCopy.tabs);
            }
            return sessCopy;
        });
    }
    return cleanSessions;
}

async function saveTabs() {
    if (!storageReady) return;
    try {
        const tab = getCurrentTab();
        if (tab && editor) {
            tab.sql = editor.getValue();
        }
        const currentSess = getCurrentSession();
        if (currentSess) {
            currentSess.tabs = tabsBySite[currentSiteKey];
            currentSess.activeTabId = currentTabId;
            currentSess.updatedAt = new Date().toLocaleString('vi-VN');
        }

        // Cập nhật badge số tab trên Tab To của phiên hiện tại
        if (currentSessionId && tabsBySite[currentSiteKey]) {
            const badgeEl = document.querySelector(`.session-tab[data-id="${currentSessionId}"] .session-tab-badge`);
            if (badgeEl) {
                badgeEl.innerText = tabsBySite[currentSiteKey].length;
                badgeEl.title = `${tabsBySite[currentSiteKey].length} tab con`;
            }
        }

        const storageSessions = prepareSessionsForStorage(sessionsBySite);
        mirrorSessionsToLocal(sessionsBySite);
        await chrome.storage.local.set({ 
            sessionsBySite: storageSessions,
            currentSessionIdBySite: currentSessionIdBySite,
            lastSiteKey: currentSiteKey
        });
        try {
            const nS = Object.values(sessionsBySite).reduce((a, l) => a + (l ? l.length : 0), 0);
            document.title = `Query Tool · đã lưu ${new Date().toLocaleTimeString('vi-VN')} (${nS} phiên)`;
        } catch (e) { /* chỉ để người dùng nhìn thấy đã lưu */ }

        // Broadcast backup chỉ gửi metadata (loại bỏ trường data lớn) để tránh lỗi quota trên web page
        const backupTabs = {};
        for (const s of ['hung_yen', 'thai_binh']) {
            backupTabs[s] = (tabsBySite[s] || []).map(t => {
                const { data, ...rest } = t;
                return rest;
            });
        }
        chrome.runtime.sendMessage({ action: "broadcast_backup", data: backupTabs });

    } catch (err) {
        console.warn("[STORAGE] Quota warning, tự động dọn dẹp bộ nhớ:", err);
        // Nếu dung lượng quá tải, dọn dẹp dữ liệu bảng tạm thời để bảo toàn câu lệnh SQL và phiên làm việc
        {   // Mọi lỗi lưu (không chỉ quota) đều thử lại bản rút gọn để không mất câu SQL/phiên
            try {
                const stripAllData = (tList) => (tList || []).map(t => {
                    const c = { ...t };
                    c.data = [];
                    return c;
                });
                const fallbackSessions = {};
                for (const site of Object.keys(sessionsBySite)) {
                    fallbackSessions[site] = (sessionsBySite[site] || []).map(sess => ({
                        ...sess,
                        tabs: stripAllData(sess.tabs)
                    }));
                }
                await chrome.storage.local.set({ 
                    sessionsBySite: fallbackSessions,
                    currentSessionIdBySite: currentSessionIdBySite,
                    lastSiteKey: currentSiteKey
                });
                console.log("[STORAGE] Đã dọn dẹp dữ liệu bảng tạm thời để giải phóng quota thành công.");
            } catch (e2) {
                console.error("[STORAGE] Lỗi nghiêm trọng khi lưu cấu trúc phiên:", e2);
            }
        }
    }
}



// Bản sao dự phòng (chỉ SQL + cấu trúc, không có dữ liệu bảng) trong localStorage của trang extension.
// Dùng để khôi phục nếu chrome.storage.local trống/lỗi khi mở lại.
function slimSessions(sessionsObj) {
    const out = {};
    for (const site of Object.keys(sessionsObj || {})) {
        out[site] = (sessionsObj[site] || []).map(sess => ({
            ...sess,
            tabs: (sess.tabs || []).map(t => ({ ...t, data: [] }))
        }));
    }
    return out;
}

function mirrorSessionsToLocal(sessionsObj) {
    try {
        localStorage.setItem('qt_sessions_backup', JSON.stringify({
            sessionsBySite: slimSessions(sessionsObj),
            currentSessionIdBySite,
            lastSiteKey: currentSiteKey,
            savedAt: Date.now()
        }));
    } catch (e) { /* localStorage đầy: bỏ qua, chrome.storage vẫn là bản chính */ }
}

function readLocalSessionsBackup() {
    try { return JSON.parse(localStorage.getItem('qt_sessions_backup') || 'null'); } catch (e) { return null; }
}
