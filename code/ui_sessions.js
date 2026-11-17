/*
 * ui_sessions.js - Quản lý phiên làm việc (Sessions).
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
function initSessionManager() {
	updateSessionBadge();
}

function updateSessionBadge() {
	const currentList = (sessionsBySite && sessionsBySite[currentSiteKey]) ? sessionsBySite[currentSiteKey] : [];
	const count = currentList.length;
	const badge = document.getElementById('sessionBadgeCount');
	if (badge) {
		badge.innerText = count;
	}
	const sidebarBadge = document.getElementById('sidebarSessionBadgeCount');
	if (sidebarBadge) {
		sidebarBadge.innerText = count;
	}
}

function renderSessionTabs() {
    const container = document.getElementById('sessionTabsContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!sessionsBySite[currentSiteKey] || sessionsBySite[currentSiteKey].length === 0) {
        const defaultTab = {
            id: 'tab_' + Date.now(),
            name: 'Query 1',
            sql: '',
            data: [],
            currentPage: 1,
            totalRows: 0,
            lastSql: '',
            statusText: '',
            siteKey: currentSiteKey
        };
        const defaultSess = {
            id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: 'Phiên chính',
            tabs: (tabsBySite[currentSiteKey] && tabsBySite[currentSiteKey].length > 0) ? tabsBySite[currentSiteKey] : [defaultTab],
            activeTabId: null,
            createdAt: new Date().toLocaleString('vi-VN'),
            updatedAt: new Date().toLocaleString('vi-VN')
        };
        defaultSess.activeTabId = defaultSess.tabs[0].id;
        sessionsBySite[currentSiteKey] = [defaultSess];
        currentSessionId = defaultSess.id;
        currentSessionIdBySite[currentSiteKey] = defaultSess.id;
    }

    const currentSessList = sessionsBySite[currentSiteKey];
    if (!currentSessionId || !currentSessList.some(s => s.id === currentSessionId)) {
        currentSessionId = currentSessList[0].id;
        currentSessionIdBySite[currentSiteKey] = currentSessionId;
    }

    currentSessList.forEach((sess, idx) => {
        const tabCount = sess.tabs ? sess.tabs.length : 0;
        const isActive = sess.id === currentSessionId;

        const sessionEl = document.createElement('div');
        sessionEl.className = `session-tab ${isActive ? 'active' : ''}`;
        sessionEl.setAttribute('data-id', sess.id);
        sessionEl.title = `Phiên: ${sess.name} (${tabCount} tab) - Nhấp đúp để đổi tên`;

        sessionEl.innerHTML = `
            <span class="session-tab-name">${escapeHtml(sess.name || ('Phiên ' + (idx + 1)))}</span>
            <span class="session-tab-badge" title="${tabCount} tab con">${tabCount}</span>
            <span class="session-tab-rename-btn" title="Đổi tên phiên" data-id="${sess.id}">✏️</span>
            <span class="session-tab-close-btn" title="Đóng/Xóa phiên này" data-id="${sess.id}">×</span>
        `;

        // Click chuyển phiên
        sessionEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('session-tab-rename-btn') || e.target.classList.contains('session-tab-close-btn')) {
                return;
            }
            if (sess.id !== currentSessionId) {
                switchSession(sess.id);
            }
        });

        // Double click để đổi tên nhanh
        sessionEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            renameSession(sess.id);
        });

        // Nút đổi tên
        sessionEl.querySelector('.session-tab-rename-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            renameSession(sess.id);
        });

        // Nút xóa phiên
        sessionEl.querySelector('.session-tab-close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSession(sess.id);
        });

        container.appendChild(sessionEl);
    });

    updateSessionBadge();
}

function switchSession(newSessionId) {
    if (!sessionsBySite[currentSiteKey]) return;
    const targetSess = sessionsBySite[currentSiteKey].find(s => s.id === newSessionId);
    if (!targetSess) return;

    // 1. Lưu lại trạng thái tab hiện tại của phiên cũ
    const oldTab = getCurrentTab();
    if (oldTab && editor) {
        tabViewStates[oldTab.id] = editor.saveViewState();
        oldTab.sql = editor.getValue();
    }
    // Chỉ lưu vào phiên CHÍNH XÁC đang mở của site hiện tại. Không dùng getCurrentSession() vì nó tự
    // lùi về phiên đầu tiên khi id không thuộc site này (vừa đổi site) → ghi đè tab của phiên đó bằng danh sách rỗng.
    const currentSess = sessionsBySite[currentSiteKey].find(x => x.id === currentSessionId);
    if (currentSess) {
        currentSess.tabs = tabsBySite[currentSiteKey];
        currentSess.activeTabId = currentTabId;
        currentSess.updatedAt = new Date().toLocaleString('vi-VN');
    }

    // 2. Chuyển sang phiên mới
    currentSessionId = newSessionId;
    currentSessionIdBySite[currentSiteKey] = newSessionId;
    tabsBySite[currentSiteKey] = targetSess.tabs || [];

    // Nếu phiên mới chưa có tab nào thì khởi tạo 1 tab
    if (tabsBySite[currentSiteKey].length === 0) {
        const firstTab = {
            id: 'tab_' + Date.now(),
            name: 'Query 1',
            sql: '',
            data: [],
            currentPage: 1,
            totalRows: 0,
            lastSql: '',
            statusText: '',
            siteKey: currentSiteKey
        };
        tabsBySite[currentSiteKey] = [firstTab];
        targetSess.tabs = tabsBySite[currentSiteKey];
        targetSess.activeTabId = firstTab.id;
    }

    // 3. Render lại session tabs và tab con
    renderSessionTabs();
    renderTabs();

    // 4. Kích hoạt tab con trong phiên mới
    let activeTabToSwitch = targetSess.activeTabId;
    if (!activeTabToSwitch || !tabsBySite[currentSiteKey].some(t => t.id === activeTabToSwitch)) {
        activeTabToSwitch = tabsBySite[currentSiteKey][0].id;
    }
    switchTab(activeTabToSwitch);

    // 5. Lưu trạng thái
    saveTabs();
}

function addNewSession(customName) {
    if (!sessionsBySite[currentSiteKey]) sessionsBySite[currentSiteKey] = [];
    const count = sessionsBySite[currentSiteKey].length;

    const doCreate = (name) => {
        const newTab = {
            id: 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: 'Query 1',
            sql: '',
            data: [],
            currentPage: 1,
            totalRows: 0,
            lastSql: '',
            statusText: '',
            siteKey: currentSiteKey
        };

        const newSession = {
            id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: name || `Phiên ${count + 1}`,
            tabs: [newTab],
            activeTabId: newTab.id,
            createdAt: new Date().toLocaleString('vi-VN'),
            updatedAt: new Date().toLocaleString('vi-VN')
        };

        // Lưu lại phiên hiện tại trước khi switch
        const oldTab = getCurrentTab();
        if (oldTab && editor) {
            tabViewStates[oldTab.id] = editor.saveViewState();
            oldTab.sql = editor.getValue();
        }
        const currentSess = getCurrentSession();
        if (currentSess) {
            currentSess.tabs = tabsBySite[currentSiteKey];
            currentSess.activeTabId = currentTabId;
        }

        sessionsBySite[currentSiteKey].push(newSession);
        switchSession(newSession.id);

        writeOperationLog("ADD_SESSION", `Tạo phiên mới: ${newSession.name}`);
    };

    if (customName) {
        doCreate(customName);
    } else {
        Swal.fire({
            title: 'Tạo Phiên Làm Việc Mới',
            input: 'text',
            inputLabel: 'Tên phiên làm việc:',
            inputValue: `Phiên ${count + 1}`,
            showCancelButton: true,
            confirmButtonText: 'Tạo Phiên',
            cancelButtonText: 'Hủy',
            inputValidator: (val) => {
                if (!val || !val.trim()) return 'Vui lòng nhập tên phiên!';
            }
        }).then(res => {
            if (res.isConfirmed && res.value) {
                doCreate(res.value.trim());
            }
        });
    }
}

function renameSession(sessionId) {
    if (!sessionsBySite[currentSiteKey]) return;
    const sess = sessionsBySite[currentSiteKey].find(s => s.id === sessionId);
    if (!sess) return;

    Swal.fire({
        title: 'Đổi Tên Phiên Làm Việc',
        input: 'text',
        inputValue: sess.name,
        showCancelButton: true,
        confirmButtonText: 'Cập Nhật',
        cancelButtonText: 'Hủy',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'Tên phiên không được để trống!';
            }
        }
    }).then(res => {
        if (res.isConfirmed && res.value) {
            const oldName = sess.name;
            sess.name = res.value.trim();
            sess.updatedAt = new Date().toLocaleString('vi-VN');
            renderSessionTabs();
            saveTabs();
            renderSessionList();
            writeOperationLog("RENAME_SESSION", `Đổi tên phiên từ "${oldName}" sang "${sess.name}"`);
        }
    });
}

function deleteSession(sessionId) {
    if (!sessionsBySite[currentSiteKey]) return;
    const list = sessionsBySite[currentSiteKey];
    if (list.length <= 1) {
        Swal.fire({
            icon: 'warning',
            title: 'Thông báo',
            text: 'Phải giữ ít nhất 1 phiên làm việc!'
        });
        return;
    }

    const sess = list.find(s => s.id === sessionId);
    if (!sess) return;

    const tabCount = sess.tabs ? sess.tabs.length : 0;

    Swal.fire({
        title: 'Xác nhận xóa phiên?',
        html: `Bạn có chắc chắn muốn xóa phiên <b>"${escapeHtml(sess.name)}"</b> gồm <b>${tabCount}</b> tab con bên trong?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Xóa Phiên',
        cancelButtonText: 'Hủy'
    }).then(res => {
        if (res.isConfirmed) {
            const index = list.findIndex(s => s.id === sessionId);
            if (sess.tabs) {
                sess.tabs.forEach(t => {
                    if (tabModels[t.id]) {
                        tabModels[t.id].dispose();
                        delete tabModels[t.id];
                    }
                    if (tabViewStates[t.id]) {
                        delete tabViewStates[t.id];
                    }
                });
            }

            sessionsBySite[currentSiteKey] = list.filter(s => s.id !== sessionId);

            writeOperationLog("DELETE_SESSION", `Xóa phiên: ${sess.name} (${tabCount} tabs)`);

            if (currentSessionId === sessionId) {
                let nextIndex = index;
                if (nextIndex >= sessionsBySite[currentSiteKey].length) {
                    nextIndex = sessionsBySite[currentSiteKey].length - 1;
                }
                const nextSess = sessionsBySite[currentSiteKey][nextIndex];
                switchSession(nextSess.id);
            } else {
                renderSessionTabs();
                saveTabs();
            }
            renderSessionList();
        }
    });
}

function duplicateSession(sessionId) {
    if (!sessionsBySite[currentSiteKey]) return;
    const sess = sessionsBySite[currentSiteKey].find(s => s.id === sessionId);
    if (!sess) return;

    const duplicatedTabs = JSON.parse(JSON.stringify(sess.tabs || [])).map(t => {
        t.id = 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        return t;
    });

    const newSess = {
        id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: `${sess.name} (Bản sao)`,
        tabs: duplicatedTabs,
        activeTabId: duplicatedTabs[0] ? duplicatedTabs[0].id : null,
        createdAt: new Date().toLocaleString('vi-VN'),
        updatedAt: new Date().toLocaleString('vi-VN')
    };

    sessionsBySite[currentSiteKey].push(newSess);
    switchSession(newSess.id);
    renderSessionList();

    Swal.fire({
        icon: 'success',
        title: 'Đã nhân bản phiên!',
        text: `Phiên "${newSess.name}" (${newSess.tabs.length} tab) đã được tạo.`,
        timer: 1500,
        showConfirmButton: false
    });
}

function openSessionManagerModal() {
	renderSessionList();
	showModal('sessionManagerModal');
}

function renderSessionList(filterText = '') {
	const body = document.getElementById('sessionListBody');
	const summary = document.getElementById('sessionListSummary');
	if (!body) return;

    const currentList = (sessionsBySite && sessionsBySite[currentSiteKey]) ? sessionsBySite[currentSiteKey] : [];

	const filter = (filterText || '').toLowerCase().trim();
	const filtered = currentList.filter(s => {
		if (!filter) return true;
		return (s.name || '').toLowerCase().includes(filter);
	});

	if (summary) {
		summary.innerText = `${currentList.length} phiên làm việc của phân hệ hiện tại (${currentSiteKey === 'thai_binh' ? 'Thái Bình' : 'Hưng Yên'})`;
	}

	if (filtered.length === 0) {
		body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Chưa có phiên làm việc nào</td></tr>`;
		return;
	}

	let html = '';
	filtered.forEach((sess, idx) => {
		const tabNames = (sess.tabs || []).map(t => t.name).slice(0, 4);
		let tabBadges = tabNames.map(n => `<span class="badge bg-light text-dark border me-1 mb-1 font-monospace" style="font-size: 11px;">${escapeHtml(n)}</span>`).join('');
		if ((sess.tabs || []).length > 4) {
			tabBadges += `<span class="badge bg-secondary font-monospace" style="font-size: 10px;">+${(sess.tabs || []).length - 4} tab</span>`;
		}

		const isCurrentActive = sess.id === currentSessionId;
		const activeBadge = isCurrentActive 
			? '<span class="badge bg-success ms-1">Đang mở</span>' 
			: '';

		html += `
			<tr class="${isCurrentActive ? 'table-primary bg-opacity-10' : ''}">
				<td class="text-center fw-bold">${idx + 1}</td>
				<td>
					<span class="fw-bold ${isCurrentActive ? 'text-primary' : 'text-dark'}">${escapeHtml(sess.name)}</span>
					${activeBadge}
				</td>
				<td class="text-center"><span class="badge bg-secondary font-monospace">${sess.tabs ? sess.tabs.length : 0} tab</span></td>
				<td class="small text-muted">${sess.updatedAt || sess.createdAt || '-'}</td>
				<td><div class="d-flex flex-wrap">${tabBadges}</div></td>
				<td class="text-center">
					<div class="btn-group btn-group-sm" role="group">
						<button class="btn btn-outline-primary btn-switch-sess py-0 px-2 fw-semibold" data-id="${sess.id}" title="Chuyển đến phiên này">🚀 Mở</button>
						<button class="btn btn-outline-secondary btn-rename-sess py-0 px-2" data-id="${sess.id}" title="Đổi tên phiên">✏️ Đổi tên</button>
						<button class="btn btn-outline-success btn-dup-sess py-0 px-2" data-id="${sess.id}" title="Nhân bản phiên này">📋 Sao chép</button>
						<button class="btn btn-outline-danger btn-delete-sess py-0 px-2" data-id="${sess.id}" title="Xóa phiên này">🗑️ Xóa</button>
					</div>
				</td>
			</tr>
		`;
	});
	body.innerHTML = html;

	body.querySelectorAll('.btn-switch-sess').forEach(btn => {
		btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-id');
            switchSession(sid);
            hideModal('sessionManagerModal');
        });
	});
	body.querySelectorAll('.btn-rename-sess').forEach(btn => {
		btn.addEventListener('click', () => renameSession(btn.getAttribute('data-id')));
	});
	body.querySelectorAll('.btn-dup-sess').forEach(btn => {
		btn.addEventListener('click', () => duplicateSession(btn.getAttribute('data-id')));
	});
	body.querySelectorAll('.btn-delete-sess').forEach(btn => {
		btn.addEventListener('click', () => deleteSession(btn.getAttribute('data-id')));
	});
}

function promptSaveCurrentSession() {
    addNewSession();
}


/* ==========================================================================
   TAB-SPECIFIC LAYOUT STATE MANAGER
   ========================================================================== */
function applyTabLayoutState(tab) {
    const editorWrapper = document.getElementById('editor-wrapper');
    const gridContainer = document.getElementById('gridWrapper');
    if (!editorWrapper || !gridContainer) return;

    const state = (tab && tab.layoutState) ? tab.layoutState : 'default';

    if (state === 'full_sql') {
        if (!originalEditorHeight) originalEditorHeight = editorWrapper.style.height || '40%';
        editorWrapper.style.height = 'calc(100% - 130px)';
        gridContainer.style.display = 'none';
    } else if (state === 'full_grid') {
        if (!originalEditorHeight) originalEditorHeight = editorWrapper.style.height || '40%';
        editorWrapper.style.height = '140px';
        gridContainer.style.display = 'block';
        gridContainer.style.flexGrow = '1';
    } else {
        // 'default'
        if (tab && tab.customEditorHeight) {
            editorWrapper.style.height = tab.customEditorHeight;
        } else if (originalEditorHeight) {
            editorWrapper.style.height = originalEditorHeight;
        } else {
            editorWrapper.style.height = '40%';
        }
        gridContainer.style.display = 'block';
        gridContainer.style.flexGrow = '1';
    }

    const btnSql = document.getElementById('btnFullSQL');
    const btnGrid = document.getElementById('btnFullGrid');
    const btnReset = document.getElementById('btnResetLayout');
    if (btnSql) btnSql.classList.toggle('active', state === 'full_sql');
    if (btnGrid) btnGrid.classList.toggle('active', state === 'full_grid');
    if (btnReset) btnReset.classList.toggle('active', state === 'default');

    if (editor) {
        setTimeout(() => editor.layout(), 30);
    }
}

/* ==========================================================================
   SESSION TAB BAR VISIBILITY TOGGLE
   ========================================================================== */
function toggleSessionBar(forceVisible) {
    if (typeof forceVisible === 'boolean') {
        isSessionBarVisible = forceVisible;
    } else {
        isSessionBarVisible = !isSessionBarVisible;
    }

    const bar = document.getElementById('sessionTabBar');
    if (bar) {
        bar.style.display = isSessionBarVisible ? 'flex' : 'none';
    }

    const toggleBtn = document.getElementById('btnToggleSessionBar');
    if (toggleBtn) {
        if (isSessionBarVisible) {
            toggleBtn.title = 'Ẩn dòng các tab Phiên làm việc';
            toggleBtn.classList.remove('btn-primary');
            toggleBtn.classList.add('btn-outline-secondary');
        } else {
            toggleBtn.title = 'Hiện dòng các tab Phiên làm việc';
            toggleBtn.classList.add('btn-primary');
            toggleBtn.classList.remove('btn-outline-secondary');
        }
    }

    const sidebarText = document.getElementById('sidebarSessionToggleText');
    if (sidebarText) {
        sidebarText.innerText = isSessionBarVisible ? 'Ẩn Tab Phiên' : 'Hiện Tab Phiên';
    }

    try {
        localStorage.setItem('sessionBarVisible', isSessionBarVisible ? '1' : '0');
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ sessionBarVisible: isSessionBarVisible });
        }
    } catch (e) {
        console.warn('Cannot persist sessionBarVisible', e);
    }

    if (editor) {
        setTimeout(() => editor.layout(), 30);
    }
}

function initSessionBarToggle() {
    const btnHide = document.getElementById('btnHideSessionBar');
    if (btnHide) {
        btnHide.addEventListener('click', () => toggleSessionBar(false));
    }
    const btnToggle = document.getElementById('btnToggleSessionBar');
    if (btnToggle) {
        btnToggle.addEventListener('click', () => toggleSessionBar());
    }
    const btnToggleSidebar = document.getElementById('btnToggleSessionBarSidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => toggleSessionBar());
    }
}

/* ==========================================================================
   GLOBAL SEARCH TEXT (PHIÊN & TAB)
   ========================================================================== */
