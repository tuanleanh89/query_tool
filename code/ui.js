let currentData = [];
let lastSql = "";
let currentPage = 1;
let pageSize = 50;
let totalRows = 0;
let currentQueryId = 0;
let isCountingRows = false;
let editor;
let originalEditorHeight = null;
let isSessionBarVisible = true;

let currentSiteKey = 'hung_yen';
let tabsBySite = { hung_yen: [], thai_binh: [] };
let sessionsBySite = { hung_yen: [], thai_binh: [] };
let currentSessionId = null;
let currentSessionIdBySite = { hung_yen: null, thai_binh: null };
let currentTabId = null;
let isDarkMode = false;
let tabModels = {}; 
let tabViewStates = {}; 

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let uploadedJrxmlContent = "";
let parsedJasperParams = [];
let jasperPdfBlobUrl = null; 
let currentJrxmlName = "";
let triggerRunProcFunc = null;

function showLoading(message = "Đang xử lý, vui lòng đợi...") {
	const overlay = document.getElementById('loadingOverlay');
	const msgEl = document.getElementById('loadingMessage');
	if (overlay && msgEl) {
		msgEl.innerText = message;
		overlay.classList.remove('d-none');
	}
}

function hideLoading() {
	const overlay = document.getElementById('loadingOverlay');
	if (overlay) {
		overlay.classList.add('d-none');
	}
}

let sitesData = {};

document.addEventListener('DOMContentLoaded', () => {
	fetch(chrome.runtime.getURL("sites_data.json"))
		.then(r => r.json())
		.then(data => {
			for (const siteKey in data) {
				if (Array.isArray(data[siteKey])) {
					data[siteKey] = data[siteKey].map(item => {
						let name = '';
						for (const k of Object.keys(item)) {
							const cleanK = (typeof removeVietnameseTones === 'function' ? removeVietnameseTones(k) : k).toLowerCase();
							if (cleanK.includes('khach') || cleanK.includes('ten') || cleanK.includes('hang') || cleanK.includes('don vi')) {
								name = item[k];
								break;
							}
						}
						if (!name) name = item[Object.keys(item)[0]] || '';
						const csytid = String(item.CSYTID || item.csytid || item.id || '');
						const schema = item.Schema || item.schema || '';
						return { 
							'Kh\u00E1ch h\u00E0ng': name, 
							'Khach hang': name,
							'CSYTID': csytid, 
							'Schema': schema, 
							name, 
							csytid, 
							schema 
						};
					});
				}
			}
			sitesData = data;
			initUnitSearchDropdown();
			initSidebarUnitSearchDropdown();
		})
		.catch(err => {
			console.error("Failed to load sites data", err);
		});

	isDarkMode = false;
	document.body.classList.remove('dark-mode');
	chrome.storage.local.set({ darkMode: false });

	initMonacoEditor();
	initLayoutAndEvents();
	checkAndStartJasperHelperUI();
	initSavedTablesManager();
	initSessionManager();
	initSessionBarToggle();
	initGlobalSearchText();
	setTimeout(() => { checkAppUpdate(false); }, 3500);
});

async function initMonacoEditor() {
    require.config({ paths: { 'vs': './vs' } });

    require(['vs/editor/editor.main', './sql-formatter.min'], function (main, formatter) {
        window.mySqlFormatter = formatter;

        editor = monaco.editor.create(document.getElementById('editorContainer'), {
            value: '',
            language: 'sql',
            theme: 'vs',
            automaticLayout: true,
            fontSize: 14,
            lineNumbers: 'on',
            minimap: { enabled: true },
            wordWrap: 'on',
            folding: true,
            bracketPairColorization: true
        });

        chrome.storage.local.get(['sessionsBySite', 'tabsBySite', 'savedSessions', 'currentSessionIdBySite', 'sessionBarVisible'], (result) => {
            if (result.sessionBarVisible !== undefined) {
                toggleSessionBar(result.sessionBarVisible);
            } else {
                const localVis = localStorage.getItem('sessionBarVisible');
                if (localVis !== null) toggleSessionBar(localVis === '1');
            }
            sessionsBySite = result.sessionsBySite || { hung_yen: [], thai_binh: [] };
            if (!sessionsBySite.hung_yen) sessionsBySite.hung_yen = [];
            if (!sessionsBySite.thai_binh) sessionsBySite.thai_binh = [];
            currentSessionIdBySite = result.currentSessionIdBySite || { hung_yen: null, thai_binh: null };

            const oldSavedSessions = Array.isArray(result.savedSessions) ? result.savedSessions : [];

            ['hung_yen', 'thai_binh'].forEach(site => {
                if (sessionsBySite[site].length === 0) {
                    // 1. Chuyển đổi tabsBySite cũ thành phiên đầu tiên
                    const siteTabs = (result.tabsBySite && result.tabsBySite[site]) ? result.tabsBySite[site] : [];
                    if (siteTabs.length > 0) {
                        sessionsBySite[site].push({
                            id: 'sess_' + site + '_default',
                            name: 'Phiên chính',
                            tabs: siteTabs,
                            activeTabId: siteTabs[0].id,
                            createdAt: new Date().toLocaleString('vi-VN'),
                            updatedAt: new Date().toLocaleString('vi-VN')
                        });
                    }

                    // 2. Tự động đưa các phiên đã lưu cũ (savedSessions) thành các Tab To
                    oldSavedSessions.filter(s => s.siteKey === site || (!s.siteKey && site === 'hung_yen')).forEach(oldS => {
                        sessionsBySite[site].push({
                            id: oldS.id || ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
                            name: oldS.name || 'Phiên đã lưu',
                            tabs: Array.isArray(oldS.tabs) && oldS.tabs.length > 0 ? oldS.tabs : [{
                                id: 'tab_' + Date.now(),
                                name: 'Query 1',
                                sql: '',
                                data: [],
                                currentPage: 1,
                                totalRows: 0,
                                lastSql: '',
                                statusText: '',
                                siteKey: site
                            }],
                            activeTabId: (oldS.tabs && oldS.tabs[0]) ? oldS.tabs[0].id : null,
                            createdAt: oldS.createdAt || new Date().toLocaleString('vi-VN'),
                            updatedAt: oldS.updatedAt || new Date().toLocaleString('vi-VN')
                        });
                    });

                    // 3. Nếu vẫn chưa có phiên nào, tạo 1 phiên mặc định với 1 Query 1
                    if (sessionsBySite[site].length === 0) {
                        const defTab = {
                            id: 'tab_' + site + '_1',
                            name: 'Query 1',
                            sql: '',
                            data: [],
                            currentPage: 1,
                            totalRows: 0,
                            lastSql: '',
                            statusText: '',
                            siteKey: site
                        };
                        sessionsBySite[site].push({
                            id: 'sess_' + site + '_default',
                            name: 'Phiên chính',
                            tabs: [defTab],
                            activeTabId: defTab.id,
                            createdAt: new Date().toLocaleString('vi-VN'),
                            updatedAt: new Date().toLocaleString('vi-VN')
                        });
                    }
                }
            });

            // Chọn session hiện tại cho site đang active
            let activeSessId = currentSessionIdBySite[currentSiteKey];
            if (!activeSessId || !sessionsBySite[currentSiteKey].some(s => s.id === activeSessId)) {
                activeSessId = sessionsBySite[currentSiteKey][0].id;
                currentSessionIdBySite[currentSiteKey] = activeSessId;
            }
            currentSessionId = activeSessId;

            const curSess = getCurrentSession();
            tabsBySite[currentSiteKey] = curSess ? curSess.tabs : [];

            renderSessionTabs();
            renderTabs();

            const tabToSwitch = (curSess && curSess.activeTabId) || (tabsBySite[currentSiteKey][0] ? tabsBySite[currentSiteKey][0].id : null);
            if (tabToSwitch) {
                switchTab(tabToSwitch);
            } else {
                addNewTab();
            }

            saveTabs();
        });

        setInterval(saveTabs, 2000);

        editor.onDidChangeModelContent(() => {
            const tab = getCurrentTab();
            if (tab) tab.sql = editor.getValue();
        });

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
            const btnExecute = document.getElementById('btnExecute');
            if (btnExecute && !btnExecute.disabled) {
                btnExecute.click();
            }
        });

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, function () {
            closeTab(currentTabId, true);
        });

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyQ, function () {
            closeTab(currentTabId, true);
        });

		editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyW, function () {
            closeTab(currentTabId, true);
        });
    });
}

function initLayoutAndEvents() {
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (((e.ctrlKey || e.metaKey) && (key === 'w' || key === 'q')) || (e.altKey && key === 'w')) {
            e.preventDefault();
            e.stopPropagation();
            closeTab(currentTabId, true);
        }
    }, true);

    window.addEventListener('beforeunload', (e) => {
        e.preventDefault();
        e.returnValue = '';
        return '';
    });

    document.getElementById('btnExecute').addEventListener('click', () => {
        if (!editor) return;

        const selection = editor.getSelection();
        let content = editor.getModel().getValueInRange(selection).trim();
        if (!content) content = editor.getValue().trim();

        if (!content) {
            Swal.fire({
                icon: 'warning',
                title: 'Thông báo',
                text: 'Vui lòng nhập nội dung!'
            });
            return;
        }

        lastSql = content;
        currentPage = 1;
        executeWithPagination();
    });

    document.getElementById('btnFormat').addEventListener('click', () => {
        if (!editor) return;
        let sql = editor.getValue();
        const sqlFormatter = window.mySqlFormatter;

        if (!sqlFormatter) {
            Swal.fire({
                icon: 'error',
                title: 'Lỗi',
                text: 'Thư viện định dạng chưa nạp xong!'
            });
            return;
        }

        sql = sqlFormatter.format(sql, {
            language: 'plsql',
            indentStyle: 'tabularLeft'
        });

        sql = formatDecodeToStyle(sql);

        editor.executeEdits("format-action", [{
            range: editor.getModel().getFullModelRange(),
            text: sql,
            forceMoveMarkers: true
        }]);

        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.className = "text-success";
            statusEl.innerText = "✅ Định dạng SQL thành công";
        }
    });

    document.getElementById('btnCleanSql').addEventListener('click', () => {
        if (!editor) return;

        const selection = editor.getSelection();
        let content = editor.getModel().getValueInRange(selection).trim();
        let isSelection = true;

        if (!content) {
            content = editor.getValue().trim();
            isSelection = false;
        }

        if (!content) {
            Swal.fire({
                icon: 'warning',
                title: 'Thông báo',
                text: 'Vui lòng nhập hoặc bôi đen câu lệnh SQL cần dọn dẹp!'
            });
            return;
        }

        const cleanedSql = cleanSql(content);
        const targetRange = isSelection ? selection : editor.getModel().getFullModelRange();

        editor.executeEdits("clean-action", [{
            range: targetRange,
            text: cleanedSql,
            forceMoveMarkers: true
        }]);

        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.className = "text-success";
            statusEl.innerText = "✅ Dọn dẹp SQL thành công";
        }
    });

    document.getElementById('btnExport').addEventListener('click', () => {
        if (!currentData || currentData.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Thông báo',
                text: 'Chưa có dữ liệu để xuất!'
            });
            return;
        }

        const doExport = (dataRows, suffix = '') => {
            const exportData = dataRows.map((row, index) => {
                const newRow = { STT: index + 1 };
                Object.keys(row).forEach(key => newRow[key] = row[key]);
                return newRow;
            });
            const worksheet = XLSX.utils.json_to_sheet(exportData);
            worksheet['!cols'] = [{ wch: 8 }];
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Kết quả SQL");
            const cleanSite = currentSiteKey || 'HIS';
            XLSX.writeFile(workbook, `${cleanSite}_Result_${suffix || 'Full'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        };

        const hasMoreRows = ((totalRows !== null && totalRows !== undefined) ? totalRows > currentData.length : currentData.length >= pageSize) && lastSql && !lastSql.toUpperCase().includes('INS_CH_MENU');
        const rowsLabel = (totalRows !== null && totalRows !== undefined) ? `${totalRows.toLocaleString('vi-VN')} dòng` : 'toàn bộ kết quả';

        if (hasMoreRows) {
            Swal.fire({
                title: 'Xuất File Excel',
                text: `Bạn muốn xuất toàn bộ (${rowsLabel}) hay chỉ trang hiện tại (${currentData.length} dòng)?`,
                icon: 'question',
                showCancelButton: true,
                showDenyButton: true,
                confirmButtonColor: '#198754',
                denyButtonColor: '#0d6efd',
                confirmButtonText: `📊 Xuất toàn bộ (${rowsLabel})`,
                denyButtonText: `📄 Chỉ xuất trang hiện tại (${currentData.length} dòng)`,
                cancelButtonText: 'Hủy'
            }).then(res => {
                if (res.isConfirmed) {
                    Swal.fire({
                        title: 'Đang tải toàn bộ dữ liệu...',
                        html: `Đang chuẩn bị xuất <b>${rowsLabel}</b>...`,
                        allowOutsideClick: false,
                        didOpen: () => Swal.showLoading()
                    });
                    chrome.runtime.sendMessage({
                        action: "execute_sql",
                        sql: lastSql,
                        page: 1,
                        pageSize: 100000,
                        noLimit: true,
                        siteKey: currentSiteKey
                    }, (response) => {
                        Swal.close();
                        if (response && response.success && Array.isArray(response.data)) {
                            doExport(response.data, 'Full');
                        } else {
                            doExport(currentData, `Page${currentPage}`);
                        }
                    });
                } else if (res.isDenied) {
                    doExport(currentData, `Page${currentPage}`);
                }
            });
        } else {
            doExport(currentData, `Page${currentPage}`);
        }
    });

    document.querySelectorAll('.site-item').forEach(item => {
        item.addEventListener('click', () => {
            // Lưu lại phiên và tab của site hiện tại trước khi đổi site
            const oldTab = getCurrentTab();
            if (oldTab && editor) {
                tabViewStates[oldTab.id] = editor.saveViewState();
                oldTab.sql = editor.getValue();
            }
            const oldSess = getCurrentSession();
            if (oldSess) {
                oldSess.tabs = tabsBySite[currentSiteKey];
                oldSess.activeTabId = currentTabId;
                oldSess.updatedAt = new Date().toLocaleString('vi-VN');
            }

            currentSiteKey = item.dataset.site;
            document.querySelectorAll('.site-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            if (typeof renderRecentUnitsUI === 'function') renderRecentUnitsUI();

            // Khôi phục hoặc tạo session cho site mới
            if (!sessionsBySite[currentSiteKey] || sessionsBySite[currentSiteKey].length === 0) {
                renderSessionTabs();
            }

            let targetSessId = currentSessionIdBySite[currentSiteKey];
            if (!targetSessId || !sessionsBySite[currentSiteKey].some(s => s.id === targetSessId)) {
                targetSessId = sessionsBySite[currentSiteKey][0] ? sessionsBySite[currentSiteKey][0].id : null;
            }

            if (targetSessId) {
                switchSession(targetSessId);
            } else {
                renderSessionTabs();
                renderTabs();
                if (tabsBySite[currentSiteKey] && tabsBySite[currentSiteKey].length > 0) {
                    switchTab(tabsBySite[currentSiteKey][0].id);
                } else {
                    addNewTab();
                }
            }
        });
    });

    const btnAddSession = document.getElementById('btnAddSession');
    if (btnAddSession) {
        btnAddSession.addEventListener('click', () => addNewSession());
    }

    document.getElementById('btnToggleSidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
    });

    document.getElementById('btnAddTab').addEventListener('click', addNewTab);

    document.getElementById('btnFirst').addEventListener('click', () => { currentPage = 1; executeWithPagination(); });
    document.getElementById('btnPrev').addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; executeWithPagination(); }
    });
    document.getElementById('btnNext').addEventListener('click', () => {
        if (totalRows !== null && totalRows !== undefined) {
            const totalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 1;
            if (currentPage < totalPages) { currentPage++; executeWithPagination(); }
        } else if (currentData.length >= pageSize) {
            currentPage++;
            executeWithPagination();
        }
    });
    document.getElementById('btnLast').addEventListener('click', () => {
        if (totalRows !== null && totalRows !== undefined && totalRows > 0) {
            const totalPages = Math.ceil(totalRows / pageSize);
            if (currentPage < totalPages) {
                currentPage = totalPages;
                executeWithPagination();
            }
        }
    });

    document.getElementById('pageSize').addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1;
        executeWithPagination();
    });

    const chkAutoCount = document.getElementById('chkAutoCount');
    if (chkAutoCount) {
        chkAutoCount.checked = localStorage.getItem('auto_count_rows') !== 'false';
        chkAutoCount.addEventListener('change', () => {
            localStorage.setItem('auto_count_rows', chkAutoCount.checked ? 'true' : 'false');
            if (chkAutoCount.checked && totalRows === null && currentData.length >= pageSize) {
                triggerCountSql();
            }
        });
    }

    let isResizing = false;
    const resizer = document.getElementById('dragMe');
    const editorWrapper = document.getElementById('editor-wrapper');
    const gridContainer = document.getElementById('gridWrapper');

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        resizer.style.background = "#0d6efd";
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
    });

    function doResize(e) {
        if (!isResizing) return;
        const rect = editorWrapper.getBoundingClientRect();
        let newHeight = e.clientY - rect.top + 5;
        newHeight = Math.max(120, Math.min(newHeight, window.innerHeight - 300));
        editorWrapper.style.height = newHeight + 'px';
        const curTab = getCurrentTab();
        if (curTab) {
            curTab.layoutState = 'default';
            curTab.customEditorHeight = newHeight + 'px';
        }
        if (editor) editor.layout();
    }

    function stopResize() {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizer.style.background = "";
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        saveTabs();
    }

    document.getElementById('btnFullSQL').addEventListener('click', () => {
        const tab = getCurrentTab();
        if (!originalEditorHeight) originalEditorHeight = editorWrapper.style.height || '40%';
        if (tab) {
            tab.layoutState = 'full_sql';
            saveTabs();
        }
        applyTabLayoutState(tab);
    });

    document.getElementById('btnFullGrid').addEventListener('click', () => {
        const tab = getCurrentTab();
        if (!originalEditorHeight) originalEditorHeight = editorWrapper.style.height || '40%';
        if (tab) {
            tab.layoutState = 'full_grid';
            saveTabs();
        }
        applyTabLayoutState(tab);
    });

    document.getElementById('btnResetLayout').addEventListener('click', () => {
        const tab = getCurrentTab();
        if (tab) {
            tab.layoutState = 'default';
            tab.customEditorHeight = null;
            saveTabs();
        }
        applyTabLayoutState(tab);
    });

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
            if (editor) editor.layout();
        });
        const sBar = document.getElementById('sessionTabBar');
        if (sBar) ro.observe(sBar);
        const tBar = document.getElementById('tabBar');
        if (tBar) ro.observe(tBar);
    }

	document.getElementById('btnSearchProcFunc').addEventListener('click', () => {
		const modalEl = document.getElementById('procFuncModal');
		let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
		if (!bootstrapObj) {
			Swal.fire({
				icon: 'error',
				title: 'Lỗi',
				text: 'Không thể nạp thư viện giao diện Bootstrap!'
			});
			return;
		}
		let searchModal = bootstrapObj.Modal.getInstance(modalEl) || new bootstrapObj.Modal(modalEl);
		searchModal.show();
	});

	document.getElementById('btnProcFuncSearch').addEventListener('click', performProcFuncSearch);
	document.getElementById('procFuncSearchInput').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') performProcFuncSearch();
	});

	function performProcFuncSearch() {
		const keyword = document.getElementById('procFuncSearchInput').value.trim();
		if (!keyword) {
			Swal.fire({
				icon: 'warning',
				title: 'Thông báo',
				text: 'Vui lòng nhập từ khóa tìm kiếm!'
			});
			return;
		}

		writeOperationLog("SEARCH_PROC", keyword);

		const statusEl = document.getElementById('procFuncStatus');
		const tableBody = document.getElementById('procFuncTableBody');

		statusEl.className = "text-primary fw-bold";
		statusEl.innerText = "⏳ Đang tìm kiếm trong cơ sở dữ liệu...";
		showLoading("Đang tìm kiếm đối tượng trong database...");
		tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Đang tải...</td></tr>`;

		const cleanKeyword = keyword.replace(/'/g, "''");

		const sql = `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE FROM (
  SELECT USER AS OWNER, OBJECT_NAME, OBJECT_TYPE 
  FROM USER_OBJECTS 
  WHERE OBJECT_NAME LIKE '%' || UPPER('${cleanKeyword}') || '%'
    AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY')
  UNION ALL
  SELECT OWNER, OBJECT_NAME, OBJECT_TYPE 
  FROM ALL_OBJECTS 
  WHERE OBJECT_NAME LIKE '%' || UPPER('${cleanKeyword}') || '%'
    AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY')
    AND OWNER IN ('DMC', 'S', 'MED', 'KQDICHVU')
    AND OWNER <> USER
) WHERE ROWNUM <= 150
ORDER BY OBJECT_NAME`;

		chrome.runtime.sendMessage({
			action: "execute_sql",
			sql: sql,
			page: 1,
			pageSize: 150,
			siteKey: currentSiteKey
		}, (response) => {
			hideLoading();
			if (response && response.success) {
				const rows = Array.isArray(response.data) ? response.data : [];
				if (rows.length === 0) {
					statusEl.className = "text-warning fw-bold";
					statusEl.innerText = `⚠️ Không tìm thấy đối tượng nào khớp với từ khóa "${keyword}".`;
					tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Không tìm thấy kết quả</td></tr>`;
					return;
				}

				statusEl.className = "text-success fw-bold";
				statusEl.innerText = `✅ Đã tìm thấy ${rows.length} đối tượng.`;

				let html = '';
				rows.forEach((row, index) => {
					const name = row.OBJECT_NAME || row.object_name || '';
					const owner = row.OWNER || row.owner || '';
					const type = row.OBJECT_TYPE || row.object_type || '';

					html += `
					<tr>
						<td style="text-align: center; font-weight: bold;">${index + 1}</td>
						<td>${owner}</td>
						<td class="fw-semibold text-primary">${name}</td>
						<td><span class="badge ${type.includes('PACKAGE') ? 'bg-info' : 'bg-success'}">${type}</span></td>
						<td style="text-align: center; white-space: nowrap;">
							<button class="btn btn-primary btn-sm btn-load-editor fw-bold me-1" data-owner="${owner}" data-name="${name}" data-type="${type}">Xem</button>
							<button class="btn btn-success btn-sm btn-view-run fw-bold" data-owner="${owner}" data-name="${name}" data-type="${type}">Xem & Chạy</button>
						</td>
					</tr>`;
				});

				tableBody.innerHTML = html;

				tableBody.querySelectorAll('.btn-load-editor').forEach(btn => {
					btn.addEventListener('click', (e) => {
						const owner = btn.getAttribute('data-owner');
						const name = btn.getAttribute('data-name');
						const type = btn.getAttribute('data-type');
						loadProcFuncSource(owner, name, type, false);
					});
				});

				tableBody.querySelectorAll('.btn-view-run').forEach(btn => {
					btn.addEventListener('click', (e) => {
						const owner = btn.getAttribute('data-owner');
						const name = btn.getAttribute('data-name');
						const type = btn.getAttribute('data-type');
						loadProcFuncSource(owner, name, type, true);
					});
				});

			} else {
				statusEl.className = "text-danger fw-bold";
				statusEl.innerText = `❌ Lỗi: ${response?.error || 'Không thể thực thi truy vấn'}`;
				tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Lỗi tải dữ liệu: ${response?.error || 'Lỗi không xác định'}</td></tr>`;
			}
		});
	}

	function loadProcFuncSource(owner, name, type, autoRun = false) {
		const statusEl = document.getElementById('procFuncStatus');
		statusEl.className = "text-primary fw-bold";
		statusEl.innerText = `⏳ Đang tải mã nguồn của ${type} ${name}...`;
		showLoading(`Đang tải mã nguồn của ${type} ${name}...`);

		const cleanOwner = owner.replace(/'/g, "''");
		const cleanName = name.replace(/'/g, "''");
		const cleanType = type.replace(/'/g, "''");

		const sql = `SELECT TEXT 
FROM ALL_SOURCE 
WHERE OWNER = '${cleanOwner}' 
  AND NAME = '${cleanName}' 
  AND TYPE = '${cleanType}' 
ORDER BY LINE`;

		chrome.runtime.sendMessage({
			action: "execute_sql",
			sql: sql,
			page: 1,
			pageSize: 100000,
			noLimit: true,
			siteKey: currentSiteKey
		}, (response) => {
			if (response && response.success) {
				const lines = Array.isArray(response.data) ? response.data : [];
				if (lines.length === 0) {
					statusEl.className = "text-warning fw-bold";
					statusEl.innerText = `⚠️ Không tìm thấy source code của ${name} trong ALL_SOURCE.`;
					hideLoading();
					return;
				}

				const fullSource = lines.map(row => {
					const text = row.TEXT || row.text || '';
					return text;
				}).join('');

				statusEl.className = "text-success fw-bold";
				statusEl.innerText = `✅ Đã tải thành công ${lines.length} dòng`;

				const newTabId = 'tab_' + Date.now();
				const newTab = {
					id: newTabId,
					name: name,
					sql: fullSource,
					data: [],
					currentPage: 1,
					totalRows: 0,
					lastSql: '',
					statusText: `✅ Đã tải source của ${type} ${name}`,
					siteKey: currentSiteKey,
					objectOwner: owner,
					objectName: name,
					objectType: type,
					isProcFunc: true
				};

				tabsBySite[currentSiteKey].push(newTab);
				renderTabs();
				switchTab(newTabId);
				saveTabs();

				const modalEl = document.getElementById('procFuncModal');
				let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
				if (bootstrapObj) {
					const modalInstance = bootstrapObj.Modal.getInstance(modalEl);
					if (modalInstance) modalInstance.hide();
				}

				if (autoRun) {
					setTimeout(() => {
						triggerRunProcFunc(fullSource);
					}, 200);
				} else {
					hideLoading();
				}

			} else {
				statusEl.className = "text-danger fw-bold";
				statusEl.innerText = `❌ Lỗi tải mã nguồn: ${response?.error || 'Lỗi không xác định'}`;
				hideLoading();
			}
		});
	}

	function runProcFuncDirectly(owner, name, type) {
		const newTabId = 'tab_' + Date.now();
		const newTab = {
			id: newTabId,
			name: name,
			sql: '',
			data: [],
			currentPage: 1,
			totalRows: 0,
			lastSql: '',
			statusText: `Ready to run ${type} ${name}`,
			siteKey: currentSiteKey,
			objectOwner: owner,
			objectName: name,
			objectType: type
		};

		tabsBySite[currentSiteKey].push(newTab);
		renderTabs();
		switchTab(newTabId);
		saveTabs();

		const modalEl = document.getElementById('procFuncModal');
		let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
		if (bootstrapObj) {
			const modalInstance = bootstrapObj.Modal.getInstance(modalEl);
			if (modalInstance) modalInstance.hide();
		}

		setTimeout(() => {
			const btnRun = document.getElementById('btnRunProcFunc');
			if (btnRun) btnRun.click();
		}, 200);
	}

		const btnCheckUpdate = document.getElementById('btnCheckUpdate');
	if (btnCheckUpdate) {
		btnCheckUpdate.addEventListener('click', () => {
			checkAppUpdate(true);
		});
	}

const jasperStatusBtn = document.getElementById('statusJasperHelper');
	if (jasperStatusBtn) {
		jasperStatusBtn.addEventListener('click', () => {
			checkAndStartJasperHelperUI(true);
		});
	}


	document.getElementById('tableBody').addEventListener('click', (e) => {
		const copyBtn = e.target.closest('.btn-copy-cell');
		if (copyBtn) {
			e.stopPropagation();
			const td = copyBtn.closest('.cell-copyable');
			if (td) {
				const content = td.getAttribute('data-content-raw') || '';
				navigator.clipboard.writeText(content).then(() => {
					const oldText = copyBtn.textContent;
					copyBtn.textContent = '✅';
					setTimeout(() => {
						copyBtn.textContent = oldText;
					}, 1000);
				});
			}
		}
	});

	let currentRunProcFuncArgs = [];

	function parseAllParamsFromText(text) {
		if (!text) return null;
		const cleanText = text.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, "");
		const regex = /\b(?:PROCEDURE|FUNCTION)\s+([a-zA-Z0-9_]+)\b\s*\(/gi;
		let match;
		const allArgs = [];
		while ((match = regex.exec(cleanText)) !== null) {
			const objName = match[1];
			const openParenIndex = match.index + match[0].length - 1;
			let parenCount = 0;
			let closeParenIndex = -1;
			for (let i = openParenIndex; i < cleanText.length; i++) {
				if (cleanText[i] === '(') parenCount++;
				else if (cleanText[i] === ')') {
					parenCount--;
					if (parenCount === 0) {
						closeParenIndex = i;
						break;
					}
				}
			}
			if (closeParenIndex === -1) continue;
			const paramsText = cleanText.substring(openParenIndex + 1, closeParenIndex);
			const paramLines = [];
			let currentParam = "";
			let pCount = 0;
			for (let i = 0; i < paramsText.length; i++) {
				const char = paramsText[i];
				if (char === '(') pCount++;
				else if (char === ')') pCount--;
				if (char === ',' && pCount === 0) {
					paramLines.push(currentParam.trim());
					currentParam = "";
				} else {
					currentParam += char;
				}
			}
			if (currentParam.trim()) {
				paramLines.push(currentParam.trim());
			}
			paramLines.forEach((line, idx) => {
				let cleanLine = line.split(/\bDEFAULT\b|:=/i)[0].trim();
				cleanLine = cleanLine.replace(/\s+/g, " ");
				if (!cleanLine) return;
				const parts = cleanLine.split(' ');
				const argName = parts[0];
				let inOut = "IN";
				let dataType = "VARCHAR2";
				if (parts.length > 1) {
					const part1Upper = parts[1].toUpperCase();
					if (part1Upper === "IN") {
						if (parts.length > 2 && parts[2].toUpperCase() === "OUT") {
							inOut = "IN/OUT";
							dataType = parts.slice(3).join(' ');
						} else {
							inOut = "IN";
							dataType = parts.slice(2).join(' ');
						}
					} else if (part1Upper === "OUT") {
						inOut = "OUT";
						dataType = parts.slice(2).join(' ');
					} else if (part1Upper === "IN/OUT") {
						inOut = "IN/OUT";
						dataType = parts.slice(2).join(' ');
					} else {
						inOut = "IN";
						dataType = parts.slice(1).join(' ');
					}
				}
				allArgs.push({
					ARGUMENT_NAME: argName,
					DATA_TYPE: dataType.toUpperCase(),
					IN_OUT: inOut,
					POSITION: idx + 1,
					SEQUENCE: idx + 1,
					DATA_LEVEL: 0,
					PACKAGE_NAME: null,
					OBJECT_NAME: objName.toUpperCase()
				});
			});
		}
		return allArgs.length > 0 ? allArgs : null;
	}

	triggerRunProcFunc = function (content) {
		const tab = getCurrentTab();
		let objType = tab?.objectType || '';
		let objName = tab?.objectName || '';
		let objOwner = tab?.objectOwner || '';

		if (!objType || !objName) {
			const match = content.match(/^\s*(PROCEDURE|FUNCTION|PACKAGE|TRIGGER)\s+([a-zA-Z0-9_\.]+)/i);
			if (match) {
				objType = match[1].toUpperCase();
				const nameParts = match[2].split('.');
				if (nameParts.length > 1) {
					objOwner = nameParts[0].toUpperCase();
					objName = nameParts[1];
				} else {
					objName = nameParts[0];
				}
			}
		}

		if (!objType || !objName) {
			Swal.fire({
				title: 'Lỗi chạy Proc/Func',
				text: 'Không nhận dạng được tên và loại Procedure/Function trong tab này.',
				icon: 'error'
			});
			return;
		}

		const statusEl = document.getElementById('status');

		const localArgs = parseAllParamsFromText(content);
		if (localArgs && localArgs.length > 0) {
			currentRunProcFuncArgs = localArgs;
			statusEl.innerText = "✅ Đã đọc thông tin tham số từ Editor (Instant)";
			statusEl.className = "text-success";
			hideLoading();
			if (tab) {
				tab.objectType = objType;
				tab.objectName = objName;
				if (objOwner) tab.objectOwner = objOwner;
			}
			showRunProcFuncModal(objName, objType, localArgs);
			return;
		}

		statusEl.className = "text-primary";
		statusEl.innerText = `⏳ Đang đọc danh sách tham số của ${objType} ${objName}...`;
		showLoading(`Đang đọc danh sách tham số của ${objType} ${objName}...`);

		const cleanOwner = objOwner ? objOwner.replace(/'/g, "''") : '';
		const cleanName = objName.replace(/'/g, "''");

		let sql;
		if (objType === 'PACKAGE') {
			sql = `WITH cte AS (
  SELECT /*+ NO_MERGE */ ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, SEQUENCE, DATA_LEVEL, PACKAGE_NAME, OBJECT_NAME, OWNER
  FROM ALL_ARGUMENTS
  WHERE PACKAGE_NAME = '${cleanName}'
)
SELECT ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, SEQUENCE, DATA_LEVEL, PACKAGE_NAME, OBJECT_NAME
FROM cte
${cleanOwner ? `WHERE OWNER = '${cleanOwner}'` : ''}
ORDER BY PACKAGE_NAME, OBJECT_NAME, SEQUENCE`;
		} else {
			sql = `WITH cte AS (
  SELECT /*+ NO_MERGE */ ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, SEQUENCE, DATA_LEVEL, PACKAGE_NAME, OBJECT_NAME, OWNER
  FROM ALL_ARGUMENTS
  WHERE PACKAGE_NAME IS NULL
    AND OBJECT_NAME = '${cleanName}'
)
SELECT ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, SEQUENCE, DATA_LEVEL, PACKAGE_NAME, OBJECT_NAME
FROM cte
${cleanOwner ? `WHERE OWNER = '${cleanOwner}'` : ''}
ORDER BY PACKAGE_NAME, OBJECT_NAME, SEQUENCE`;
		}

		chrome.runtime.sendMessage({
			action: "execute_sql",
			sql: sql,
			page: 1,
			pageSize: 500,
			siteKey: currentSiteKey
		}, (response) => {
			hideLoading();
			if (response && response.success) {
				const rows = Array.isArray(response.data) ? response.data : [];
				currentRunProcFuncArgs = rows;
				statusEl.innerText = `✅ Đã tải thông tin tham số`;
				statusEl.className = "text-success";

				if (tab) {
					tab.objectType = objType;
					tab.objectName = objName;
					if (objOwner) tab.objectOwner = objOwner;
				}

				showRunProcFuncModal(objName, objType, rows);
			} else {
				statusEl.className = "text-danger";
				statusEl.innerText = `❌ Lỗi tải tham số: ${response?.error || 'Lỗi không xác định'}`;
				Swal.fire({
					title: 'Lỗi tải tham số',
					text: `Không thể đọc tham số từ database: ${response?.error || 'Lỗi không xác định'}`,
					icon: 'error'
				});
			}
		});
	}

	function showRunProcFuncModal(objectName, objectType, args) {
		const modalEl = document.getElementById('runProcFuncModal');
		let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
		if (!bootstrapObj) {
			Swal.fire({
				icon: 'error',
				title: 'Lỗi',
				text: 'Không thể nạp thư viện giao diện Bootstrap!'
			});
			return;
		}

		document.getElementById('runProcFuncTitle').innerText = `Chạy ${objectType}: ${objectName}`;

		const packageSelectContainer = document.getElementById('runProcFuncPackageSelectContainer');
		const subProgramSelect = document.getElementById('runProcFuncSubProgramSelect');
		const paramsContainer = document.getElementById('runProcFuncParamsContainer');

		paramsContainer.innerHTML = '';
		packageSelectContainer.style.display = 'none';

		const subprograms = {};
		args.forEach(arg => {
			const subprogName = arg.OBJECT_NAME || objectName;
			if (!subprograms[subprogName]) subprograms[subprogName] = [];
			subprograms[subprogName].push(arg);
		});

		const subprogNames = Object.keys(subprograms);

		if (subprogNames.length === 0) {
			paramsContainer.innerHTML = '<div class="alert alert-warning py-2 small mb-0">Đối tượng này không yêu cầu tham số đầu vào.</div>';
			subProgramSelect.innerHTML = '';
		} else if (subprogNames.length > 1) {
			packageSelectContainer.style.display = 'block';
			let optionsHtml = '';
			subprogNames.forEach(name => {
				optionsHtml += `<option value="${name}">${name}</option>`;
			});
			subProgramSelect.innerHTML = optionsHtml;

			subProgramSelect.onchange = () => {
				renderSubprogramParams(subprograms[subProgramSelect.value], objectName);
			};
			renderSubprogramParams(subprograms[subprogNames[0]], objectName);
		} else {
			subProgramSelect.innerHTML = '';
			renderSubprogramParams(subprograms[subprogNames[0]], objectName);
		}

		const unitSearchInput = document.getElementById('unitSearchInput');
		if (unitSearchInput) unitSearchInput.value = '';
		const unitDropdownMenu = document.getElementById('unitDropdownMenu');
		if (unitDropdownMenu) unitDropdownMenu.style.display = 'none';

		if (typeof renderRecentUnitsUI === 'function') renderRecentUnitsUI();
		let runModal = bootstrapObj.Modal.getInstance(modalEl) || new bootstrapObj.Modal(modalEl);
		runModal.show();
	}

	function renderSubprogramParams(params, objectName) {
		const paramsContainer = document.getElementById('runProcFuncParamsContainer');
		paramsContainer.innerHTML = '';

		let hasInputs = false;
		let html = '';

		const subprogName = params[0]?.OBJECT_NAME || objectName;
		let fullName = '';
		if (objectName !== subprogName) {
			fullName = objectName + '.' + subprogName;
		} else {
			fullName = objectName;
		}

		let savedParams = {};
		try {
			const savedStr = localStorage.getItem(`proc_func_params_${fullName}`);
			if (savedStr) {
				savedParams = JSON.parse(savedStr);
			}
		} catch (e) {
			console.error("Failed to parse saved parameters", e);
		}

		const isFuncReturningCursor = params.some(p => parseInt(p.POSITION || '0', 10) === 0 && (p.DATA_TYPE || '').toUpperCase().includes('CURSOR'));

		params.forEach(p => {
			const position = parseInt(p.POSITION || '0', 10);
			if (position > 0) {
				const isInput = p.IN_OUT === 'IN' || p.IN_OUT === 'IN/OUT';
				if (isInput) {
					hasInputs = true;
					const argName = p.ARGUMENT_NAME || `arg_${p.SEQUENCE}`;
					const dataType = p.DATA_TYPE || 'VARCHAR2';
					const inOut = p.IN_OUT;
					let defaultValue = '';

					const argNameUpper = argName.toUpperCase();
					if (isFuncReturningCursor && argNameUpper === 'I_PAGE') {
						defaultValue = '1';
					} else if (isFuncReturningCursor && argNameUpper === 'I_ROW') {
						defaultValue = '100';
					} else if (savedParams && savedParams[argName] !== undefined) {
						defaultValue = savedParams[argName];
					} else {
						if (argNameUpper === 'I_PAGE') {
							defaultValue = '1';
						} else if (['I_ROW', 'I_ROWCOUNT', 'I_LIMIT', 'I_PAGESIZE'].includes(argNameUpper)) {
							defaultValue = '100';
						} else if (argNameUpper === 'I_UID') {
							defaultValue = '171705';
						} else if (argNameUpper === 'I_HID') {
							defaultValue = '90863';
						} else if (argNameUpper === 'I_SCH') {
							defaultValue = 'HIS_DATA_HYN_VANLAM';
						} else if (argNameUpper.includes('NGAY') || argNameUpper.includes('DATE')) {
							const today = new Date();
							const dd = String(today.getDate()).padStart(2, '0');
							const mm = String(today.getMonth() + 1).padStart(2, '0');
							const yyyy = today.getFullYear();
							defaultValue = `${dd}/${mm}/${yyyy}`;
						}
					}

					html += `
					<div class="mb-2 run-param-field" data-arg-name="${argName}" data-data-type="${dataType}" data-in-out="${inOut}" data-sequence="${p.SEQUENCE}">
						<label class="form-label mb-1 fw-semibold d-flex justify-content-between">
							<span>${argName}</span>
							<span class="badge bg-secondary font-monospace" style="font-size: 9px;">${dataType} (${inOut})</span>
						</label>
						<input type="text" class="form-control form-control-sm run-param-input" placeholder="Nhập giá trị..." value="${defaultValue}">
					</div>`;
				}
			} else if (position === 0) {
				html += `
				<div class="alert alert-info py-1 px-2 small mb-3">
					ℹ️ Đây là <strong>FUNCTION</strong> trả về giá trị kiểu: <span class="badge bg-dark">${p.DATA_TYPE}</span>
				</div>`;
			}
		});

		if (!hasInputs) {
			html += '<div class="alert alert-secondary py-2 small mb-0">Không có tham số IN/input nào cần nhập.</div>';
		}

		paramsContainer.innerHTML = html;
	}

	document.getElementById('btnSubmitRunProcFunc').addEventListener('click', () => {
		const tab = getCurrentTab();
		if (!tab || !tab.objectType) return;

		const tempParams = {};
		document.querySelectorAll('#runProcFuncParamsContainer .run-param-field').forEach(field => {
			const argName = field.getAttribute('data-arg-name');
			const inputEl = field.querySelector('.run-param-input');
			if (inputEl && argName) tempParams[argName] = inputEl.value.trim();
		});
		const subSelect = document.getElementById('runProcFuncSubProgramSelect');
		const subName = (subSelect && subSelect.value) ? subSelect.value : tab.objectName;
		const fName = (tab.objectName !== subName) ? (tab.objectName + '.' + subName) : tab.objectName;
		writeOperationLog("RUN_PROC", `${fName} | Params: ${JSON.stringify(tempParams)}`);

		function formatDateOrTimestamp(userVal, isTimestamp) {
			const trimmed = userVal.trim();
			if (!trimmed) return "null";
			const escaped = trimmed.replace(/'/g, "''");
			if (isTimestamp) {
				if (escaped.includes(' ')) {
					return `TO_TIMESTAMP('${escaped}', 'DD/MM/YYYY HH24:MI:SS')`;
				} else {
					return `TO_TIMESTAMP('${escaped} 00:00:00', 'DD/MM/YYYY HH24:MI:SS')`;
				}
			} else {
				if (escaped.includes(' ')) {
					return `TO_DATE('${escaped}', 'DD/MM/YYYY HH24:MI:SS')`;
				} else {
					return `TO_DATE('${escaped} 00:00:00', 'DD/MM/YYYY HH24:MI:SS')`;
				}
			}
		}

		const subProgramSelect = document.getElementById('runProcFuncSubProgramSelect');
		let subprogramName = tab.objectName;
		if (subProgramSelect && subProgramSelect.value) {
			subprogramName = subProgramSelect.value;
		}

		const selectedArgs = currentRunProcFuncArgs.filter(arg => {
			const name = (arg.OBJECT_NAME || tab.objectName || '').toUpperCase();
			return name === (subprogramName || '').toUpperCase();
		});

		const isFunction = selectedArgs.some(arg => parseInt(arg.POSITION || '0', 10) === 0);
		const functionRetArg = selectedArgs.find(arg => parseInt(arg.POSITION || '0', 10) === 0);
		const isFunctionReturningCursor = isFunction && functionRetArg && (functionRetArg.DATA_TYPE || '').toUpperCase().includes('CURSOR');

		const outCursorParam = selectedArgs.find(arg => {
			const inOut = arg.IN_OUT || '';
			const dataType = arg.DATA_TYPE || '';
			return (inOut.includes('OUT') && (dataType.includes('CURSOR') || dataType.includes('TABLE') || dataType.includes('RESULT')));
		});

		const outNormalParams = selectedArgs.filter(arg => {
			const position = parseInt(arg.POSITION || '0', 10);
			const inOut = arg.IN_OUT || '';
			const dataType = arg.DATA_TYPE || '';
			return (position > 0 && inOut.includes('OUT') && !dataType.includes('CURSOR') && !dataType.includes('TABLE'));
		});

		const paramFields = document.querySelectorAll('#runProcFuncParamsContainer .run-param-field');
		const paramValues = {};
		paramFields.forEach(field => {
			const argName = field.getAttribute('data-arg-name');
			const inputEl = field.querySelector('.run-param-input');
			if (inputEl) {
				paramValues[argName] = inputEl.value.trim();
			}
		});

		let fullName = '';
		if (tab.objectName !== subprogramName) {
			fullName += tab.objectName + '.' + subprogramName;
		} else {
			fullName += tab.objectName;
		}

		if (fullName) {
			localStorage.setItem(`proc_func_params_${fullName}`, JSON.stringify(paramValues));
		}

		if (isFunction && !isFunctionReturningCursor) {
			const inArgs = selectedArgs
				.filter(arg => parseInt(arg.POSITION || '0', 10) > 0)
				.sort((a, b) => parseInt(a.POSITION || '0', 10) - parseInt(b.POSITION || '0', 10));

			const callParams = [];
			inArgs.forEach(arg => {
				const argName = arg.ARGUMENT_NAME;
				const inOut = arg.IN_OUT || '';
				const dataType = arg.DATA_TYPE || '';

				if (inOut === 'IN' || inOut === 'IN/OUT') {
					const userVal = paramValues[argName];
					if (userVal === undefined || userVal === '') {
						const isNumber = dataType.includes('NUMBER') || dataType.includes('FLOAT') || dataType.includes('INTEGER');
						if (isNumber) {
							callParams.push(`null`);
						} else {
							callParams.push(`''`);
						}
					} else {
						const isNumber = dataType.includes('NUMBER') || dataType.includes('FLOAT') || dataType.includes('INTEGER');
						const isTimestamp = dataType.includes('TIMESTAMP');
						const isDate = dataType.includes('DATE');
						if (isNumber) {
							callParams.push(userVal);
						} else if (isTimestamp || isDate) {
							callParams.push(formatDateOrTimestamp(userVal, isTimestamp));
						} else {
							const escaped = userVal.replace(/'/g, "''");
							callParams.push(`'${escaped}'`);
						}
					}
				} else {
					callParams.push(`null`);
				}
			});

			const sqlQuery = `SELECT ${fullName}(${callParams.join(', ')}) AS RESULT FROM DUAL`;

			const modalEl = document.getElementById('runProcFuncModal');
			let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
			if (bootstrapObj) {
				const modalInstance = bootstrapObj.Modal.getInstance(modalEl);
				if (modalInstance) modalInstance.hide();
			}

			const runTabId = 'tab_run_' + Date.now();
			const runTabName = `Run: ${subprogramName}`;
			const newTab = {
				id: runTabId,
				name: runTabName,
				sql: sqlQuery,
				data: [],
				currentPage: 1,
				totalRows: 0,
				lastSql: sqlQuery,
				statusText: `⏳ Đang thực thi ${subprogramName}...`,
				siteKey: currentSiteKey
			};

			tabsBySite[currentSiteKey].push(newTab);
			renderTabs();
			switchTab(runTabId);
			saveTabs();

			lastSql = sqlQuery;
			currentPage = 1;
			executeWithPagination();
			return;
		}

		const declareLines = [];
		const callLines = [];

		if (isFunction && functionRetArg && !isFunctionReturningCursor) {
			let retType = functionRetArg.DATA_TYPE;
			if (retType.includes("VARCHAR2") || retType.includes("CHAR") || retType.includes("NVARCHAR2")) {
				retType += "(4000)";
			}
			declareLines.push(`v_res ${retType};`);
		}

		outNormalParams.forEach(p => {
			let pType = p.DATA_TYPE;
			if (pType.includes("VARCHAR2") || pType.includes("CHAR") || pType.includes("NVARCHAR2")) {
				pType += "(4000)";
			}
			declareLines.push(`v_${p.ARGUMENT_NAME} ${pType};`);
		});

		selectedArgs.forEach(arg => {
			const position = parseInt(arg.POSITION || '0', 10);
			if (position === 0) return;

			const argName = arg.ARGUMENT_NAME;
			const inOut = arg.IN_OUT || '';
			const dataType = arg.DATA_TYPE || '';

			if (inOut === 'IN' || inOut === 'IN/OUT') {
				const userVal = paramValues[argName];
				if (userVal === undefined || userVal === '') {
					callLines.push(`  ${argName} => null`);
				} else {
					const isNumber = dataType.includes('NUMBER') || dataType.includes('FLOAT') || dataType.includes('INTEGER');
					const isTimestamp = dataType.includes('TIMESTAMP');
					const isDate = dataType.includes('DATE');
					if (isNumber) {
						callLines.push(`  ${argName} => ${userVal}`);
					} else if (isTimestamp || isDate) {
						callLines.push(`  ${argName} => ${formatDateOrTimestamp(userVal, isTimestamp)}`);
					} else {
						const escaped = userVal.replace(/'/g, "''");
						callLines.push(`  ${argName} => '${escaped}'`);
					}
				}
			} else if (inOut === 'OUT') {
				if (dataType.includes('CURSOR')) {
					callLines.push(`  ${argName} => :v_${argName}`);
				} else {
					callLines.push(`  ${argName} => v_${argName}`);
				}
			}
		});

		let plsql = '';
		if (declareLines.length > 0) {
			plsql += 'DECLARE\n';
			declareLines.forEach(line => {
				plsql += '  ' + line + '\n';
			});
		}

		plsql += 'BEGIN\n';

		if (isFunction) {
			if (isFunctionReturningCursor) {
				plsql += `  :v_cursor := ${fullName}(\n`;
			} else {
				plsql += `  v_res := ${fullName}(\n`;
			}
		} else {
			plsql += `  ${fullName}(\n`;
		}

		plsql += callLines.join(',\n') + '\n';
		plsql += '  );\n';

		if (isFunction) {
			if (!isFunctionReturningCursor) {
				plsql += `  OPEN :v_cursor FOR SELECT v_res AS RESULT FROM DUAL;\n`;
			}
		} else if (outNormalParams.length > 0 && !outCursorParam) {
			const selectList = outNormalParams.map(p => `v_${p.ARGUMENT_NAME} AS ${p.ARGUMENT_NAME}`).join(', ');
			plsql += `  OPEN :v_cursor FOR SELECT ${selectList} FROM DUAL;\n`;
		}

		plsql += 'END;';

		const modalEl = document.getElementById('runProcFuncModal');
		let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
		if (bootstrapObj) {
			const modalInstance = bootstrapObj.Modal.getInstance(modalEl);
			if (modalInstance) modalInstance.hide();
		}

		const runTabId = 'tab_run_' + Date.now();
		const runTabName = `Run: ${subprogramName}`;
		const newTab = {
			id: runTabId,
			name: runTabName,
			sql: plsql,
			data: [],
			currentPage: 1,
			totalRows: 0,
			lastSql: plsql,
			statusText: `⏳ Đang thực thi ${subprogramName}...`,
			siteKey: currentSiteKey
		};

		tabsBySite[currentSiteKey].push(newTab);
		renderTabs();
		switchTab(runTabId);
		saveTabs();

		lastSql = plsql;
		currentPage = 1;
		executeWithPagination();
	});

		let lastRenderedJasperRows = null;
	let lastRenderedJasperParams = {};
	let lastRenderedJasperSql = "";

	function extractProcedureName(sqlText) {
		if (!sqlText) return "";
		const clean = sqlText.trim().replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '').trim();
		const callMatch = clean.match(/(?:call|exec|execute|begin)\s+([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)?)/i);
		if (callMatch && callMatch[1]) {
			return callMatch[1].toUpperCase();
		}
		const simpleProcMatch = clean.match(/^([a-zA-Z0-9_$]+\.[a-zA-Z0-9_$]+)\s*\(/i);
		if (simpleProcMatch && simpleProcMatch[1]) {
			return simpleProcMatch[1].toUpperCase();
		}
		const fromMatch = clean.match(/\bfrom\s+([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)?)/i);
		if (fromMatch && fromMatch[1]) {
			return fromMatch[1].toUpperCase();
		}
		const firstWord = clean.split(/[\s(;]/)[0];
		return firstWord ? firstWord.toUpperCase() : "";
	}

	function parseAndLoadJrxmlContent(jrxmlText, fileName, prefilledParams = null, prefilledSql = null) {
		uploadedJrxmlContent = jrxmlText;
		currentJrxmlName = fileName || 'report.jrxml';

		const badge = document.getElementById('jasperCurrentFileBadge');
		if (badge) {
			badge.innerText = currentJrxmlName;
			badge.classList.remove('d-none');
		}

		try {
			const parser = new DOMParser();
			const xmlDoc = parser.parseFromString(uploadedJrxmlContent, "text/xml");
			const parameterNodes = xmlDoc.getElementsByTagName("parameter");
			parsedJasperParams = [];

			let savedJasperParams = prefilledParams || {};
			if (!prefilledParams) {
				try {
					const savedStr = localStorage.getItem(`jasper_params_${currentJrxmlName}`);
					if (savedStr) {
						savedJasperParams = JSON.parse(savedStr);
					}
				} catch (err) {
					console.error("Failed to parse saved jasper parameters", err);
				}
			}

			if (prefilledSql !== null && prefilledSql !== undefined) {
				const sqlInputEl = document.getElementById('jasperSqlInput');
				if (sqlInputEl) sqlInputEl.value = prefilledSql;
			} else {
				const savedSql = localStorage.getItem(`jasper_sql_${currentJrxmlName}`) || '';
				const sqlInputEl = document.getElementById('jasperSqlInput');
				if (sqlInputEl && !sqlInputEl.value.trim()) {
					sqlInputEl.value = savedSql;
				}
			}

			let html = '';
			for (let i = 0; i < parameterNodes.length; i++) {
				const node = parameterNodes[i];
				const name = node.getAttribute("name");
				const className = node.getAttribute("class") || "java.lang.String";

				if (name.startsWith("REPORT_") || name.startsWith("JASPER_") || name === "SUBREPORT_DIR") {
					continue;
				}

				parsedJasperParams.push({ name, className });

				let defaultValue = '';
				if (savedJasperParams && savedJasperParams[name] !== undefined) {
					defaultValue = savedJasperParams[name];
				}

				html += `
				<div class="mb-2">
					<label class="form-label mb-1 small fw-semibold text-secondary">${name} <span class="badge bg-light text-dark font-monospace" style="font-size:10px;">${className.split('.').pop()}</span></label>
					<input type="text" id="jasper_param_${name}" class="form-control form-control-sm" placeholder="Nhập giá trị..." value="${defaultValue}">
				</div>`;
			}

			const container = document.getElementById('jasperParamsContainer');
			const section = document.getElementById('jasperParamsSection');

			if (parsedJasperParams.length > 0) {
				container.innerHTML = html;
				section.classList.remove('d-none');
			} else {
				container.innerHTML = '<div class="text-muted small">Không phát hiện tham số nào cần nhập</div>';
				section.classList.remove('d-none');
			}

			const statusEl = document.getElementById('jasperStatus');
			if (statusEl) {
				statusEl.className = "text-success";
				statusEl.innerText = `✅ Đã nạp file: ${currentJrxmlName}`;
			}

		} catch (err) {
			Swal.fire({
				icon: 'error',
				title: 'Lỗi phân tích JRXML',
				text: err.message
			});
		}
	}

	function sendJasperFillRequest(payload) {
		return fetch("http://127.0.0.1:8080/fill", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		})
		.then(res => {
			if (!res.ok) {
				return res.text().then(err => {
					const e = new Error(err);
					e.isServerResponse = true;
					throw e;
				});
			}
			return res.blob();
		})
		.catch(err1 => {
			if (err1.isServerResponse) {
				throw err1;
			}
			console.warn("127.0.0.1 failed, trying localhost:", err1);
			return fetch("http://localhost:8080/fill", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(payload)
			})
			.then(res => {
				if (!res.ok) {
					return res.text().then(err => {
						const e = new Error(err);
						e.isServerResponse = true;
						throw e;
					});
				}
				return res.blob();
			})
			.catch(err2 => {
				if (err2.isServerResponse) {
					throw err2;
				}
				console.warn("localhost failed, trying background proxy:", err2);
				return new Promise((resolve, reject) => {
					chrome.runtime.sendMessage({
						action: "render_jasper",
						jrxml: payload.jrxml,
						jsonData: payload.jsonData,
						parameters: payload.parameters
					}, (response) => {
						if (chrome.runtime.lastError) {
							reject(new Error(chrome.runtime.lastError.message));
						} else if (response && response.success) {
							const bytes = new Uint8Array(response.pdfBytes);
							const blob = new Blob([bytes], { type: "application/pdf" });
							resolve(blob);
						} else {
							reject(new Error(response?.error || "Failed to render PDF via background proxy"));
						}
					});
				});
			});
		});
	}

	function displayJasperPdfBlob(blob, successMsg = "✅ Render báo cáo PDF thành công!") {
		if (jasperPdfBlobUrl) {
			URL.revokeObjectURL(jasperPdfBlobUrl);
		}
		jasperPdfBlobUrl = URL.createObjectURL(blob);

		const iframe = document.getElementById('jasperIframe');
		const placeholder = document.getElementById('jasperPlaceholderText');

		if (iframe) {
			iframe.src = jasperPdfBlobUrl;
			iframe.classList.remove('d-none');
		}
		if (placeholder) {
			placeholder.classList.add('d-none');
		}

		document.getElementById('btnJasperDownload')?.classList.remove('d-none');
		document.getElementById('btnJasperSaveSession')?.classList.remove('d-none');

		const statusEl = document.getElementById('jasperStatus');
		if (statusEl) {
			statusEl.className = "text-success";
			statusEl.innerText = successMsg;
		}
		hideLoading();
	}

	function handleJasperRenderError(err) {
		console.error(err);
		const statusEl = document.getElementById('jasperStatus');
		if (statusEl) {
			statusEl.className = "text-danger";
		}
		const isNetworkErr = err.message === 'Failed to fetch' || err.message.includes('fetch') || err.message.includes('network') || err.message.includes('connect');
		const msg = isNetworkErr 
			? 'Không thể kết nối đến Jasper Helper ở cổng 8080. Vui lòng kiểm tra xem bạn đã chạy file start.bat trong thư mục jasper_helper chưa.'
			: err.message;
		if (statusEl) statusEl.innerText = `❌ Lỗi: ${msg}`;

		const iframe = document.getElementById('jasperIframe');
		const placeholder = document.getElementById('jasperPlaceholderText');
		if (iframe) iframe.classList.add('d-none');
		if (placeholder) {
			placeholder.innerHTML = `
				<div class="text-danger p-3 text-start font-monospace" style="max-height: 450px; overflow-y: auto; font-size: 11px; background: rgba(0,0,0,0.2); border-radius: 4px; width: 100%;">
					<h6 class="fw-bold mb-2">❌ Lỗi kết xuất PDF:</h6>
					<pre style="white-space: pre-wrap; word-break: break-all; color: #ff6b6b; margin: 0 0 10px 0;">${msg}</pre>
					<button id="btnGetJasperLogsInline" class="btn btn-sm btn-warning fw-bold text-dark">📋 Lấy Log từ start.bat</button>
				</div>
			`;
			placeholder.classList.remove('d-none');
			const btnLog = document.getElementById('btnGetJasperLogsInline');
			if (btnLog) {
				btnLog.addEventListener('click', fetchAndShowJasperLogs);
			}
		}

		Swal.fire({
			icon: 'error',
			title: 'Lỗi kết nối hoặc thực thi',
			text: msg,
			showDenyButton: true,
			denyButtonText: '📋 Lấy Log từ start.bat',
			confirmButtonText: 'Đóng',
			customClass: {
				confirmButton: 'btn btn-secondary',
				denyButton: 'btn btn-warning text-dark'
			}
		}).then((result) => {
			if (result.isDenied) {
				fetchAndShowJasperLogs();
			}
		});
		hideLoading();
	}

	function loadJasperSessionsList(searchTerm = null, dateFilter = null) {
		const listEl = document.getElementById('jasperSessionList');
		const dateSelect = document.getElementById('jasperSessionDateSelect');
		const countBadge = document.getElementById('jasperSessionCountBadge');

		if (!listEl) return;

		let url = "http://localhost:8080/list-sessions";
		const params = [];
		if (searchTerm && searchTerm.trim()) {
			params.push(`search=${encodeURIComponent(searchTerm.trim())}`);
		}
		if (dateFilter && dateFilter.trim()) {
			params.push(`date=${encodeURIComponent(dateFilter.trim())}`);
		}
		if (params.length > 0) {
			url += "?" + params.join("&");
		}

		fetch(url)
			.then(res => res.json())
			.then(data => {
				if (!data || !data.success) {
					listEl.innerHTML = '<div class="text-danger small p-2 text-center">Không thể tải danh sách phiên đã lưu</div>';
					return;
				}

				const sessions = data.sessions || [];
				if (countBadge) {
					countBadge.innerText = sessions.length;
				}

				if (data.dates && dateSelect && (!dateFilter || dateSelect.options.length <= 1)) {
					const currentVal = dateSelect.value;
					let dateHtml = '<option value="">📅 Tất cả các ngày</option>';
					data.dates.forEach(d => {
						const parts = d.split('-');
						const label = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
						dateHtml += `<option value="${d}" ${d === currentVal ? 'selected' : ''}>${label}</option>`;
					});
					dateSelect.innerHTML = dateHtml;
				}

				if (sessions.length === 0) {
					listEl.innerHTML = `
						<div class="text-center text-muted py-4 small">
							<div class="fs-5 mb-1">📭</div>
							Chưa có phiên preview nào${(searchTerm || dateFilter) ? ' khớp với bộ lọc' : ''}.
						</div>
					`;
					return;
				}

				let html = '';
				sessions.forEach(s => {
					const siteName = s.siteKey === 'hung_yen' ? 'Hưng Yên' : (s.siteKey === 'thai_binh' ? 'Thái Bình' : (s.siteKey || ''));
					let paramsSummary = '';
					if (s.parameters) {
						try {
							const pObj = typeof s.parameters === 'string' ? JSON.parse(s.parameters) : s.parameters;
							const keys = Object.keys(pObj);
							if (keys.length > 0) {
								paramsSummary = keys.slice(0, 3).map(k => `${k}=${pObj[k]}`).join(', ');
								if (keys.length > 3) paramsSummary += ', ...';
							}
						} catch (e) {}
					}

					html += `
					<div class="card mb-2 shadow-sm border border-light-subtle session-card" data-session-id="${s.id}" style="border-radius: 6px;">
						<div class="card-body p-2" style="font-size: 12px;">
							<div class="d-flex justify-content-between align-items-start mb-1">
								<div class="fw-bold text-dark text-truncate me-1" title="${s.name}" style="max-width: 68%;">${s.name}</div>
								<span class="badge bg-secondary" style="font-size: 10px;">${s.createdDate} ${s.createdTime || ''}</span>
							</div>
							<div class="text-muted mb-1 text-truncate" style="font-size: 11px;">
								📄 <b>JRXML:</b> <span class="font-monospace text-primary">${s.jrxmlName}</span>
							</div>
							${s.procName ? `
							<div class="mb-1 text-truncate" style="font-size: 11px;">
								⚡ <b>Proc:</b> <span class="badge bg-info-subtle text-dark border font-monospace">${s.procName}</span>
							</div>` : ''}
							${paramsSummary ? `
							<div class="text-muted text-truncate mb-1" style="font-size: 11px;" title="${paramsSummary}">
								⚙️ <i>${paramsSummary}</i>
							</div>` : ''}
							<div class="d-flex justify-content-between text-muted mb-2" style="font-size: 11px;">
								<span>🏢 ${siteName}</span>
								<span>📊 <b>${s.dataCount || 0}</b> dòng</span>
							</div>
							<div class="d-flex flex-wrap gap-1 align-items-center pt-1 border-top">
								<button class="btn btn-warning btn-sm py-0 px-2 fw-bold btn-session-render-new" data-session-id="${s.id}" title="Lấy dữ liệu mới nhất từ CSDL và render lại PDF">
									🚀 Render mới
								</button>
								${s.hasSnapshot ? `
								<button class="btn btn-outline-secondary btn-sm py-0 px-2 btn-session-render-old" data-session-id="${s.id}" title="Xem lại với dữ liệu snapshot đã lưu">
									👁️ Dữ liệu cũ
								</button>` : ''}
								<button class="btn btn-outline-primary btn-sm py-0 px-2 btn-session-load-form" data-session-id="${s.id}" title="Nạp lại vào Form để sửa tham số">
									✏️ Nạp form
								</button>
								<button class="btn btn-outline-danger btn-sm py-0 px-1 ms-auto btn-session-delete" data-session-id="${s.id}" title="Xóa phiên này">
									🗑️
								</button>
							</div>
						</div>
					</div>`;
				});

				listEl.innerHTML = html;
			})
			.catch(err => {
				console.error("loadJasperSessionsList error", err);
				listEl.innerHTML = '<div class="text-danger small p-2 text-center">Lỗi kết nối khi tải danh sách phiên</div>';
			});
	}

	function executeRenderSessionNew(sessionId) {
		showLoading("Đang nạp phiên preview và lấy dữ liệu mới từ CSDL...");
		fetch(`http://localhost:8080/get-session?id=${encodeURIComponent(sessionId)}`)
			.then(res => res.json())
			.then(session => {
				if (!session || !session.jrxmlContent) {
					throw new Error("Không thể tải nội dung file JRXML của phiên này!");
				}

				let paramsObj = {};
				if (session.parameters) {
					try {
						paramsObj = typeof session.parameters === 'string' ? JSON.parse(session.parameters) : session.parameters;
					} catch (e) {}
				}

				parseAndLoadJrxmlContent(session.jrxmlContent, session.jrxmlName, paramsObj, session.sql);

				const sql = session.sql || '';
				if (!sql.trim()) {
					throw new Error("Phiên này không có câu lệnh SQL/Procedure để lấy dữ liệu mới!");
				}

				const targetSite = session.siteKey || currentSiteKey;
				const siteName = targetSite === 'hung_yen' ? 'Hưng Yên' : (targetSite === 'thai_binh' ? 'Thái Bình' : targetSite);

				const statusEl = document.getElementById('jasperStatus');
				if (statusEl) {
					statusEl.className = "text-primary";
					statusEl.innerText = `⏳ Đang tải dữ liệu từ web service HIS (Site: ${siteName})...`;
				}

				let compiledSql = sql;
				parsedJasperParams.forEach(p => {
					const val = (paramsObj[p.name] !== undefined ? paramsObj[p.name] : '') + '';
					const escapedVal = val.replace(/'/g, "''");
					const isStringOrDate = p.className === "java.lang.String" || 
					                       p.className === "java.util.Date" || 
					                       p.className === "java.sql.Date" || 
					                       p.className === "java.sql.Timestamp";
					const regex = new RegExp(`:${p.name}\\b`, 'gi');
					if (isStringOrDate) {
						compiledSql = compiledSql.replace(regex, `'${escapedVal}'`);
					} else {
						if (escapedVal.trim() === "") {
							compiledSql = compiledSql.replace(regex, "null");
						} else {
							compiledSql = compiledSql.replace(regex, escapedVal);
						}
					}
				});

				const placeholder = document.getElementById('jasperPlaceholderText');
				const iframe = document.getElementById('jasperIframe');
				if (placeholder) {
					placeholder.innerHTML = `
						<div class="fs-4">⏳ Đang xử lý...</div>
						<div class="small text-light">Đang thực thi SQL với dữ liệu mới và kết xuất báo cáo, vui lòng đợi...</div>
					`;
					placeholder.classList.remove('d-none');
				}
				if (iframe) iframe.classList.add('d-none');

				return new Promise((resolve, reject) => {
					chrome.runtime.sendMessage({
						action: "execute_sql",
						sql: compiledSql,
						page: 1,
						pageSize: 5000,
						siteKey: targetSite
					}, (response) => {
						if (response && response.success) {
							resolve({ rows: response.data || [], session, paramsObj });
						} else {
							reject(new Error(response?.error || 'Lỗi không xác định khi thực thi truy vấn'));
						}
					});
				});
			})
			.then(({ rows, session, paramsObj }) => {
				lastRenderedJasperRows = rows;
				lastRenderedJasperParams = paramsObj;
				lastRenderedJasperSql = session.sql;

				const statusEl = document.getElementById('jasperStatus');
				if (statusEl) statusEl.innerText = `⏳ Đã nhận ${rows.length} dòng dữ liệu mới. Đang render PDF...`;

				const payload = {
					jrxml: session.jrxmlContent,
					jsonData: JSON.stringify(rows),
					parameters: paramsObj
				};

				return sendJasperFillRequest(payload)
					.then(blob => {
						displayJasperPdfBlob(blob, `✅ Render dữ liệu mới thành công! (${rows.length} dòng)`);
					});
			})
			.catch(handleJasperRenderError);
	}

	function executeRenderSessionOld(sessionId) {
		showLoading("Đang nạp phiên preview và kết xuất với dữ liệu cũ...");
		fetch(`http://localhost:8080/get-session?id=${encodeURIComponent(sessionId)}`)
			.then(res => res.json())
			.then(session => {
				if (!session || !session.jrxmlContent) {
					throw new Error("Không thể tải nội dung file JRXML của phiên này!");
				}
				if (!session.snapshotData) {
					throw new Error("Phiên này không lưu kèm dữ liệu cũ. Vui lòng bấm 'Render mới' để lấy dữ liệu từ CSDL!");
				}

				let paramsObj = {};
				if (session.parameters) {
					try {
						paramsObj = typeof session.parameters === 'string' ? JSON.parse(session.parameters) : session.parameters;
					} catch (e) {}
				}

				parseAndLoadJrxmlContent(session.jrxmlContent, session.jrxmlName, paramsObj, session.sql);

				const placeholder = document.getElementById('jasperPlaceholderText');
				const iframe = document.getElementById('jasperIframe');
				if (placeholder) {
					placeholder.innerHTML = `
						<div class="fs-4">⏳ Đang xử lý...</div>
						<div class="small text-light">Đang kết xuất PDF từ dữ liệu snapshot đã lưu...</div>
					`;
					placeholder.classList.remove('d-none');
				}
				if (iframe) iframe.classList.add('d-none');

				let rows = [];
				try {
					rows = typeof session.snapshotData === 'string' ? JSON.parse(session.snapshotData) : session.snapshotData;
				} catch (e) {
					rows = [];
				}
				lastRenderedJasperRows = rows;
				lastRenderedJasperParams = paramsObj;
				lastRenderedJasperSql = session.sql;

				const payload = {
					jrxml: session.jrxmlContent,
					jsonData: typeof session.snapshotData === 'string' ? session.snapshotData : JSON.stringify(session.snapshotData),
					parameters: paramsObj
				};

				return sendJasperFillRequest(payload)
					.then(blob => {
						displayJasperPdfBlob(blob, `✅ Hiển thị lại với dữ liệu snapshot cũ (${rows.length} dòng)`);
					});
			})
			.catch(handleJasperRenderError);
	}

	function executeLoadSessionToForm(sessionId) {
		showLoading("Đang nạp cấu hình phiên vào form...");
		fetch(`http://localhost:8080/get-session?id=${encodeURIComponent(sessionId)}`)
			.then(res => res.json())
			.then(session => {
				hideLoading();
				if (!session || !session.jrxmlContent) {
					throw new Error("Không thể tải nội dung file JRXML của phiên này!");
				}
				let paramsObj = {};
				if (session.parameters) {
					try {
						paramsObj = typeof session.parameters === 'string' ? JSON.parse(session.parameters) : session.parameters;
					} catch (e) {}
				}
				parseAndLoadJrxmlContent(session.jrxmlContent, session.jrxmlName, paramsObj, session.sql);

				const tabBtn = document.getElementById('tab-jasper-config-btn');
				if (tabBtn && window.bootstrap) {
					const tab = window.bootstrap.Tab.getInstance(tabBtn) || new window.bootstrap.Tab(tabBtn);
					tab.show();
				}

				const statusEl = document.getElementById('jasperStatus');
				if (statusEl) {
					statusEl.className = "text-success";
					statusEl.innerText = `✅ Đã nạp phiên "${session.name}" vào form! Bạn có thể sửa tham số và bấm Render Báo Cáo PDF.`;
				}
			})
			.catch(err => {
				hideLoading();
				Swal.fire({ icon: 'error', title: 'Lỗi', text: err.message });
			});
	}

	function executeDeleteSession(sessionId) {
		Swal.fire({
			title: 'Xác nhận xóa?',
			text: 'Bạn có chắc chắn muốn xóa phiên preview này không?',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Xác nhận xóa',
			cancelButtonText: 'Hủy',
			confirmButtonColor: '#d33'
		}).then((result) => {
			if (result.isConfirmed) {
				showLoading("Đang xóa phiên preview...");
				fetch("http://localhost:8080/delete-session", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ id: sessionId })
				})
				.then(res => res.json())
				.then(resp => {
					hideLoading();
					if (resp && resp.success) {
						loadJasperSessionsList(
							document.getElementById('jasperSessionSearch')?.value,
							document.getElementById('jasperSessionDateSelect')?.value
						);
					} else {
						throw new Error(resp?.error || "Không thể xóa");
					}
				})
				.catch(err => {
					hideLoading();
					Swal.fire({ icon: 'error', title: 'Lỗi xóa phiên', text: err.message });
				});
			}
		});
	}

	document.getElementById('btnJasperViewer').addEventListener('click', () => {
		const modalEl = document.getElementById('jasperModal');
		let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
		if (!bootstrapObj) {
			Swal.fire({
				icon: 'error',
				title: 'Lỗi',
				text: 'Không thể nạp thư viện giao diện Bootstrap!'
			});
			return;
		}

		fetch("http://localhost:8080/").catch(() => {
			Swal.fire({
				icon: 'warning',
				title: 'Chưa chạy Jasper Helper',
				text: 'Không kết nối được tới Jasper Helper ở cổng 8080. Vui lòng chạy file start.bat trong thư mục jasper_helper trước để sử dụng tính năng này!',
				confirmButtonText: 'Đồng ý'
			});
		});

		if (editor) {
			const currentSql = editor.getValue().trim();
			if (currentSql) {
				const sqlInput = document.getElementById('jasperSqlInput');
				if (sqlInput && !sqlInput.value.trim()) {
					sqlInput.value = currentSql;
				}
			}
		}

		let jasperModal = bootstrapObj.Modal.getInstance(modalEl) || new bootstrapObj.Modal(modalEl);
		jasperModal.show();
		loadJasperSessionsList();
	});

	document.getElementById('jasperFileInput').addEventListener('change', (e) => {
		const file = e.target.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = function(event) {
			parseAndLoadJrxmlContent(event.target.result, file.name);
		};
		reader.readAsText(file);
	});

	document.getElementById('btnJasperRender').addEventListener('click', () => {
		if (!uploadedJrxmlContent) {
			Swal.fire({
				icon: 'warning',
				title: 'Thông báo',
				text: 'Vui lòng chọn file .jrxml trước!'
			});
			return;
		}

		const placeholder = document.getElementById('jasperPlaceholderText');
		const iframe = document.getElementById('jasperIframe');
		if (placeholder) {
			placeholder.innerHTML = `
				<div class="fs-4">⏳ Đang xử lý...</div>
				<div class="small text-light">Đang thực thi SQL và kết xuất báo cáo, vui lòng đợi...</div>
			`;
			placeholder.classList.remove('d-none');
		}
		if (iframe) iframe.classList.add('d-none');

		const useCurrentData = document.getElementById('chkUseCurrentGridData').checked;
		let rowsPromise;

		if (useCurrentData) {
			if (!currentData || currentData.length === 0) {
				Swal.fire({
					icon: 'warning',
					title: 'Thông báo',
					text: 'Grid hiện tại không có dữ liệu! Vui lòng thực hiện câu lệnh SQL ở bảng chính trước hoặc bỏ tích tùy chọn này.'
				});
				return;
			}
			showLoading("Đang chuẩn bị và kết xuất báo cáo Jasper PDF...");
			rowsPromise = Promise.resolve(currentData);
		} else {
			const sql = document.getElementById('jasperSqlInput').value.trim();
			if (!sql) {
				Swal.fire({
					icon: 'warning',
					title: 'Thông báo',
					text: 'Vui lòng nhập câu lệnh SQL hoặc Procedure lấy dữ liệu!'
				});
				return;
			}

			const statusEl = document.getElementById('jasperStatus');
			if (statusEl) {
				statusEl.className = "text-primary";
				const siteName = currentSiteKey === 'hung_yen' ? 'Hưng Yên' : (currentSiteKey === 'thai_binh' ? 'Thái Bình' : currentSiteKey);
				statusEl.innerText = `⏳ Đang tải dữ liệu từ web service HIS (Site: ${siteName})...`;
			}

			showLoading(`Đang tải dữ liệu từ site ${currentSiteKey} và kết xuất báo cáo Jasper PDF...`);

			let compiledSql = sql;
			parsedJasperParams.forEach(p => {
				const inputEl = document.getElementById(`jasper_param_${p.name}`);
				if (inputEl) {
					const val = inputEl.value.trim();
					const escapedVal = val.replace(/'/g, "''");
					const isStringOrDate = p.className === "java.lang.String" || 
					                       p.className === "java.util.Date" || 
					                       p.className === "java.sql.Date" || 
					                       p.className === "java.sql.Timestamp";
					const regex = new RegExp(`:${p.name}\\b`, 'gi');
					if (isStringOrDate) {
						compiledSql = compiledSql.replace(regex, `'${escapedVal}'`);
					} else {
						if (escapedVal === "") {
							compiledSql = compiledSql.replace(regex, "null");
						} else {
							compiledSql = compiledSql.replace(regex, escapedVal);
						}
					}
				}
			});

			rowsPromise = new Promise((resolve, reject) => {
				chrome.runtime.sendMessage({
					action: "execute_sql",
					sql: compiledSql,
					page: 1,
					pageSize: 5000,
					siteKey: currentSiteKey
				}, (response) => {
					if (response && response.success) {
						resolve(response.data || []);
					} else {
						reject(new Error(response?.error || 'Lỗi không xác định'));
					}
				});
			});
		}

		const statusEl = document.getElementById('jasperStatus');
		if (statusEl) {
			statusEl.className = "text-primary";
			statusEl.innerText = "⏳ Đang xử lý và render PDF...";
		}

		rowsPromise
		.then(rows => {
			lastRenderedJasperRows = rows;
			if (statusEl) statusEl.innerText = `⏳ Đã nhận ${rows.length} dòng dữ liệu. Đang render PDF...`;

			const reportParams = {};
			parsedJasperParams.forEach(p => {
				const inputEl = document.getElementById(`jasper_param_${p.name}`);
				if (inputEl) {
					reportParams[p.name] = inputEl.value;
				}
			});

			lastRenderedJasperParams = reportParams;
			const jasperSql = document.getElementById('jasperSqlInput')?.value || '';
			lastRenderedJasperSql = jasperSql;

			if (currentJrxmlName) {
				localStorage.setItem(`jasper_params_${currentJrxmlName}`, JSON.stringify(reportParams));
				localStorage.setItem(`jasper_sql_${currentJrxmlName}`, jasperSql);
			}

			const payload = {
				jrxml: uploadedJrxmlContent,
				jsonData: JSON.stringify(rows),
				parameters: reportParams
			};

			return sendJasperFillRequest(payload)
				.then(blob => {
					displayJasperPdfBlob(blob, `✅ Render báo cáo PDF thành công! (${rows.length} dòng)`);
				});
		})
		.catch(handleJasperRenderError);
	});

	document.getElementById('btnJasperSaveSession').addEventListener('click', () => {
		if (!uploadedJrxmlContent) {
			Swal.fire({ icon: 'warning', title: 'Thông báo', text: 'Chưa có file JRXML nào được nạp!' });
			return;
		}

		const jasperSql = document.getElementById('jasperSqlInput')?.value || '';
		const detectedProc = extractProcedureName(jasperSql);
		const defaultName = `${currentJrxmlName.replace(/\.jrxml$/i, '')}${detectedProc ? ' - ' + detectedProc : ''}`;
		const rowCount = (lastRenderedJasperRows && Array.isArray(lastRenderedJasperRows)) ? lastRenderedJasperRows.length : 0;

		Swal.fire({
			title: 'Lưu phiên preview',
			html: `
				<div class="text-start" style="font-size: 13px;">
					<div class="mb-2">
						<label class="form-label fw-bold mb-1">Tên phiên preview:</label>
						<input id="swalSessionName" class="form-control form-control-sm" value="${defaultName}">
					</div>
					<div class="mb-2">
						<label class="form-label fw-bold mb-1">Tên file JRXML:</label>
						<input class="form-control form-control-sm bg-light" value="${currentJrxmlName}" readonly>
					</div>
					<div class="mb-2">
						<label class="form-label fw-bold mb-1">Tên Procedure nhận diện:</label>
						<input id="swalProcName" class="form-control form-control-sm" value="${detectedProc}">
					</div>
					<div class="form-check mb-2">
						<input class="form-check-input" type="checkbox" id="swalSaveSnapshot" ${rowCount > 0 ? 'checked' : 'disabled'}>
						<label class="form-check-label" for="swalSaveSnapshot">
							Lưu kèm dữ liệu snapshot hiện tại (${rowCount} dòng) để xem lại offline
						</label>
					</div>
				</div>
			`,
			showCancelButton: true,
			confirmButtonText: '💾 Lưu phiên',
			cancelButtonText: 'Hủy',
			focusConfirm: false,
			preConfirm: () => {
				const name = document.getElementById('swalSessionName').value.trim();
				const proc = document.getElementById('swalProcName').value.trim();
				const saveSnapshot = document.getElementById('swalSaveSnapshot').checked;
				if (!name) {
					Swal.showValidationMessage('Vui lòng nhập tên phiên!');
					return false;
				}
				return { name, proc, saveSnapshot };
			}
		}).then((result) => {
			if (result.isConfirmed) {
				const { name, proc, saveSnapshot } = result.value;
				const sessionId = "session_" + Date.now();
				const now = new Date();
				const yyyy = now.getFullYear();
				const mm = String(now.getMonth() + 1).padStart(2, '0');
				const dd = String(now.getDate()).padStart(2, '0');
				const createdDate = `${yyyy}-${mm}-${dd}`;
				const createdTime = now.toTimeString().split(' ')[0];

				const reportParams = {};
				parsedJasperParams.forEach(p => {
					const inputEl = document.getElementById(`jasper_param_${p.name}`);
					if (inputEl) {
						reportParams[p.name] = inputEl.value;
					}
				});

				const payload = {
					id: sessionId,
					name: name,
					jrxmlName: currentJrxmlName,
					jrxmlContent: uploadedJrxmlContent,
					procName: proc,
					sql: jasperSql,
					parameters: reportParams,
					siteKey: currentSiteKey,
					createdDate: createdDate,
					createdTime: createdTime,
					dataCount: rowCount,
					snapshotData: (saveSnapshot && lastRenderedJasperRows) ? JSON.stringify(lastRenderedJasperRows) : null
				};

				showLoading("Đang lưu phiên preview...");
				fetch("http://localhost:8080/save-session", {
					method: "POST",
					headers: { "Content-Type": "application/json; charset=utf-8" },
					body: JSON.stringify(payload)
				})
				.then(res => res.json())
				.then(resp => {
					hideLoading();
					if (resp && resp.success) {
						Swal.fire({
							icon: 'success',
							title: 'Đã lưu phiên preview!',
							text: `Phiên "${name}" đã được lưu thành công. Bạn có thể tìm lại trong tab "Phiên đã lưu".`,
							timer: 2000,
							showConfirmButton: false
						});
						loadJasperSessionsList();
					} else {
						throw new Error(resp?.error || "Lỗi lưu phiên");
					}
				})
				.catch(err => {
					hideLoading();
					Swal.fire({
						icon: 'error',
						title: 'Không thể lưu phiên',
						text: err.message
					});
				});
			}
		});
	});

	const sessionListEl = document.getElementById('jasperSessionList');
	if (sessionListEl) {
		sessionListEl.addEventListener('click', (e) => {
			const renderNewBtn = e.target.closest('.btn-session-render-new');
			if (renderNewBtn) {
				const id = renderNewBtn.getAttribute('data-session-id');
				if (id) executeRenderSessionNew(id);
				return;
			}
			const renderOldBtn = e.target.closest('.btn-session-render-old');
			if (renderOldBtn) {
				const id = renderOldBtn.getAttribute('data-session-id');
				if (id) executeRenderSessionOld(id);
				return;
			}
			const loadFormBtn = e.target.closest('.btn-session-load-form');
			if (loadFormBtn) {
				const id = loadFormBtn.getAttribute('data-session-id');
				if (id) executeLoadSessionToForm(id);
				return;
			}
			const deleteBtn = e.target.closest('.btn-session-delete');
			if (deleteBtn) {
				const id = deleteBtn.getAttribute('data-session-id');
				if (id) executeDeleteSession(id);
				return;
			}
		});
	}

	const sessionSearchInput = document.getElementById('jasperSessionSearch');
	const sessionDateSelect = document.getElementById('jasperSessionDateSelect');
	let searchDebounceTimer = null;

	if (sessionSearchInput) {
		sessionSearchInput.addEventListener('input', () => {
			clearTimeout(searchDebounceTimer);
			searchDebounceTimer = setTimeout(() => {
				loadJasperSessionsList(sessionSearchInput.value, sessionDateSelect?.value);
			}, 300);
		});
	}

	if (sessionDateSelect) {
		sessionDateSelect.addEventListener('change', () => {
			loadJasperSessionsList(sessionSearchInput?.value, sessionDateSelect.value);
		});
	}

	const btnRefreshSessions = document.getElementById('btnRefreshJasperSessions');
	if (btnRefreshSessions) {
		btnRefreshSessions.addEventListener('click', () => {
			loadJasperSessionsList(sessionSearchInput?.value, sessionDateSelect?.value);
		});
	}

	const tabSessionsBtn = document.getElementById('tab-jasper-sessions-btn');
	if (tabSessionsBtn) {
		tabSessionsBtn.addEventListener('shown.bs.tab', () => {
			loadJasperSessionsList(sessionSearchInput?.value, sessionDateSelect?.value);
		});
	}

	document.getElementById('btnJasperDownload').addEventListener('click', () => {
		if (!jasperPdfBlobUrl) return;
		const a = document.createElement('a');
		a.href = jasperPdfBlobUrl;
		a.download = "BaoCaoJasper.pdf";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	});

	const jModalEl = document.getElementById('jasperModal');
	jModalEl.addEventListener('hidden.bs.modal', () => {
		const iframe = document.getElementById('jasperIframe');
		const placeholder = document.getElementById('jasperPlaceholderText');
		if (iframe) {
			iframe.src = "";
			iframe.classList.add('d-none');
		}
		if (placeholder) {
			placeholder.classList.remove('d-none');
		}
		document.getElementById('btnJasperDownload')?.classList.add('d-none');
		document.getElementById('btnJasperSaveSession')?.classList.add('d-none');

		if (jasperPdfBlobUrl) {
			URL.revokeObjectURL(jasperPdfBlobUrl);
			jasperPdfBlobUrl = null;
		}

		const statusEl = document.getElementById('jasperStatus');
		if (statusEl) statusEl.innerText = "";
		const fileInput = document.getElementById('jasperFileInput');
		if (fileInput) fileInput.value = "";
		const badge = document.getElementById('jasperCurrentFileBadge');
		if (badge) badge.classList.add('d-none');
		document.getElementById('jasperParamsSection')?.classList.add('d-none');
		const paramsContainer = document.getElementById('jasperParamsContainer');
		if (paramsContainer) paramsContainer.innerHTML = "";
	});

	document.getElementById('btnViewLogs').addEventListener('click', () => {
		const modalEl = document.getElementById('logViewerModal');
		let bootstrapObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
		if (!bootstrapObj) return;

		let logModal = bootstrapObj.Modal.getInstance(modalEl) || new bootstrapObj.Modal(modalEl);
		logModal.show();

		const dateSelect = document.getElementById('logDateSelect');
		dateSelect.innerHTML = '<option value="">Đang tải...</option>';

		fetch("http://localhost:8080/list-logs")
			.then(res => res.json())
			.then(dates => {
				if (!dates || dates.length === 0) {
					dateSelect.innerHTML = '<option value="">Không có log nào</option>';
					document.getElementById('logViewerTableBody').innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Chưa có tệp nhật ký nào được ghi</td></tr>';
					return;
				}

				dates.sort((a, b) => {
					const parseDate = (dStr) => {
						const d = parseInt(dStr.substring(0, 2), 10);
						const m = parseInt(dStr.substring(2, 4), 10) - 1;
						const y = parseInt(dStr.substring(4, 8), 10);
						return new Date(y, m, d);
					};
					return parseDate(b) - parseDate(a);
				});

				let html = '';
				dates.forEach(d => {
					const formatted = `${d.substring(0, 2)}/${d.substring(2, 4)}/${d.substring(4, 8)}`;
					html += `<option value="${d}">${formatted}</option>`;
				});
				dateSelect.innerHTML = html;

				loadLogContent(dateSelect.value);
			})
			.catch(err => {
				dateSelect.innerHTML = '<option value="">Lỗi kết nối</option>';
				Swal.fire({
					icon: 'error',
					title: 'Không thể kết nối máy chủ',
					text: 'Vui lòng kiểm tra xem start.bat đã chạy chưa.'
				});
			});
	});

	document.getElementById('logDateSelect').addEventListener('change', (e) => {
		loadLogContent(e.target.value);
	});
	document.getElementById('logTypeFilter').addEventListener('change', renderFilteredLogs);

	const logTextSearch = document.getElementById('logTextSearch');
	if (logTextSearch) {
		logTextSearch.addEventListener('input', renderFilteredLogs);
	}

	const btnRefreshLogs = document.getElementById('btnRefreshLogs');
	if (btnRefreshLogs) {
		btnRefreshLogs.addEventListener('click', () => {
			const dateSelect = document.getElementById('logDateSelect');
			if (dateSelect && dateSelect.value) {
				loadLogContent(dateSelect.value);
			}
		});
	}
	// Gắn sự kiện cho các tính năng mới: Lưu kết quả & Quản lý bảng đã lưu
	const btnSaveResultTable = document.getElementById('btnSaveResultTable');
	if (btnSaveResultTable) {
		btnSaveResultTable.addEventListener('click', promptSaveCurrentResultTable);
	}

	const btnViewSavedTables = document.getElementById('btnViewSavedTables');
	if (btnViewSavedTables) {
		btnViewSavedTables.addEventListener('click', openSavedTablesModal);
	}

	const btnSaveCurrentToNewTableModal = document.getElementById('btnSaveCurrentToNewTableModal');
	if (btnSaveCurrentToNewTableModal) {
		btnSaveCurrentToNewTableModal.addEventListener('click', () => {
			hideModal('savedTablesModal');
			promptSaveCurrentResultTable();
		});
	}

	const btnCreateBlankTableModal = document.getElementById('btnCreateBlankTableModal');
	if (btnCreateBlankTableModal) {
		btnCreateBlankTableModal.addEventListener('click', openCreateBlankTablePrompt);
	}

	const searchSavedTableInput = document.getElementById('searchSavedTableInput');
	if (searchSavedTableInput) {
		searchSavedTableInput.addEventListener('input', (e) => {
			renderSavedTablesList(e.target.value);
		});
	}

	const btnSaveTableRowData = document.getElementById('btnSaveTableRowData');
	if (btnSaveTableRowData) {
		btnSaveTableRowData.addEventListener('click', saveTableRowFromModal);
	}

	// Gắn sự kiện cho Quản lý phiên làm việc (Sessions)
	const btnQuickSaveSession = document.getElementById('btnQuickSaveSession');
	if (btnQuickSaveSession) {
		btnQuickSaveSession.addEventListener('click', promptSaveCurrentSession);
	}

	const btnSessionManager = document.getElementById('btnSessionManager');
	if (btnSessionManager) {
		btnSessionManager.addEventListener('click', openSessionManagerModal);
	}

	const btnAddNewSessionModal = document.getElementById('btnAddNewSessionModal');
	if (btnAddNewSessionModal) {
		btnAddNewSessionModal.addEventListener('click', () => {
			hideModal('sessionManagerModal');
			addNewSession();
		});
	}

	const statusJasperHelper = document.getElementById('statusJasperHelper');
	if (statusJasperHelper) {
		statusJasperHelper.addEventListener('click', () => {
			checkAndStartJasperHelperUI(true);
		});
	}
}



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
        const storageTabs = {
            hung_yen: prepareTabsForStorage(tabsBySite.hung_yen),
            thai_binh: prepareTabsForStorage(tabsBySite.thai_binh)
        };

        await chrome.storage.local.set({ 
            sessionsBySite: storageSessions,
            currentSessionIdBySite: currentSessionIdBySite,
            tabsBySite: storageTabs 
        });

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
        if (err && (err.message?.includes('quota') || err.name === 'QuotaExceededError' || String(err).includes('kQuotaBytes'))) {
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
                const fallbackTabs = {
                    hung_yen: stripAllData(tabsBySite.hung_yen),
                    thai_binh: stripAllData(tabsBySite.thai_binh)
                };
                await chrome.storage.local.set({ 
                    sessionsBySite: fallbackSessions,
                    currentSessionIdBySite: currentSessionIdBySite,
                    tabsBySite: fallbackTabs 
                });
                console.log("[STORAGE] Đã dọn dẹp dữ liệu bảng tạm thời để giải phóng quota thành công.");
            } catch (e2) {
                console.error("[STORAGE] Lỗi nghiêm trọng khi lưu cấu trúc phiên:", e2);
            }
        }
    }
}

let executionTimerInterval = null;
let executionStartTime = 0;

function startExecutionTimer() {
	if (executionTimerInterval) clearInterval(executionTimerInterval);
	executionStartTime = performance.now();
	const timeEl = document.getElementById('executionTime');
	if (timeEl) {
		timeEl.className = "text-primary small fw-bold ms-auto";
		timeEl.innerText = "⏱️ 0.0s";
	}
	executionTimerInterval = setInterval(() => {
		if (!executionStartTime) return;
		const elapsed = (performance.now() - executionStartTime) / 1000;
		if (timeEl) {
			timeEl.innerText = `⏱️ ${elapsed.toFixed(1)}s`;
		}
	}, 100);
}

function stopExecutionTimer(isError = false) {
	if (executionTimerInterval) {
		clearInterval(executionTimerInterval);
		executionTimerInterval = null;
	}
	if (!executionStartTime) return;
	const duration = performance.now() - executionStartTime;
	executionStartTime = 0;

	let text = '';
	if (duration < 1000) {
		text = `⏱️ Thời gian: ${Math.round(duration)} ms`;
	} else {
		text = `⏱️ Thời gian: ${(duration / 1000).toFixed(2)} s`;
	}
	if (isError) {
		text += ' (Lỗi)';
	}

	const timeEl = document.getElementById('executionTime');
	if (timeEl) {
		timeEl.className = isError ? "text-danger small fw-bold ms-auto" : "text-secondary small fw-bold ms-auto";
		timeEl.innerText = text;
	}

	const currentTab = getCurrentTab();
	if (currentTab) {
		currentTab.executionTimeText = text;
		currentTab.executionTimeIsError = isError;
	}
}

async function executeWithPagination() {
	const statusEl = document.getElementById('status');
	const content = lastSql.trim();
	const upper = content.toUpperCase();
	const tab = getCurrentTab();

	const hasCreateOrReplace = /CREATE\s+(?:OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|PACKAGE|TRIGGER)\b/i.test(content) || /CREATE\s+OR\s+REPLACE/i.test(content);
	const isRawProcFunc = ((tab && tab.isProcFunc) || /^\s*(PROCEDURE|FUNCTION|PACKAGE|TRIGGER)\b/i.test(content)) && !hasCreateOrReplace;

	if (isRawProcFunc) {
		triggerRunProcFunc(content);
		return;
	}

	document.getElementById('btnExecute').disabled = true;

	const isNonQuery = /^\s*(UPDATE|INSERT|DELETE|MERGE)\b/i.test(content);
	if (isNonQuery) {
		const isUpdateOrDelete = /^\s*(UPDATE|DELETE)\b/i.test(content);
		if (isUpdateOrDelete) {
			const hasWhere = /\bWHERE\b/i.test(upper);
			if (!hasWhere) {
				document.getElementById('btnExecute').disabled = false;
				Swal.fire({
					icon: 'error',
					title: 'CẢNH BÁO NGUY HIỂM',
					text: 'Câu lệnh UPDATE/DELETE không có điều kiện WHERE! Để đảm bảo an toàn hệ thống, hành động này đã bị CHẶN HOÀN TOÀN.'
				});
				statusEl.className = "text-danger";
				statusEl.innerText = "❌ Lỗi: Lệnh UPDATE/DELETE không có WHERE bị chặn.";
				return;
			}
		}
		const result = await Swal.fire({
			title: 'Cảnh báo thực thi DML',
			text: 'Bạn đang thực hiện câu lệnh thay đổi dữ liệu (DML) và hệ thống sẽ tự động COMMIT. Bạn có chắc chắn muốn thực thi câu lệnh?',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Đồng ý',
			cancelButtonText: 'Hủy'
		});
		if (!result.isConfirmed) {
			document.getElementById('btnExecute').disabled = false;
			statusEl.className = "text-secondary";
			statusEl.innerText = "⚠️ Đã hủy thực thi câu lệnh.";
			return;
		}
	} else if (hasCreateOrReplace) {
		const result = await Swal.fire({
			title: 'Xác nhận biên dịch',
			text: 'Bạn có chắc chắn muốn biên dịch đối tượng này lên database?',
			icon: 'question',
			showCancelButton: true,
			confirmButtonText: 'Biên dịch',
			cancelButtonText: 'Hủy'
		});
		if (!result.isConfirmed) {
			document.getElementById('btnExecute').disabled = false;
			statusEl.className = "text-secondary";
			statusEl.innerText = "⚠️ Đã hủy biên dịch.";
			return;
		}
	}

	statusEl.className = "text-primary";
	statusEl.innerText = `⏳ Đang xử lý...`;
	showLoading("Đang thực thi câu lệnh SQL...");
	startExecutionTimer();

	if (hasCreateOrReplace ||
		content.includes('INS_CH_MENU') ||
		(content.startsWith('{') && content.includes('"TENCAUHINH"')) ||
		isNonQuery) {

		writeOperationLog("NON-QUERY", content);

		chrome.runtime.sendMessage({
			action: "call_sp_s",
			siteKey: currentSiteKey,
			params: extractSPSParams(content)
		}, handleResponseSP);

		return;
	}

	writeOperationLog("QUERY", content);

	currentQueryId++;
	const queryId = currentQueryId;
	isCountingRows = false;

	chrome.runtime.sendMessage({
		action: "execute_sql",
		sql: content,
		page: currentPage,
		pageSize: pageSize,
		siteKey: currentSiteKey
	}, (response) => handleResponseSQL(response, queryId, content));
}

function handleResponseSQL(response, queryId, sqlContent) {
	if (queryId && queryId !== currentQueryId) return;

	const isSuccess = Boolean(response && response.success);
	stopExecutionTimer(!isSuccess);
	hideLoading();
	document.getElementById('btnExecute').disabled = false;

	if (response && response.success) {

		currentData = Array.isArray(response.data) ? response.data : [];
		totalRows = (response.totalRows !== undefined && response.totalRows !== null) ? response.totalRows : null;

		let statusText = "";
		if (totalRows !== null) {
			statusText = `✅ Trang ${currentPage} - ${currentData.length} / ${totalRows.toLocaleString('vi-VN')} dòng`;
		} else {
			statusText = `✅ Trang ${currentPage} - Đã tải ${currentData.length} dòng`;
		}

		const currentTab = getCurrentTab();
		if (currentTab) {
			currentTab.data = currentData;
			currentTab.currentPage = currentPage;
			currentTab.totalRows = totalRows;
			currentTab.lastSql = lastSql;
			currentTab.statusText = statusText;
			currentTab.pageSize = pageSize;
		}

		const statusEl = document.getElementById('status');
		statusEl.className = "text-success";
		statusEl.innerText = statusText;

		renderTable(currentData);
		updatePaginationUI();
		saveTabs();

		const chkAutoCount = document.getElementById('chkAutoCount');
		const isAutoCount = chkAutoCount ? chkAutoCount.checked : (localStorage.getItem('auto_count_rows') !== 'false');
		if (totalRows === null && isAutoCount && currentData.length >= pageSize) {
			triggerCountSql(queryId, sqlContent || lastSql);
		}
	} else {
		isCountingRows = false;
		const errorText = "❌ " + (response?.error || "Lỗi không xác định");
		const statusEl = document.getElementById('status');
		statusEl.className = "text-danger";
		statusEl.innerText = errorText;

		const currentTab = getCurrentTab();
		if (currentTab) currentTab.statusText = errorText;

		renderTable([]);
		updatePaginationUI();
		saveTabs();
	}
}

function triggerCountSql(queryId = currentQueryId, sqlContent = lastSql) {
	if (!sqlContent || !sqlContent.trim()) return;
	isCountingRows = true;
	updatePaginationUI();

	chrome.runtime.sendMessage({
		action: "count_sql",
		sql: sqlContent.trim(),
		siteKey: currentSiteKey
	}, (countRes) => {
		if (queryId && queryId !== currentQueryId) return;
		isCountingRows = false;

		if (countRes && countRes.success && typeof countRes.totalRows === 'number') {
			totalRows = countRes.totalRows;
			const currentTab = getCurrentTab();
			if (currentTab) {
				currentTab.totalRows = totalRows;
				currentTab.statusText = `✅ Trang ${currentPage} - ${currentData.length} / ${totalRows.toLocaleString('vi-VN')} dòng`;
			}
			const statusEl = document.getElementById('status');
			if (statusEl) {
				statusEl.innerText = `✅ Trang ${currentPage} - ${currentData.length} / ${totalRows.toLocaleString('vi-VN')} dòng`;
			}
		}
		updatePaginationUI();
		saveTabs();
	});
}

function handleResponseSP(response) {
    if (!response?.success) {
        stopExecutionTimer(true);
    }
    hideLoading();
    document.getElementById('btnExecute').disabled = false;
    const statusEl = document.getElementById('status');

    if (response?.success) {
        const resultText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});

        if (resultText.includes("Thêm mới/ Cập nhật cấu hình thành công") || resultText.includes("thành công")) {
            Swal.fire({
                title: 'Thành công',
                text: 'Cập nhật cấu hình thành công!',
                icon: 'success',
                confirmButtonText: 'Đồng ý'
            });
            statusEl.className = "text-success";
            statusEl.innerText = "✅ Cập nhật cấu hình thành công";

            const currentContent = lastSql.toUpperCase();
            const isDML = /^\s*(UPDATE|INSERT|DELETE|MERGE)\b/i.test(lastSql);
            const isRawProcFunc = /^\s*(PROCEDURE|FUNCTION|PACKAGE|TRIGGER)\b/i.test(lastSql);
            if (currentContent.includes("CREATE OR REPLACE") || isDML || isRawProcFunc) {
                //const commitParams = ["DMC.CAPCUU", "123"];
                const commitParams = ["KIOSSS_CAPSO_UT", "123"];
                chrome.runtime.sendMessage({
                    action: "call_sp_s",
                    siteKey: currentSiteKey,
                    params: commitParams
                }, (commitResponse) => {
                    if (commitResponse?.success) {
                        statusEl.innerText = (isDML || isRawProcFunc)
                            ? "✅ Thực thi & Commit thành công! ✅" 
                            : statusEl.innerText + " & Đã gọi Commit thành công! ✅";
                    } else {
                        statusEl.innerText = (isDML || isRawProcFunc)
                            ? "❌ Lỗi thực thi/commit: " + commitResponse?.error + " ❌" 
                            : statusEl.innerText + " (Lỗi commit: " + commitResponse?.error + ") ❌";
                    }
                    const currentTab = getCurrentTab();
                    if (currentTab) currentTab.statusText = statusEl.innerText;
                    saveTabs();
                    stopExecutionTimer(!commitResponse?.success);
                });
            }
        } else {
            statusEl.className = "text-success";
            statusEl.innerText = "✅ Gọi SP_S thành công";
        }

        const currentTab = getCurrentTab();
        if (currentTab) currentTab.statusText = statusEl.innerText;

        const currentContent = lastSql.toUpperCase();
        const isDML = /^\s*(UPDATE|INSERT|DELETE|MERGE)\b/i.test(lastSql);
        const isRawProcFunc = /^\s*(PROCEDURE|FUNCTION|PACKAGE|TRIGGER)\b/i.test(lastSql);
        if (!currentContent.includes("CREATE OR REPLACE") && !isDML && !isRawProcFunc) {
            stopExecutionTimer(false);
        }
        renderTable([]);
        saveTabs();
    } else {
        const errorText = "❌ " + (response?.error || "Lỗi không xác định");
        statusEl.className = "text-danger";
        statusEl.innerText = errorText;

        const currentTab = getCurrentTab();
        if (currentTab) currentTab.statusText = errorText;
    }
}

function extractSPSParams(content) {
    if (content.startsWith('{') && content.endsWith('}')) {
        try {
            const obj = JSON.parse(content);
            if (obj.func === "ajaxCALL_SP_S" && Array.isArray(obj.params)) {
                return obj.params;
            }
        } catch (e) { }
    }

    let finalSql = content;
    const cleanContent = content.trim();
    const upperClean = cleanContent.toUpperCase();
    if (upperClean.startsWith("PROCEDURE") || 
        upperClean.startsWith("FUNCTION") || 
        upperClean.startsWith("PACKAGE") || 
        upperClean.startsWith("TRIGGER")) {
        finalSql = "CREATE OR REPLACE " + cleanContent;
    }

    const config = {
        TENCAUHINH: "MENU_TEST",
        MACAUHINH: "MENU_TEST",
        GIATRIMD: finalSql,
        GIATRITL: ""
    };

    return ["INS_CH_MENU", JSON.stringify(config)];
}

function updatePaginationUI() {
    const pageInfoEl = document.getElementById('pageInfo');
    if (!pageInfoEl) return;

    if (totalRows !== null && totalRows !== undefined) {
        const totalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 1;
        pageInfoEl.innerText = `Trang ${currentPage} / ${totalPages} (${totalRows.toLocaleString('vi-VN')} dòng)`;

        document.getElementById('btnFirst').disabled = currentPage <= 1;
        document.getElementById('btnPrev').disabled = currentPage <= 1;
        document.getElementById('btnNext').disabled = currentPage >= totalPages;
        document.getElementById('btnLast').disabled = currentPage >= totalPages;
    } else {
        const isAtLeast = (currentPage - 1) * pageSize + currentData.length;
        const countStatusHtml = isCountingRows
            ? `<span class="spinner-border spinner-border-sm text-primary ms-1" style="width: 0.85rem; height: 0.85rem;" role="status" title="Đang đếm ngầm tổng số dòng..."></span>`
            : `<button id="btnManualCount" class="btn btn-outline-secondary btn-sm py-0 px-1 ms-1" style="font-size: 11px; line-height: 1.2;" title="Bấm để đếm tổng số dòng">🔢 Đếm</button>`;

        pageInfoEl.innerHTML = `Trang ${currentPage} (≥ ${isAtLeast.toLocaleString('vi-VN')} dòng ${countStatusHtml})`;

        document.getElementById('btnFirst').disabled = currentPage <= 1;
        document.getElementById('btnPrev').disabled = currentPage <= 1;
        document.getElementById('btnNext').disabled = currentData.length < pageSize;
        document.getElementById('btnLast').disabled = true;

        const btnManual = document.getElementById('btnManualCount');
        if (btnManual) {
            btnManual.onclick = (e) => {
                e.stopPropagation();
                triggerCountSql();
            };
        }
    }
}

let currentTableData = [];

function renderTable(data) {
    currentTableData = Array.isArray(data) ? data : [];
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');

    thead.innerHTML = "";
    tbody.innerHTML = "";

    if (currentTableData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="100%" class="text-center text-muted py-4">Không có dữ liệu</td></tr>`;
        return;
    }

    const cols = Object.keys(currentTableData[0]);
    let headHtml = `<tr><th style="width:60px; text-align:center;">STT</th>`;

    cols.forEach(col => {
        headHtml += `
            <th data-col="${col}">
                ${col}
                <span class="sort-icon">↕</span>
                <input type="text" class="form-control form-control-sm column-filter mt-1" 
                       placeholder="Lọc ${col}" style="font-size:11px; padding:2px 4px;">
            </th>`;
    });
    thead.innerHTML = headHtml + `</tr>`;

    renderTableBody(currentTableData);
    attachTableEvents();
}

function renderTableBody(data) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = "";

    let displayData = data;
    let renderStart = (currentPage - 1) * pageSize;
    if (data.length > pageSize) {
        let start = (currentPage - 1) * pageSize;
        if (start >= data.length) {
            start = 0;
        }
        displayData = data.slice(start, start + pageSize);
        renderStart = start;
    }

    let rowsHtml = [];
    displayData.forEach((row, index) => {
        const actualIndex = renderStart + index;
        let tr = `<tr>`;
        tr += `<td style="text-align:center; font-weight:bold;">${actualIndex + 1}</td>`;

        Object.keys(row).forEach(key => {
            let val = row[key];

            if (typeof val === 'object' && val !== null) {
                val = JSON.stringify(val);
            } else if (val == null) {
                val = '';
            }

            let textStr = String(val);
            let escapedStr = textStr.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

            tr += `<td class="cell-copyable" data-content-raw="${escapedStr}" title="${escapedStr}">
                <span class="cell-text">${escapedStr}</span>
                <button class="btn btn-xs btn-light btn-copy-cell shadow-sm" style="display: none; position: absolute; right: 2px; top: 50%; transform: translateY(-50%); padding: 1px 4px; font-size: 10px; z-index: 10;" title="Copy">📋</button>
            </td>`;
        });
        rowsHtml.push(tr + `</tr>`);
    });
    tbody.innerHTML = rowsHtml.join('');
}

function attachTableEvents() {
    const table = document.getElementById('resultTable');
    const headers = table.querySelectorAll('thead th[data-col]');

    headers.forEach((th) => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return;

            const colName = th.getAttribute('data-col');
            const isAsc = !th.classList.contains('sort-asc');

            headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            th.classList.add(isAsc ? 'sort-asc' : 'sort-desc');

            currentTableData.sort((a, b) => {
                let valA = a[colName] ?? '';
                let valB = b[colName] ?? '';
                if (!isNaN(valA) && !isNaN(valB)) {
                    return isAsc ? valA - valB : valB - valA;
                }
                return isAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
            });

            renderTableBody(currentTableData);
        });
    });

    const filters = table.querySelectorAll('.column-filter');
    filters.forEach((input) => {
        input.addEventListener('keyup', () => {
            const filterValues = Array.from(filters).map(f => f.value.toLowerCase().trim());

            const filtered = currentTableData.filter(row => {
                return filterValues.every((filterText, i) => {
                    if (!filterText) return true;
                    const colName = headers[i].getAttribute('data-col');
                    const cellValue = String(row[colName] || '').toLowerCase();
                    return cellValue.includes(filterText);
                });
            });

            renderTableBody(filtered);
        });
    });
}

function cleanSql(sql) {
    return sql
        .replace(/--.*?(?=\r?$)/gm, "") 
        .replace(/^\s*[\r\n]/gm, "")
        .replace(/''/g, "'")
        .trim();
}

function formatDecodeToStyle(sql) {
	return sql.replace(/DECODE\s*\(([^)]+)\)/gi, (match, content) => {
		const parts = content.split(',');
		if (parts.length <= 3) return match;

		let formatted = "DECODE(";
		formatted += parts[0].trim() + ", " + parts[1].trim() + ",\n";

		const indent = " ".repeat(8);
		for (let i = 2; i < parts.length - 1; i++) {
			formatted += indent + parts[i].trim() + ",\n";
		}

		formatted += indent + parts[parts.length - 1].trim() + ")";
		return formatted;
	});
}

function removeVietnameseTones(str) {
	str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
	str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ẽ/g, "e");
	str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
	str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
	str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
	str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
	str = str.replace(/đ/g, "d");
	str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
	str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
	str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
	str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
	str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
	str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
	str = str.replace(/Đ/g, "D");
	str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, "");
	str = str.replace(/\u02C6|\u0306|\u031B/g, "");
	str = str.replace(/ + /g, " ");
	return str.trim();
}

function getUnitStorageKey(type) {
	return `his_unit_${type}_${currentSiteKey}`;
}

function getLastUnitSearch() {
	try {
		const raw = localStorage.getItem(getUnitStorageKey('last_search'));
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && Array.isArray(parsed.units)) {
				parsed.units = parsed.units.map(item => ({
					name: (item.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim(),
					csytid: String(item.csytid || ''),
					schema: String(item.schema || '')
				}));
				if (parsed.query && typeof parsed.query === 'string') {
					parsed.query = parsed.query.replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
				}
				return parsed;
			}
		}
	} catch (e) {
		console.error("Error reading last unit search:", e);
	}
	return null;
}

function saveLastUnitSearch(query, units) {
	if (!units || units.length === 0) return;
	try {
		const cleanQuery = (query || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
		const data = {
			query: cleanQuery,
			timestamp: Date.now(),
			units: units.slice(0, 15).map(item => ({
				name: (item.name || item['Kh\u00E1ch h\u00E0ng'] || item['Khach hang'] || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim(),
				csytid: String(item.csytid || item['CSYTID'] || ''),
				schema: String(item.schema || item['Schema'] || '')
			}))
		};
		localStorage.setItem(getUnitStorageKey('last_search'), JSON.stringify(data));
	} catch (e) {
		console.error("Error saving last unit search:", e);
	}
}

function getRecentSelectedUnits() {
	try {
		const raw = localStorage.getItem(getUnitStorageKey('recent_selected'));
		if (raw) {
			const list = JSON.parse(raw);
			if (Array.isArray(list)) {
				return list.map(item => ({
					name: (item.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim(),
					csytid: String(item.csytid || ''),
					schema: String(item.schema || ''),
					timestamp: item.timestamp
				}));
			}
		}
	} catch (e) {
		console.error("Error reading recent selected units:", e);
	}
	return [];
}

function saveRecentSelectedUnit(name, csytid, schema) {
	if (!csytid) return;
	try {
		const cleanName = (name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
		let list = getRecentSelectedUnits();
		list = list.filter(item => String(item.csytid) !== String(csytid));
		list.unshift({ name: cleanName, csytid: String(csytid), schema: String(schema || ''), timestamp: Date.now() });
		if (list.length > 12) list = list.slice(0, 12);
		localStorage.setItem(getUnitStorageKey('recent_selected'), JSON.stringify(list));
	} catch (e) {
		console.error("Error saving recent selected unit:", e);
	}
}

function clearRecentSearchUnits() {
	try {
		localStorage.removeItem(getUnitStorageKey('last_search'));
		localStorage.removeItem(getUnitStorageKey('recent_selected'));
	} catch (e) {}
}

function getUnitsForRecentDisplay() {
	const lastSearch = getLastUnitSearch();
	const recentSelected = getRecentSelectedUnits();

	const combined = [];
	const seen = new Set();

	if (lastSearch && Array.isArray(lastSearch.units)) {
		lastSearch.units.forEach(u => {
			const cleanName = (u.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
			if (u && u.csytid && !seen.has(String(u.csytid))) {
				seen.add(String(u.csytid));
				combined.push({
					name: cleanName,
					csytid: u.csytid,
					schema: u.schema,
					isFromLastSearch: true
				});
			}
		});
	}

	recentSelected.forEach(u => {
		const cleanName = (u.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
		if (u && u.csytid && !seen.has(String(u.csytid))) {
			seen.add(String(u.csytid));
			combined.push({
				name: cleanName,
				csytid: u.csytid,
				schema: u.schema,
				isFromLastSearch: false
			});
		}
	});

	const hasHistory = combined.length > 0;

	// Fallback to top 6 units of current site so user ALWAYS sees quick select units
	if (combined.length === 0 && sitesData) {
		const sheetName = currentSiteKey === 'hung_yen' ? 'bvhungyen' : 'bvthaibinh';
		const list = sitesData[sheetName] || [];
		list.slice(0, 6).forEach(u => {
			const name = (u.name || u['Kh\u00E1ch h\u00E0ng'] || u['Khach hang'] || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
			const csytid = String(u.csytid || u['CSYTID'] || '');
			const schema = String(u.schema || u['Schema'] || '');
			if (csytid && !seen.has(csytid)) {
				seen.add(csytid);
				combined.push({
					name, csytid, schema, isFromLastSearch: false
				});
			}
		});
	}

	return {
		hasHistory,
		query: lastSearch ? lastSearch.query : '',
		units: combined
	};
}

function isHidParam(name) {
	const s = (name || '').trim().toUpperCase();
	return s === 'I_HID' || s === 'P_HID' || s === 'HID' || s === 'I_CSYTID' || s === 'P_CSYTID' || s === 'CSYTID' || s === 'IHID' || s === 'PHID';
}

function isSchParam(name) {
	const s = (name || '').trim().toUpperCase();
	return s === 'I_SCH' || s === 'P_SCH' || s === 'SCH' || s === 'SCHEMA' || s === 'I_SCHEMA' || s === 'P_SCHEMA' || s === 'ISCH' || s === 'PSCH';
}

function fillUnitIntoParams(csytid, schema, name) {
	if (!csytid && !schema && !name) return 0;
	let cleanName = (name || '').replace(/^[ðŸ\s•’¢\?]+/, '').trim();

	// Auto lookup missing csytid or schema from sitesData if needed
	if ((!csytid || !schema || schema === 'undefined' || csytid === 'undefined') && sitesData) {
		const sheetName = currentSiteKey === 'hung_yen' ? 'bvhungyen' : 'bvthaibinh';
		const list = sitesData[sheetName] || [];
		const found = list.find(u => {
			const uId = String(u.csytid || u['CSYTID'] || '');
			const uName = String(u.name || u['Kh\u00E1ch h\u00E0ng'] || u['Khach hang'] || '');
			return (csytid && csytid !== 'undefined' && uId === String(csytid)) || (cleanName && uName.toLowerCase().includes(cleanName.toLowerCase()));
		});
		if (found) {
			if (!csytid || csytid === 'undefined') csytid = String(found.csytid || found['CSYTID'] || '');
			if (!schema || schema === 'undefined') schema = String(found.schema || found['Schema'] || '');
			if (!cleanName) cleanName = String(found.name || found['Kh\u00E1ch h\u00E0ng'] || found['Khach hang'] || '');
		}
	}

	// 1. Update unit search input in modal to show selected unit name
	const unitInput = document.getElementById('unitSearchInput');
	if (unitInput && cleanName) {
		unitInput.value = cleanName;
	}

	// 2. Query all param fields in the modal (#runProcFuncParamsContainer)
	const fields = document.querySelectorAll('#runProcFuncParamsContainer .run-param-field, #runProcFuncParamsContainer tr, #runProcFuncParamsContainer .form-group, #runProcFuncParamsContainer .mb-2');
	let filledCount = 0;

	fields.forEach(field => {
		const argNameAttr = field.getAttribute('data-arg-name') || '';
		const labelEl = field.querySelector('label');
		const labelText = labelEl ? (labelEl.querySelector('span')?.innerText || labelEl.childNodes[0]?.textContent || labelEl.innerText) : '';
		const paramName = (argNameAttr || labelText).trim().toUpperCase();

		const inputEl = field.querySelector('.run-param-input, .proc-param-input, input[type="text"], input:not([type="hidden"])');
		if (inputEl) {
			if (isHidParam(paramName)) {
				inputEl.value = csytid || '';
				inputEl.dispatchEvent(new Event('input', { bubbles: true }));
				inputEl.dispatchEvent(new Event('change', { bubbles: true }));
				inputEl.classList.add('bg-warning-subtle', 'border-warning');
				setTimeout(() => inputEl.classList.remove('bg-warning-subtle', 'border-warning'), 1500);
				filledCount++;
			} else if (isSchParam(paramName)) {
				inputEl.value = schema || '';
				inputEl.dispatchEvent(new Event('input', { bubbles: true }));
				inputEl.dispatchEvent(new Event('change', { bubbles: true }));
				inputEl.classList.add('bg-warning-subtle', 'border-warning');
				setTimeout(() => inputEl.classList.remove('bg-warning-subtle', 'border-warning'), 1500);
				filledCount++;
			}
		}
	});

	// Direct input scan fallback if no container matched
	if (filledCount === 0) {
		const allInputs = document.querySelectorAll('#runProcFuncParamsContainer input');
		allInputs.forEach(inputEl => {
			const parent = inputEl.closest('.run-param-field') || inputEl.parentElement;
			const pName = (parent?.getAttribute('data-arg-name') || inputEl.name || inputEl.id || '').toUpperCase();
			if (isHidParam(pName)) {
				inputEl.value = csytid || '';
				inputEl.dispatchEvent(new Event('input', { bubbles: true }));
				inputEl.classList.add('bg-warning-subtle', 'border-warning');
				setTimeout(() => inputEl.classList.remove('bg-warning-subtle', 'border-warning'), 1500);
				filledCount++;
			} else if (isSchParam(pName)) {
				inputEl.value = schema || '';
				inputEl.dispatchEvent(new Event('input', { bubbles: true }));
				inputEl.classList.add('bg-warning-subtle', 'border-warning');
				setTimeout(() => inputEl.classList.remove('bg-warning-subtle', 'border-warning'), 1500);
				filledCount++;
			}
		});
	}

	saveRecentSelectedUnit(cleanName, csytid, schema);
	renderRecentUnitsUI();
	return filledCount;
}

let sidebarSelectUnitFn = null;

function renderRecentUnitsUI() {
	const data = getUnitsForRecentDisplay();

	// 1. Render in Modal
	const container = document.getElementById('unitRecentSearchSection');
	const badgesContainer = document.getElementById('unitRecentBadgesContainer');
	const titleEl = document.getElementById('unitRecentSearchTitle');

	if (container && badgesContainer) {
		if (titleEl) {
			if (data.query) {
				titleEl.innerHTML = `\u{1F552} \u0110\u01A1n v\u1ECB c\u1EE7a l\u1EA7n t\u00ECm ki\u1EBFm g\u1EA7n nh\u1EA5t <em>("${data.query}")</em>:`;
			} else if (data.hasHistory) {
				titleEl.innerText = `\u{1F552} \u0110\u01A1n v\u1ECB c\u1EE7a l\u1EA7n t\u00ECm ki\u1EBFm g\u1EA7n nh\u1EA5t:`;
			} else {
				titleEl.innerText = `\u{1F552} \u0110\u01A1n v\u1ECB g\u1EA7n \u0111\u00E2y / g\u1EE3i \u00FD nhanh:`;
			}
		}

		const currentInputVal = (document.getElementById('unitSearchInput')?.value || '').trim();
		let html = '';
		data.units.forEach(unit => {
			const cleanName = (unit.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
			const isSelected = currentInputVal && currentInputVal === cleanName;
			const btnClass = isSelected ? 'btn-primary text-white active' : 'btn-outline-primary';
			html += `
			<button type="button" 
				class="btn btn-sm ${btnClass} py-0 px-2 recent-unit-badge d-inline-flex align-items-center gap-1" 
				style="font-size: 11px; height: 24px; border-radius: 12px; max-width: 100%;" 
				data-name="${cleanName}" 
				data-csytid="${unit.csytid}" 
				data-schema="${unit.schema}"
				title="\u0110\u01A1n v\u1ECB: ${cleanName}&#10;CSYTID: ${unit.csytid}&#10;Schema: ${unit.schema}">
				<span class="text-truncate" style="max-width: 180px;">\u{1F3E2} ${cleanName}</span>
				<span class="badge ${isSelected ? 'bg-light text-dark' : 'bg-secondary'} font-monospace" style="font-size: 9px;">${unit.csytid}</span>
			</button>`;
		});
		badgesContainer.innerHTML = html;

		badgesContainer.querySelectorAll('.recent-unit-badge').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const name = btn.getAttribute('data-name');
				const csytid = btn.getAttribute('data-csytid');
				const schema = btn.getAttribute('data-schema');
				fillUnitIntoParams(csytid, schema, name);
			});
		});
	}

	// 2. Render in Collapsed Sidebar Search Panel
	const collapsedBadges = document.getElementById('sidebarCollapsedRecentBadges');
	if (collapsedBadges) {
		let colHtml = '';
		data.units.forEach(unit => {
			const cleanName = (unit.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
			colHtml += `
			<button type="button" 
				class="btn btn-sm btn-outline-primary py-0 px-2 recent-unit-badge d-inline-flex align-items-center gap-1" 
				style="font-size: 10.5px; height: 22px; border-radius: 11px; max-width: 100%;" 
				data-name="${cleanName}" 
				data-csytid="${unit.csytid}" 
				data-schema="${unit.schema}"
				title="\u0110\u01A1n v\u1ECB: ${cleanName}&#10;CSYTID: ${unit.csytid}&#10;Schema: ${unit.schema}">
				<span class="text-truncate" style="max-width: 160px;">\u{1F3E2} ${cleanName}</span>
			</button>`;
		});
		collapsedBadges.innerHTML = colHtml;
		collapsedBadges.querySelectorAll('.recent-unit-badge').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const name = btn.getAttribute('data-name');
				const csytid = btn.getAttribute('data-csytid');
				const schema = btn.getAttribute('data-schema');
				if (typeof sidebarSelectUnitFn === 'function') {
					sidebarSelectUnitFn(name, csytid, schema);
				}
				const colPanel = document.getElementById('sidebarCollapsedSearchPanel');
				if (colPanel) colPanel.style.display = 'none';
			});
		});
	}

	// 3. Render in Expanded Sidebar
	const expandedBadges = document.getElementById('sidebarExpandedRecentBadges');
	if (expandedBadges) {
		let expHtml = '';
		data.units.forEach(unit => {
			const cleanName = (unit.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
			expHtml += `
			<button type="button" 
				class="btn btn-sm btn-outline-primary py-0 px-2 recent-unit-badge d-inline-flex align-items-center gap-1" 
				style="font-size: 10.5px; height: 22px; border-radius: 11px; max-width: 100%;" 
				data-name="${cleanName}" 
				data-csytid="${unit.csytid}" 
				data-schema="${unit.schema}"
				title="\u0110\u01A1n v\u1ECB: ${cleanName}&#10;CSYTID: ${unit.csytid}&#10;Schema: ${unit.schema}">
				<span class="text-truncate" style="max-width: 160px;">\u{1F3E2} ${cleanName}</span>
			</button>`;
		});
		expandedBadges.innerHTML = expHtml;
		expandedBadges.querySelectorAll('.recent-unit-badge').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const name = btn.getAttribute('data-name');
				const csytid = btn.getAttribute('data-csytid');
				const schema = btn.getAttribute('data-schema');
				if (typeof sidebarSelectUnitFn === 'function') {
					sidebarSelectUnitFn(name, csytid, schema);
				}
			});
		});
	}
}

function initUnitSearchDropdown() {
	const input = document.getElementById('unitSearchInput');
	const menu = document.getElementById('unitDropdownMenu');
	const clearBtn = document.getElementById('btnClearRecentUnits');
	if (!input || !menu) return;

	if (clearBtn) {
		clearBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			clearRecentSearchUnits();
			renderRecentUnitsUI();
			if (!input.value) {
				menu.style.display = 'none';
			}
		});
	}

	function renderOptions(query = '') {
		const sheetName = currentSiteKey === 'hung_yen' ? 'bvhungyen' : 'bvthaibinh';
		const list = sitesData[sheetName] || [];
		const recentData = getUnitsForRecentDisplay();

		let filtered = list;
		if (query) {
			const cleanQuery = removeVietnameseTones(query).toLowerCase();
			filtered = list.filter(item => {
				const name = removeVietnameseTones(item.name || item['Kh\u00E1ch h\u00E0ng'] || item['Khach hang'] || '').toLowerCase();
				const csytid = (item.csytid || item['CSYTID'] || '').toLowerCase();
				const schema = (item.schema || item['Schema'] || '').toLowerCase();
				return name.includes(cleanQuery) || csytid.includes(cleanQuery) || schema.includes(cleanQuery);
			});

			if (filtered.length > 0 && query.trim().length >= 1) {
				saveLastUnitSearch(query.trim(), filtered);
				renderRecentUnitsUI();
			}
		}

		if (filtered.length === 0) {
			menu.innerHTML = '<div class="dropdown-item text-muted">Kh\u00F4ng t\u00ECm th\u1EA5y \u0111\u01A1n v\u1ECB n\u00E0o</div>';
			menu.style.display = 'block';
			return;
		}

		let html = '';

		if (!query && recentData.units && recentData.units.length > 0) {
			const headerTitle = recentData.query 
				? `\u{1F552} C\u00C1C \u0110\u01A0N V\u1ECA C\u1EE6A L\u1EA6N T\u00CCM KI\u1EBEM G\u1EA6N NH\u1EA4T ("${recentData.query}")`
				: `\u{1F552} C\u00C1C \u0110\u01A0N V\u1ECA C\u1EE6A L\u1EA6N T\u00CCM KI\u1EBEM G\u1EA6N NH\u1EA4T`;

			html += `<div class="dropdown-header text-primary fw-bold py-1 px-3 d-flex justify-content-between align-items-center" style="font-size: 11px; background-color: rgba(13, 110, 253, 0.08);">
				<span>${headerTitle}</span>
				<span class="badge bg-primary text-white" style="font-size: 9px;">${recentData.units.length} \u0111\u01A1n v\u1ECB</span>
			</div>`;

			recentData.units.forEach(item => {
				const displayName = (item.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
				const csytid = item.csytid;
				const schema = item.schema;
				html += `<button type="button" class="dropdown-item text-start d-flex justify-content-between align-items-center" data-name="${displayName}" data-csytid="${csytid}" data-schema="${schema}">
					<span class="text-truncate fw-semibold" style="max-width: 250px;">\u{1F552} ${displayName}</span>
					<span class="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace ms-2" style="font-size: 10px;">ID: ${csytid} | ${schema}</span>
				</button>`;
			});

			html += `<hr class="dropdown-divider my-1">`;
			html += `<div class="dropdown-header text-muted fw-bold py-1 px-3" style="font-size: 11px;">
				\u{1F3E2} T\u1EA4T C\u1EA2 \u0110\u01A0N V\u1ECA (${list.length})
			</div>`;
		}

		filtered.forEach(item => {
			const displayName = (item.name || item['Kh\u00E1ch h\u00E0ng'] || item['Khach hang'] || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
			const csytid = item.csytid || item['CSYTID'] || '';
			const schema = item.schema || item['Schema'] || '';
			html += `<button type="button" class="dropdown-item text-start d-flex justify-content-between align-items-center" data-name="${displayName}" data-csytid="${csytid}" data-schema="${schema}">
				<span class="text-truncate" style="max-width: 260px;">${displayName}</span>
				<span class="badge bg-light text-dark font-monospace ms-2" style="font-size: 10px;">ID: ${csytid} | ${schema}</span>
			</button>`;
		});
		menu.innerHTML = html;
		menu.style.display = 'block';

		const buttons = menu.querySelectorAll('.dropdown-item');
		buttons.forEach(btn => {
			btn.addEventListener('click', () => {
				const name = btn.getAttribute('data-name');
				const csytid = btn.getAttribute('data-csytid');
				const schema = btn.getAttribute('data-schema');

				menu.style.display = 'none';
				fillUnitIntoParams(csytid, schema, name);
			});
		});
	}

	input.addEventListener('focus', () => {
		renderOptions(input.value);
	});

	input.addEventListener('input', () => {
		renderOptions(input.value);
	});

	document.addEventListener('click', (e) => {
		if (!input.contains(e.target) && !menu.contains(e.target)) {
			menu.style.display = 'none';
		}
	});

	renderRecentUnitsUI();
}

function initSidebarUnitSearchDropdown() {
	const input = document.getElementById('sidebarUnitSearchInput');
	const menu = document.getElementById('sidebarUnitDropdownMenu');
	const info = document.getElementById('sidebarUnitInfo');
	const idEl = document.getElementById('sidebarUnitID');
	const schemaEl = document.getElementById('sidebarUnitSchema');
	const copyIDBtn = document.getElementById('btnCopyID');
	const copySchemaBtn = document.getElementById('btnCopySchema');
	const replaceBtn = document.getElementById('btnReplaceSqlPlaceholders');

	const collapsedSearchBtn = document.getElementById('btnCollapsedSearchUnit');
	const collapsedPanel = document.getElementById('sidebarCollapsedSearchPanel');
	const collapsedInput = document.getElementById('sidebarCollapsedUnitSearchInput');
	const collapsedMenu = document.getElementById('sidebarCollapsedUnitDropdownMenu');
	const collapsedCopyIDBtn = document.getElementById('btnCollapsedCopyID');
	const collapsedCopySchemaBtn = document.getElementById('btnCollapsedCopySchema');
	const collapsedReplaceBtn = document.getElementById('btnCollapsedReplaceSql');

	if (!input || !menu || !info || !idEl || !schemaEl) return;

	let selectedUnit = null;

	function selectUnit(name, csytid, schema) {
		const cleanName = (name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
		selectedUnit = { name: cleanName, csytid, schema };
		if (typeof saveRecentSelectedUnit === 'function') {
			saveRecentSelectedUnit(cleanName, csytid, schema);
			renderRecentUnitsUI();
		}

		input.value = cleanName;
		idEl.innerText = csytid;
		schemaEl.innerText = schema;
		info.style.display = 'block';

		collapsedInput.value = cleanName;
		collapsedCopyIDBtn.disabled = false;
		collapsedCopySchemaBtn.disabled = false;
		collapsedReplaceBtn.disabled = false;

		collapsedSearchBtn.setAttribute('title', `\u0110\u01A1n v\u1ECB: ${cleanName}`);
		collapsedCopyIDBtn.setAttribute('title', `Copy CSYTID: ${csytid} (${cleanName})`);
		collapsedCopySchemaBtn.setAttribute('title', `Copy Schema: ${schema} (${cleanName})`);
	}

	sidebarSelectUnitFn = selectUnit;

	function resetSelection() {
		selectedUnit = null;

		input.value = '';
		info.style.display = 'none';
		idEl.innerText = '';
		schemaEl.innerText = '';

		collapsedInput.value = '';
		collapsedCopyIDBtn.disabled = true;
		collapsedCopySchemaBtn.disabled = true;
		collapsedReplaceBtn.disabled = true;
		collapsedPanel.style.display = 'none';

		collapsedSearchBtn.setAttribute('title', 'Ch\u1ECDn \u0110\u01A1n v\u1ECB');
		collapsedCopyIDBtn.setAttribute('title', 'Copy CSYTID');
		collapsedCopySchemaBtn.setAttribute('title', 'Copy Schema');
	}

	function renderOptions(query, isCollapsed) {
		const sheetName = currentSiteKey === 'hung_yen' ? 'bvhungyen' : 'bvthaibinh';
		const list = sitesData[sheetName] || [];
		const targetMenu = isCollapsed ? collapsedMenu : menu;
		const recentData = getUnitsForRecentDisplay();

		let filtered = list;
		if (query) {
			const cleanQuery = removeVietnameseTones(query).toLowerCase();
			filtered = list.filter(item => {
				const name = removeVietnameseTones(item.name || item['Kh\u00E1ch h\u00E0ng'] || item['Khach hang'] || '').toLowerCase();
				const csytid = (item.csytid || item['CSYTID'] || '').toLowerCase();
				const schema = (item.schema || item['Schema'] || '').toLowerCase();
				return name.includes(cleanQuery) || csytid.includes(cleanQuery) || schema.includes(cleanQuery);
			});

			if (filtered.length > 0 && query.trim().length >= 1) {
				saveLastUnitSearch(query.trim(), filtered);
				renderRecentUnitsUI();
			}
		}

		if (filtered.length === 0) {
			targetMenu.innerHTML = '<div class="dropdown-item text-muted">Kh\u00F4ng t\u00ECm th\u1EA5y \u0111\u01A1n v\u1ECB n\u00E0o</div>';
			targetMenu.style.display = 'block';
			return;
		}

		let html = '';

		if (!query && recentData.units && recentData.units.length > 0) {
			const headerTitle = recentData.query 
				? `\u{1F552} C\u00C1C \u0110\u01A0N V\u1ECA C\u1EE6A L\u1EA6N T\u00CCM KI\u1EBEM G\u1EA6N NH\u1EA4T ("${recentData.query}")`
				: `\u{1F552} C\u00C1C \u0110\u01A0N V\u1ECA C\u1EE6A L\u1EA6N T\u00CCM KI\u1EBEM G\u1EA6N NH\u1EA4T`;

			html += `<div class="dropdown-header text-primary fw-bold py-1 px-2" style="font-size: 11px; background-color: rgba(13, 110, 253, 0.08);">
				<span>${headerTitle}</span>
			</div>`;

			recentData.units.forEach(item => {
				const displayName = (item.name || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
				const csytid = item.csytid;
				const schema = item.schema;
				html += `<button type="button" class="dropdown-item text-start d-flex justify-content-between align-items-center" data-name="${displayName}" data-csytid="${csytid}" data-schema="${schema}">
					<span class="text-truncate fw-semibold" style="max-width: 170px;">\u{1F552} ${displayName}</span>
					<span class="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace" style="font-size: 9px;">${csytid}</span>
				</button>`;
			});

			html += `<hr class="dropdown-divider my-1">`;
			html += `<div class="dropdown-header text-muted fw-bold py-1 px-2" style="font-size: 11px;">
				\u{1F3E2} T\u1EA4T C\u1EA2 \u0110\u01A0N V\u1ECA (${list.length})
			</div>`;
		}

		filtered.forEach(item => {
			const displayName = (item.name || item['Kh\u00E1ch h\u00E0ng'] || item['Khach hang'] || '').replace(/^[Ã°Å¸\sâ€¢â€™Â¢\?]+/, '').trim();
			const csytid = item.csytid || item['CSYTID'] || '';
			const schema = item.schema || item['Schema'] || '';
			html += `<button type="button" class="dropdown-item text-start d-flex justify-content-between align-items-center" data-name="${displayName}" data-csytid="${csytid}" data-schema="${schema}">
				<span class="text-truncate" style="max-width: 170px;">${displayName}</span>
				<span class="badge bg-light text-dark font-monospace" style="font-size: 9px;">${csytid}</span>
			</button>`;
		});
		targetMenu.innerHTML = html;
		targetMenu.style.display = 'block';

		const buttons = targetMenu.querySelectorAll('.dropdown-item');
		buttons.forEach(btn => {
			btn.addEventListener('click', () => {
				const name = btn.getAttribute('data-name');
				const csytid = btn.getAttribute('data-csytid');
				const schema = btn.getAttribute('data-schema');

				selectUnit(name, csytid, schema);
				targetMenu.style.display = 'none';
				if (isCollapsed) {
					collapsedPanel.style.display = 'none';
				}
			});
		});
	}

	input.addEventListener('focus', () => {
		renderOptions(input.value, false);
	});

	input.addEventListener('input', () => {
		renderOptions(input.value, false);
	});

	collapsedInput.addEventListener('focus', () => {
		renderOptions(collapsedInput.value, true);
	});

	collapsedInput.addEventListener('input', () => {
		renderOptions(collapsedInput.value, true);
	});

	collapsedSearchBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const isDisp = collapsedPanel.style.display === 'block';
		if (isDisp) {
			collapsedPanel.style.display = 'none';
		} else {
			renderRecentUnitsUI();
			const rect = collapsedSearchBtn.getBoundingClientRect();
			collapsedPanel.style.top = `${rect.top}px`;
			collapsedPanel.style.left = `${rect.right + 8}px`;
			collapsedPanel.style.display = 'block';
			collapsedInput.focus();
			renderOptions(collapsedInput.value, true);
		}
	});

	window.addEventListener('resize', () => {
		collapsedPanel.style.display = 'none';
	});

	document.addEventListener('click', (e) => {
		if (!input.contains(e.target) && !menu.contains(e.target)) {
			menu.style.display = 'none';
		}
		if (!collapsedSearchBtn.contains(e.target) && !collapsedPanel.contains(e.target)) {
			collapsedPanel.style.display = 'none';
		}
	});

	function executeCopy(text, btn1, btn2) {
		navigator.clipboard.writeText(text).then(() => {
			const orig1 = btn1.innerText;
			const orig2 = btn2.innerText;
			btn1.innerText = '\u2705';
			btn2.innerText = '\u2705';
			setTimeout(() => {
				btn1.innerText = orig1;
				btn2.innerText = orig2;
			}, 1000);
		});
	}

	copyIDBtn.addEventListener('click', () => {
		if (selectedUnit && selectedUnit.csytid) {
			executeCopy(selectedUnit.csytid, copyIDBtn, collapsedCopyIDBtn);
		}
	});

	collapsedCopyIDBtn.addEventListener('click', () => {
		if (selectedUnit && selectedUnit.csytid) {
			executeCopy(selectedUnit.csytid, copyIDBtn, collapsedCopyIDBtn);
		}
	});

	copySchemaBtn.addEventListener('click', () => {
		if (selectedUnit && selectedUnit.schema) {
			executeCopy(selectedUnit.schema, copySchemaBtn, collapsedCopySchemaBtn);
		}
	});

	collapsedCopySchemaBtn.addEventListener('click', () => {
		if (selectedUnit && selectedUnit.schema) {
			executeCopy(selectedUnit.schema, copySchemaBtn, collapsedCopySchemaBtn);
		}
	});

	function executeReplace() {
		if (!selectedUnit || !editor) return;

		const selection = editor.getSelection();
		let content = editor.getModel().getValueInRange(selection);
		let isSelection = true;
		if (!content) {
			content = editor.getValue();
			isSelection = false;
		}

		if (!content) {
			Swal.fire({
				icon: 'warning',
				title: 'Thông báo',
				text: 'Vui lòng nhập nội dung SQL vào editor!'
			});
			return;
		}

		const csytid = selectedUnit.csytid;
		const schema = selectedUnit.schema;

		let sql = content;

		const p1_hid = /'''\s*\|\|\s*i_hid\s*\|\|\s*'''/gi;
		const p1_sch = /'''\s*\|\|\s*i_sch\s*\|\|\s*'''/gi;
		sql = sql.replace(p1_hid, `'${csytid}'`).replace(p1_sch, `'${schema}'`);

		const p2_hid = /'\s*\|\|\s*i_hid\s*\|\|\s*'/gi;
		const p2_sch = /'\s*\|\|\s*i_sch\s*\|\|\s*'/gi;
		sql = sql.replace(p2_hid, csytid).replace(p2_sch, schema);

		const p3_hid = /\|\|\s*i_hid\s*\|\|/gi;
		const p3_sch = /\|\|\s*i_sch\s*\|\|/gi;
		sql = sql.replace(p3_hid, csytid).replace(p3_sch, schema);

		const p4_hid = /\|\|\s*i_hid\b/gi;
		const p4_sch = /\|\|\s*i_sch\b/gi;
		sql = sql.replace(p4_hid, csytid).replace(p4_sch, schema);

		const p5_hid = /\bi_hid\s*\|\|/gi;
		const p5_sch = /\bi_sch\s*\|\|/gi;
		sql = sql.replace(p5_hid, csytid).replace(p5_sch, schema);

		const p6_hid = /\bi_hid\b/gi;
		const p6_sch = /\bi_sch\b/gi;
		sql = sql.replace(p6_hid, csytid).replace(p6_sch, schema);

		const range = isSelection ? selection : editor.getModel().getFullModelRange();
		editor.executeEdits("replace-placeholders", [{
			range: range,
			text: sql,
			forceMoveMarkers: true
		}]);

		const statusEl = document.getElementById('status');
		if (statusEl) {
			statusEl.className = "text-success";
			statusEl.innerText = "✅ Đã thay thế I_HID, I_SCH trong SQL thành công";
		}
	}

	function fetchAndShowJasperLogs() {
		fetch("http://localhost:8080/logs")
			.then(res => {
				if (!res.ok) {
					throw new Error("HTTP status " + res.status);
				}
				return res.text();
			})
			.then(logs => {
				Swal.fire({
					title: "Log từ start.bat (Jasper Helper Server)",
					html: `<pre style="text-align: left; max-height: 400px; overflow-y: auto; font-family: monospace; font-size: 11px; background: #1e1e1e; color: #d4d4d4; padding: 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-all;">${logs || "Không có dữ liệu log."}</pre>`,
					width: "80%",
					confirmButtonText: "Đóng",
					showDenyButton: true,
					denyButtonText: "Sao chép log",
					customClass: {
						confirmButton: "btn btn-secondary",
						denyButton: "btn btn-primary"
					}
				}).then((result) => {
					if (result.isDenied) {
						navigator.clipboard.writeText(logs)
							.then(() => {
								Swal.fire({
									icon: "success",
									title: "Đã sao chép log vào clipboard",
									timer: 1500,
									showConfirmButton: false
								});
							});
					}
				});
			})
			.catch(err => {
				Swal.fire({
					icon: "error",
					title: "Không thể lấy log",
					text: "Không thể kết nối tới máy chủ Jasper Helper tại http://localhost:8080/logs. Chi tiết: " + err.message
				});
			});
	}

	replaceBtn.addEventListener('click', executeReplace);
	collapsedReplaceBtn.addEventListener('click', executeReplace);

	document.querySelectorAll('.site-item').forEach(item => {
		item.addEventListener('click', () => {
			resetSelection();
		});
	});
}

function writeOperationLog(actionType, detail) {
	const now = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	const dateStr = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
	const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
	const logText = `[${timeStr}] | ${actionType} | ${currentSiteKey} | ${detail}`;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 5000);

	fetch("http://localhost:8080/write-log", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			date: dateStr,
			log: logText
		}),
		signal: controller.signal
	}).catch(() => {}).finally(() => clearTimeout(timeoutId));
}



let currentLoadedLogs = [];

function loadLogContent(date) {
	if (!date) return;
	const tableBody = document.getElementById('logViewerTableBody');
	tableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Đang tải nội dung...</td></tr>';

	fetch(`http://localhost:8080/get-log?date=${date}`)
		.then(res => res.json())
		.then(arr => {
			currentLoadedLogs = arr.map(obj => {
				const timePart = obj.time || '';
				const typePart = obj.type || '';
				const sitePart = obj.site || '';
				const detailPart = obj.detail || '';
				const raw = `[${timePart}] | ${typePart} | ${sitePart} | ${detailPart}`;
				return { time: timePart, type: typePart, site: sitePart, detail: detailPart, raw: raw };
			});

			renderFilteredLogs();
		})
		.catch(err => {
			tableBody.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-4">Lỗi khi đọc nội dung log</td></tr>';
		});
}

function renderFilteredLogs() {
	const typeFilter = document.getElementById('logTypeFilter').value;
	const textSearch = (document.getElementById('logTextSearch')?.value || '').toLowerCase().trim();
	const tableBody = document.getElementById('logViewerTableBody');
	const countBadge = document.getElementById('logCountBadge');

	const filtered = currentLoadedLogs.filter(row => {
		if (typeFilter !== 'ALL' && row.type !== typeFilter) return false;
		if (textSearch && !row.raw.toLowerCase().includes(textSearch)) return false;
		return true;
	});

	if (countBadge) {
		countBadge.innerText = (filtered.length === currentLoadedLogs.length) 
			? `(${filtered.length} d\u00F2ng)` 
			: `(${filtered.length}/${currentLoadedLogs.length} d\u00F2ng)`;
	}

	if (filtered.length === 0) {
		tableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Không tìm thấy dòng nhật ký nào phù hợp bộ lọc</td></tr>';
		return;
	}

	let html = '';
	filtered.forEach(row => {
		let typeBadge = '';
		if (row.type === 'QUERY') typeBadge = '<span class="badge bg-info">QUERY</span>';
		else if (row.type === 'NON-QUERY') typeBadge = '<span class="badge bg-warning text-dark">NON-QUERY</span>';
		else if (row.type === 'SEARCH_PROC') typeBadge = '<span class="badge bg-primary">SEARCH</span>';
		else if (row.type === 'RUN_PROC') typeBadge = '<span class="badge bg-success">RUN</span>';
		else typeBadge = `<span class="badge bg-secondary">${row.type}</span>`;

		const escapedDetail = row.detail.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

		html += `
			<tr>
				<td class="text-center font-monospace">${row.time}</td>
				<td class="text-center">${typeBadge}</td>
				<td class="text-center font-monospace small">${row.site}</td>
				<td style="word-break: break-all; white-space: pre-wrap;" class="font-monospace">${escapedDetail}</td>
			</tr>
		`;
	});
	tableBody.innerHTML = html;
}

/* ==========================================================================
   MODAL UTILITIES
   ========================================================================== */
function showModal(modalId) {
	const el = document.getElementById(modalId);
	if (!el) return;
	const bObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
	if (!bObj) return;
	const instance = bObj.Modal.getInstance(el) || new bObj.Modal(el);
	instance.show();
}

function hideModal(modalId) {
	const el = document.getElementById(modalId);
	if (!el) return;
	const bObj = window.bootstrap || (typeof globalThis !== 'undefined' ? globalThis.bootstrap : null);
	if (!bObj) return;
	const instance = bObj.Modal.getInstance(el);
	if (instance) instance.hide();
}

/* ==========================================================================
   JASPER HELPER STATUS, HEARTBEAT & AUTO-START UI
   ========================================================================== */
let isJasperPolling = false;
let jasperHeartbeatInterval = null;

function checkAndStartJasperHelperUI(isManualClick = false) {
	const iconEl = document.getElementById('jasperHelperIcon');
	const textEl = document.getElementById('jasperHelperText');

	if (iconEl && textEl && !isJasperPolling) {
		iconEl.innerText = '🟡';
		textEl.innerText = 'Jasper: Đang kết nối...';
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 2000);

	fetch('http://localhost:8080/list-logs', { signal: controller.signal })
		.then(res => {
			clearTimeout(timeoutId);
			if (res.ok) {
				if (iconEl) iconEl.innerText = '🟢';
				if (textEl) textEl.innerText = 'Jasper: Sẵn sàng';
				isJasperPolling = false;
				startJasperHelperHeartbeat();
				if (isManualClick) {
					Swal.fire({
						icon: 'success',
						title: 'Jasper Helper',
						text: 'Máy chủ Jasper Helper (Port 8080) đang hoạt động tốt!',
						timer: 2000,
						showConfirmButton: false
					});
				}
			} else {
				throw new Error('Status not ok');
			}
		})
		.catch(() => {
			clearTimeout(timeoutId);
			if (iconEl) iconEl.innerText = '🟡';
			if (textEl) textEl.innerText = 'Jasper: Đang kích hoạt...';

			// Gửi background kích hoạt native host chạy ngầm start.bat
			chrome.runtime.sendMessage({ action: "start_jasper_helper" }, (resp) => {
				console.log("[JasperHelperUI] Start request response:", resp);
			});

			// Fallback: trigger custom protocol jasperhelper://start
			if (isManualClick) {
				try {
					const ifr = document.createElement('iframe');
					ifr.style.display = 'none';
					ifr.src = 'jasperhelper://start';
					document.body.appendChild(ifr);
					setTimeout(() => ifr.remove(), 1000);
				} catch (_) {}
			}

			if (!isJasperPolling) {
				isJasperPolling = true;
				let attempts = 0;
				const maxAttempts = 15; // Đợi tối đa 15 giây cho JVM khởi động
				const pollInterval = setInterval(() => {
					attempts++;
					const pollCtrl = new AbortController();
					const pollTimer = setTimeout(() => pollCtrl.abort(), 1200);

					fetch('http://localhost:8080/list-logs', { signal: pollCtrl.signal })
						.then(r => {
							clearTimeout(pollTimer);
							if (r.ok) {
								clearInterval(pollInterval);
								isJasperPolling = false;
								if (iconEl) iconEl.innerText = '🟢';
								if (textEl) textEl.innerText = 'Jasper: Sẵn sàng';
								startJasperHelperHeartbeat();
								if (isManualClick) {
									Swal.fire({
										icon: 'success',
										title: 'Khởi động thành công',
										text: 'Máy chủ Jasper Helper (Port 8080) đã được bật thành công!',
										timer: 2000,
										showConfirmButton: false
									});
								}
							}
						})
						.catch(() => {
							clearTimeout(pollTimer);
							if (attempts >= maxAttempts) {
								clearInterval(pollInterval);
								isJasperPolling = false;
								if (iconEl) iconEl.innerText = '🔴';
								if (textEl) textEl.innerText = 'Jasper: Chưa bật';
								if (isManualClick) {
									Swal.fire({
										icon: 'warning',
										title: 'Chưa thể kết nối Jasper Helper (Port 8080)',
										html: `<div style="text-align: left; font-size: 13px; line-height: 1.6;">
											<p class="mb-2">Máy chủ ghi nhận và xuất báo cáo Jasper chưa chạy trên máy này.</p>
											<div class="p-2 border rounded bg-light mb-2">
												<b>Cách 1: Khởi động thủ công</b><br>
												Vào thư mục <code>query_tool\\jasper_helper</code> và nhấp đúp chạy file <b>start.bat</b>.
											</div>
											<div class="p-2 border rounded bg-light">
												<b>Cách 2: Đăng ký để tiện ích tự bật ngầm</b><br>
												Chạy file <b>register_native_host.bat</b> trong thư mục <code>jasper_helper</code> một lần. Sau đó extension có thể tự bật máy chủ ngầm mỗi khi bạn mở extension!
											</div>
										</div>`,
										confirmButtonText: 'Đã hiểu'
									});
								}
							}
						});
				}, 1000);
			}
		});
}

function startJasperHelperHeartbeat() {
	if (jasperHeartbeatInterval) return;
	// Mỗi 25 giây kiểm tra ngầm 1 lần, nếu tắt thì kích hoạt bật lại
	jasperHeartbeatInterval = setInterval(() => {
		const ctrl = new AbortController();
		const tId = setTimeout(() => ctrl.abort(), 2000);
		fetch('http://localhost:8080/list-logs', { signal: ctrl.signal })
			.then(res => {
				clearTimeout(tId);
				if (res.ok) {
					const iconEl = document.getElementById('jasperHelperIcon');
					const textEl = document.getElementById('jasperHelperText');
					if (iconEl && iconEl.innerText !== '🟢') iconEl.innerText = '🟢';
					if (textEl && textEl.innerText !== 'Jasper: Sẵn sàng') textEl.innerText = 'Jasper: Sẵn sàng';
				} else {
					throw new Error('Not ok');
				}
			})
			.catch(() => {
				clearTimeout(tId);
				// Tự động khôi phục kết nối ngầm
				checkAndStartJasperHelperUI(false);
			});
	}, 25000);
}

/* ==========================================================================
   AUTO-UPDATE EXTENSION (Tự động kéo code mới & Bảo lưu 100% dữ liệu)
   ========================================================================== */
const DEFAULT_UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/tuanleanh89/query_tool/main/version.json";

function getUpdateManifestUrl() {
	return localStorage.getItem('custom_update_manifest_url') || DEFAULT_UPDATE_MANIFEST_URL;
}

function isNewerVersion(remoteVer, currentVer) {
	if (!remoteVer || !currentVer) return false;
	const v1 = remoteVer.trim().split('.').map(n => parseInt(n, 10) || 0);
	const v2 = currentVer.trim().split('.').map(n => parseInt(n, 10) || 0);
	const len = Math.max(v1.length, v2.length);
	for (let i = 0; i < len; i++) {
		const a = v1[i] || 0;
		const b = v2[i] || 0;
		if (a > b) return true;
		if (a < b) return false;
	}
	return false;
}

async function checkAppUpdate(isManual = false) {
	const updateIcon = document.getElementById('updateIcon');
	const updateText = document.getElementById('updateText');
	if (updateIcon) updateIcon.classList.add('fa-spin');

	try {
		const manifestUrl = getUpdateManifestUrl();
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 6000);
		
		const res = await fetch(`${manifestUrl}?_nocache=${Date.now()}`, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!res.ok) throw new Error(`Không thể lấy thông tin cập nhật (HTTP ${res.status})`);
		const updateData = await res.json();
		const currentVersion = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) 
			? chrome.runtime.getManifest().version 
			: '1.0';

		const remoteVersion = updateData.version || '';
		const changelog = Array.isArray(updateData.changelog) ? updateData.changelog : [];
		const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
		const downloadUrl = (isFirefox && updateData.download_urls && updateData.download_urls.firefox) 
			? updateData.download_urls.firefox 
			: (updateData.download_urls ? (updateData.download_urls.chrome || updateData.download_urls.zip) : '');

		if (isNewerVersion(remoteVersion, currentVersion)) {
			if (updateIcon) updateIcon.innerText = '🔴';
			if (updateText) updateText.innerText = `Có v${remoteVersion}`;

			const changelogHtml = changelog.length > 0 
				? `<div style="text-align: left; font-size: 13px; max-height: 180px; overflow-y: auto; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 10px; margin-top: 10px;">
					<b>Những điểm mới trong v${remoteVersion}:</b>
					<ul style="margin: 6px 0 0 18px; padding: 0;">
						${changelog.map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('')}
					</ul>
				</div>`
				: '';

			const confirmResult = await Swal.fire({
				title: `Đã có phiên bản mới: v${remoteVersion}`,
				html: `
					<div style="font-size: 14px; text-align: left;">
						<p class="mb-1">Phiên bản hiện tại của bạn: <b>v${currentVersion}</b></p>
						<p class="mb-2 text-muted" style="font-size: 12px;">Ngày phát hành: ${updateData.release_date || 'Mới nhất'}</p>
						${changelogHtml}
						<div class="alert alert-success mt-3 py-2 px-3 small" style="font-size: 12px; margin-bottom: 0;">
							🛡️ <b>Đảm bảo an toàn:</b> Toàn bộ lịch sử log, danh sách phiên làm việc, các tab đang mở và preview báo cáo của bạn được giữ nguyên 100%.
						</div>
					</div>
				`,
				icon: 'info',
				showCancelButton: true,
				confirmButtonText: '⚡ Cập nhật ngay',
				cancelButtonText: 'Để sau',
				confirmButtonColor: '#0d6efd',
				cancelButtonColor: '#6c757d'
			});

			if (confirmResult.isConfirmed) {
				await performAutoUpdate(downloadUrl, remoteVersion);
			}
		} else {
			if (updateIcon) updateIcon.innerText = '🔄';
			if (updateText) updateText.innerText = 'Cập Nhật';
			if (isManual) {
				Swal.fire({
					icon: 'success',
					title: 'Phiên bản mới nhất',
					text: `Bạn đang sử dụng phiên bản mới nhất (v${currentVersion}).`,
					timer: 2000,
					showConfirmButton: false
				});
			}
		}
	} catch (err) {
		console.warn('[AutoUpdate] Check failed:', err);
		if (isManual) {
			Swal.fire({
				icon: 'warning',
				title: 'Kiểm tra cập nhật',
				html: `
					<p class="small text-muted">${err.message || 'Không thể kết nối đến máy chủ cập nhật.'}</p>
					<button id="btnConfigUpdateUrl" class="btn btn-sm btn-outline-secondary mt-2">Cấu hình URL cập nhật</button>
				`,
				showConfirmButton: true
			});
			setTimeout(() => {
				const cfgBtn = document.getElementById('btnConfigUpdateUrl');
				if (cfgBtn) {
					cfgBtn.addEventListener('click', async () => {
						const { value: url } = await Swal.fire({
							title: 'URL File version.json',
							input: 'url',
							inputLabel: 'Nhập đường dẫn URL chứa file version.json trên Cloud:',
							inputValue: getUpdateManifestUrl(),
							showCancelButton: true
						});
						if (url) {
							localStorage.setItem('custom_update_manifest_url', url.trim());
							Swal.fire('Đã lưu!', 'Đường dẫn cập nhật đã được lưu lại.', 'success');
						}
					});
				}
			}, 200);
		}
	} finally {
		if (updateIcon) updateIcon.classList.remove('fa-spin');
	}
}

async function performAutoUpdate(downloadUrl, newVersion) {
	if (!downloadUrl) {
		Swal.fire('Lỗi', 'Không tìm thấy link tải bản cập nhật.', 'error');
		return;
	}

	// 1. Kiểm tra máy chủ Jasper Helper có online để tự ghi đè không
	let helperReady = false;
	try {
		const res = await fetch('http://localhost:8080/list-logs', { signal: AbortSignal.timeout(1500) });
		if (res.ok) helperReady = true;
	} catch (_) {}

	if (helperReady) {
		// Cập nhật tự động 100% qua Jasper Helper Server
		Swal.fire({
			title: 'Đang tự động cập nhật...',
			html: `
				<div style="font-size: 13px; text-align: left;">
					<p class="mb-2">Đang tải mã nguồn v${newVersion} và tiến hành nâng cấp...</p>
					<div class="progress mb-2" style="height: 10px;">
						<div class="progress-bar progress-bar-striped progress-bar-animated bg-success" style="width: 100%"></div>
					</div>
					<small class="text-muted">Vui lòng không đóng trang. Dữ liệu làm việc của bạn được bảo toàn nguyên vẹn.</small>
				</div>
			`,
			allowOutsideClick: false,
			allowEscapeKey: false,
			showConfirmButton: false
		});

		try {
			const updateRes = await fetch('http://localhost:8080/update-extension', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ downloadUrl })
			});

			const updateJson = await updateRes.json();
			if (updateRes.ok && updateJson.success) {
				await Swal.fire({
					icon: 'success',
					title: 'Cập nhật thành công!',
					html: `<p>Đã cập nhật lên <b>v${newVersion}</b> (${updateJson.extractedFiles || 'đầy đủ'} tệp tin).</p><p class="small text-muted">Tiện ích sẽ tự nạp lại sau 2 giây...</p>`,
					timer: 2000,
					showConfirmButton: false
				});

				// Tải lại extension
				if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.reload) {
					chrome.runtime.reload();
				}
				setTimeout(() => {
					window.location.reload();
				}, 500);
			} else {
				throw new Error(updateJson.error || 'Quá trình giải nén thất bại.');
			}
		} catch (error) {
			console.error('Update via helper failed:', error);
			Swal.fire({
				icon: 'error',
				title: 'Cập nhật tự động gặp lỗi',
				html: `<p class="small text-danger">${error.message}</p><p class="small">Bạn có muốn tải file cập nhật về máy thủ công không?</p>`,
				showCancelButton: true,
				confirmButtonText: 'Tải file cập nhật',
				cancelButtonText: 'Hủy'
			}).then((res) => {
				if (res.isConfirmed) {
					window.open(downloadUrl, '_blank');
				}
			});
		}
	} else {
		// Helper chưa bật: Hướng dẫn tải file về
		const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
		if (isFirefox) {
			window.open(downloadUrl, '_blank');
		} else {
			Swal.fire({
				title: 'Tải bản cập nhật',
				html: `
					<div style="font-size: 13px; text-align: left;">
						<p>Máy chủ Jasper Helper hiện chưa bật nên không thể tự động ghi đè file.</p>
						<p>Bấm nút bên dưới để tải gói cập nhật (<b>.zip</b>) về máy. Sau đó giải nén đè vào thư mục extension và bấm <b>Reload (⟳)</b> trên trình duyệt.</p>
					</div>
				`,
				icon: 'info',
				showCancelButton: true,
				confirmButtonText: 'Tải gói ZIP ngay',
				cancelButtonText: 'Đóng'
			}).then((res) => {
				if (res.isConfirmed) {
					window.open(downloadUrl, '_blank');
				}
			});
		}
	}
}

/* ==========================================================================
   SAVED TABLES MANAGER (Lưu kết quả & Thêm, Sửa, Xóa bảng / dòng)
   ========================================================================== */
let cachedSavedTables = [];
let currentEditingRowIndex = -1;

function initSavedTablesManager() {
	chrome.storage.local.get(['savedResultTables'], (result) => {
		cachedSavedTables = Array.isArray(result.savedResultTables) ? result.savedResultTables : [];
		updateSavedTablesBadge();
	});
}

function updateSavedTablesBadge() {
	const badge = document.getElementById('savedTablesBadgeCount');
	if (badge) {
		badge.innerText = cachedSavedTables.length;
	}
}

function promptSaveCurrentResultTable() {
	if (!currentTableData || currentTableData.length === 0) {
		Swal.fire({
			icon: 'warning',
			title: 'Không có dữ liệu',
			text: 'Chưa có kết quả truy vấn nào trên bảng để lưu! Vui lòng thực hiện truy vấn trước.'
		});
		return;
	}

	const currentTab = getCurrentTab();
	const defaultName = currentTab ? currentTab.name.replace(/^Run:\s*/, '') : `Bảng kết quả ${new Date().toLocaleDateString('vi-VN')}`;
	const defaultDesc = (lastSql || '').trim().substring(0, 300);

	// Mặc định lưu full toàn bộ kết quả truy vấn
	const hasMoreRows = ((totalRows !== null && totalRows !== undefined) ? totalRows > currentTableData.length : currentTableData.length >= pageSize) && lastSql && !lastSql.toUpperCase().includes('INS_CH_MENU');
	const totalRowsDisplayStr = (totalRows !== null && totalRows !== undefined) ? `${totalRows.toLocaleString('vi-VN')} dòng` : `${currentTableData.length}+ dòng`;

	Swal.fire({
		title: 'Lưu Kết Quả Truy Vấn',
		html: `
			<div class="text-start">
				<div class="mb-3">
					<label class="form-label small fw-bold">Tên bảng lưu trữ: <span class="text-danger">*</span></label>
					<input type="text" id="swalInputTableName" class="form-control form-control-sm" value="${defaultName}">
				</div>
				<div class="mb-2">
					<label class="form-label small fw-bold">Ghi chú / Mô tả (tùy chọn):</label>
					<textarea id="swalInputTableDesc" class="form-control form-control-sm" rows="3" placeholder="Ghi chú về bảng này hoặc câu lệnh SQL...">${defaultDesc}</textarea>
				</div>
				<div class="small text-muted">
					Số dòng dữ liệu sẽ lưu: <b class="text-primary fw-bold">${totalRowsDisplayStr}</b> ${hasMoreRows ? '(Toàn bộ kết quả truy vấn)' : ''}.
				</div>
			</div>
		`,
		showCancelButton: true,
		confirmButtonText: 'Lưu Bảng',
		cancelButtonText: 'Hủy',
		preConfirm: () => {
			const name = document.getElementById('swalInputTableName').value.trim();
			const desc = document.getElementById('swalInputTableDesc').value.trim();
			if (!name) {
				Swal.showValidationMessage('Vui lòng nhập tên bảng lưu trữ!');
				return false;
			}
			return { name, desc };
		}
	}).then((res) => {
		if (res.isConfirmed && res.value) {
			const tableName = res.value.name;
			const tableDesc = res.value.desc;

			const finalizeSave = (dataToSave) => {
				const newTable = {
					id: 'stbl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
					name: tableName,
					description: tableDesc,
					siteKey: currentSiteKey,
					rowCount: dataToSave.length,
					createdAt: new Date().toLocaleString('vi-VN'),
					updatedAt: new Date().toLocaleString('vi-VN'),
					data: JSON.parse(JSON.stringify(dataToSave))
				};

				cachedSavedTables.unshift(newTable);
				chrome.storage.local.set({ savedResultTables: cachedSavedTables }, () => {
					updateSavedTablesBadge();
					Swal.fire({
						icon: 'success',
						title: 'Đã lưu thành công!',
						text: `Đã lưu toàn bộ ${newTable.rowCount.toLocaleString('vi-VN')} dòng vào bảng "${newTable.name}".`,
						timer: 1800,
						showConfirmButton: false
					});
				});
			};

			if (hasMoreRows) {
				Swal.fire({
					title: 'Đang tải toàn bộ dữ liệu...',
					html: (totalRows !== null && totalRows !== undefined) ? `Đang truy vấn toàn bộ <b>${totalRows.toLocaleString('vi-VN')}</b> dòng kết quả...` : `Đang truy vấn toàn bộ dữ liệu kết quả...`,
					allowOutsideClick: false,
					didOpen: () => {
						Swal.showLoading();
					}
				});

				chrome.runtime.sendMessage({
					action: "execute_sql",
					sql: lastSql,
					page: 1,
					pageSize: 100000,
					noLimit: true,
					siteKey: currentSiteKey
				}, (response) => {
					if (response && response.success && Array.isArray(response.data)) {
						finalizeSave(response.data);
					} else {
						finalizeSave(currentTableData);
					}
				});
			} else {
				finalizeSave(currentTableData);
			}
		}
	});
}

function openSavedTablesModal() {
	renderSavedTablesList();
	showModal('savedTablesModal');
}

function renderSavedTablesList(filterText = '') {
	const body = document.getElementById('savedTablesListBody');
	const summary = document.getElementById('savedTablesSummary');
	if (!body) return;

	const filter = (filterText || '').toLowerCase().trim();
	const filtered = cachedSavedTables.filter(t => {
		if (!filter) return true;
		const matchName = (t.name || '').toLowerCase().includes(filter);
		const matchDesc = (t.description || '').toLowerCase().includes(filter);
		const matchSite = (t.siteKey || '').toLowerCase().includes(filter);
		return matchName || matchDesc || matchSite;
	});

	if (summary) {
		summary.innerText = `${cachedSavedTables.length} bảng được lưu`;
	}

	if (filtered.length === 0) {
		body.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">${filter ? 'Không tìm thấy bảng nào phù hợp từ khóa' : 'Chưa có bảng nào được lưu'}</td></tr>`;
		return;
	}

	let html = '';
	filtered.forEach((tbl, idx) => {
		const siteBadge = tbl.siteKey === 'thai_binh' 
			? '<span class="badge bg-danger">TB</span>' 
			: '<span class="badge bg-primary">HY</span>';
		const rowCountStr = (tbl.rowCount || (tbl.data ? tbl.data.length : 0)).toLocaleString('vi-VN');
		const safeDesc = (tbl.description || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const truncatedDesc = safeDesc.length > 50 ? safeDesc.substring(0, 50) + '...' : safeDesc;

		html += `
			<tr>
				<td class="text-center fw-bold">${idx + 1}</td>
				<td>
					<span class="fw-bold text-primary">${tbl.name}</span>
				</td>
				<td>${siteBadge}</td>
				<td class="text-center"><span class="badge bg-secondary font-monospace">${rowCountStr}</span></td>
				<td class="small text-muted">${tbl.updatedAt || tbl.createdAt || '-'}</td>
				<td class="small font-monospace" title="${safeDesc}">${truncatedDesc}</td>
				<td class="text-center">
					<div class="btn-group btn-group-sm" role="group">
						<button class="btn btn-outline-primary btn-load-saved-tbl py-0 px-2" data-id="${tbl.id}" title="Mở bảng này lên vùng kết quả">📂 Mở</button>
						<button class="btn btn-outline-secondary btn-edit-saved-tbl py-0 px-2" data-id="${tbl.id}" title="Sửa tên / ghi chú">✏️ Sửa</button>
						<button class="btn btn-outline-warning btn-overwrite-saved-tbl py-0 px-2" data-id="${tbl.id}" title="Ghi đè bằng dữ liệu đang mở">🔄 Ghi đè</button>
						<button class="btn btn-outline-success btn-export-saved-tbl py-0 px-2" data-id="${tbl.id}" title="Xuất ra file Excel">📊 Excel</button>
						<button class="btn btn-outline-danger btn-delete-saved-tbl py-0 px-2" data-id="${tbl.id}" title="Xóa bảng này">🗑️ Xóa</button>
					</div>
				</td>
			</tr>
		`;
	});
	body.innerHTML = html;

	body.querySelectorAll('.btn-load-saved-tbl').forEach(btn => {
		btn.addEventListener('click', () => loadSavedTable(btn.getAttribute('data-id')));
	});
	body.querySelectorAll('.btn-edit-saved-tbl').forEach(btn => {
		btn.addEventListener('click', () => editSavedTableInfo(btn.getAttribute('data-id')));
	});
	body.querySelectorAll('.btn-overwrite-saved-tbl').forEach(btn => {
		btn.addEventListener('click', () => overwriteSavedTable(btn.getAttribute('data-id')));
	});
	body.querySelectorAll('.btn-export-saved-tbl').forEach(btn => {
		btn.addEventListener('click', () => exportSavedTable(btn.getAttribute('data-id')));
	});
	body.querySelectorAll('.btn-delete-saved-tbl').forEach(btn => {
		btn.addEventListener('click', () => deleteSavedTable(btn.getAttribute('data-id')));
	});
}

function loadSavedTable(tableId) {
	const tbl = cachedSavedTables.find(t => t.id === tableId);
	if (!tbl || !Array.isArray(tbl.data)) {
		Swal.fire({ icon: 'error', title: 'Lỗi', text: 'Không tìm thấy dữ liệu bảng đã lưu!' });
		return;
	}

	const clonedData = JSON.parse(JSON.stringify(tbl.data));
	currentData = clonedData;
	currentTableData = clonedData;
	totalRows = clonedData.length;
	currentPage = 1;

	const currentTab = getCurrentTab();
	if (currentTab) {
		currentTab.data = clonedData;
		currentTab.totalRows = totalRows;
		currentTab.currentPage = 1;
		currentTab.statusText = `📋 Đã nạp bảng "${tbl.name}" (${totalRows.toLocaleString('vi-VN')} dòng)`;
	}

	const statusEl = document.getElementById('status');
	if (statusEl) {
		statusEl.className = "text-primary fw-semibold";
		statusEl.innerText = `📋 Đã nạp bảng "${tbl.name}" (${totalRows.toLocaleString('vi-VN')} dòng)`;
	}

	renderTable(currentTableData);
	updatePaginationUI();
	hideModal('savedTablesModal');

	Swal.fire({
		icon: 'success',
		title: 'Đã nạp bảng!',
		text: `Nạp thành công bảng "${tbl.name}" với ${totalRows.toLocaleString('vi-VN')} dòng.`,
		timer: 1500,
		showConfirmButton: false
	});
}

function editSavedTableInfo(tableId) {
	const tbl = cachedSavedTables.find(t => t.id === tableId);
	if (!tbl) return;

	Swal.fire({
		title: 'Chỉnh Sửa Thông Tin Bảng',
		html: `
			<div class="text-start">
				<div class="mb-3">
					<label class="form-label small fw-bold">Tên bảng:</label>
					<input type="text" id="swalEditTableName" class="form-control form-control-sm" value="${tbl.name}">
				</div>
				<div class="mb-2">
					<label class="form-label small fw-bold">Ghi chú / Mô tả:</label>
					<textarea id="swalEditTableDesc" class="form-control form-control-sm" rows="3">${tbl.description || ''}</textarea>
				</div>
			</div>
		`,
		showCancelButton: true,
		confirmButtonText: 'Cập Nhật',
		cancelButtonText: 'Hủy',
		preConfirm: () => {
			const name = document.getElementById('swalEditTableName').value.trim();
			const desc = document.getElementById('swalEditTableDesc').value.trim();
			if (!name) {
				Swal.showValidationMessage('Tên bảng không được để trống!');
				return false;
			}
			return { name, desc };
		}
	}).then(res => {
		if (res.isConfirmed && res.value) {
			tbl.name = res.value.name;
			tbl.description = res.value.desc;
			tbl.updatedAt = new Date().toLocaleString('vi-VN');
			chrome.storage.local.set({ savedResultTables: cachedSavedTables }, () => {
				renderSavedTablesList();
			});
		}
	});
}

function overwriteSavedTable(tableId) {
	const tbl = cachedSavedTables.find(t => t.id === tableId);
	if (!tbl) return;

	if (!currentTableData || currentTableData.length === 0) {
		Swal.fire({
			icon: 'warning',
			title: 'Không có dữ liệu',
			text: 'Bảng kết quả hiện tại đang trống, không thể ghi đè!'
		});
		return;
	}

	const hasMoreRows = ((totalRows !== null && totalRows !== undefined) ? totalRows > currentTableData.length : currentTableData.length >= pageSize) && lastSql && !lastSql.toUpperCase().includes('INS_CH_MENU');
	const totalRowsDisplayStr = (totalRows !== null && totalRows !== undefined) ? `${totalRows.toLocaleString('vi-VN')} dòng` : `${currentTableData.length}+ dòng`;

	Swal.fire({
		title: 'Xác nhận ghi đè?',
		text: `Bạn có chắc muốn ghi đè bảng "${tbl.name}" bằng toàn bộ dữ liệu hiện tại (${totalRowsDisplayStr})? Dữ liệu cũ sẽ bị thay thế.`,
		icon: 'question',
		showCancelButton: true,
		confirmButtonColor: '#ffc107',
		confirmButtonText: 'Ghi Đè',
		cancelButtonText: 'Hủy'
	}).then(res => {
		if (res.isConfirmed) {
			const finalizeOverwrite = (dataToSave) => {
				tbl.data = JSON.parse(JSON.stringify(dataToSave));
				tbl.rowCount = dataToSave.length;
				tbl.updatedAt = new Date().toLocaleString('vi-VN');
				chrome.storage.local.set({ savedResultTables: cachedSavedTables }, () => {
					renderSavedTablesList();
					Swal.fire({
						icon: 'success',
						title: 'Ghi đè thành công',
						text: `Đã cập nhật toàn bộ ${tbl.rowCount.toLocaleString('vi-VN')} dòng cho bảng "${tbl.name}".`,
						timer: 1500,
						showConfirmButton: false
					});
				});
			};

			if (hasMoreRows) {
				Swal.fire({
					title: 'Đang tải toàn bộ dữ liệu...',
					html: (totalRows !== null && totalRows !== undefined) ? `Đang truy vấn toàn bộ <b>${totalRows.toLocaleString('vi-VN')}</b> dòng kết quả...` : `Đang truy vấn toàn bộ dữ liệu kết quả...`,
					allowOutsideClick: false,
					didOpen: () => {
						Swal.showLoading();
					}
				});

				chrome.runtime.sendMessage({
					action: "execute_sql",
					sql: lastSql,
					page: 1,
					pageSize: 100000,
					noLimit: true,
					siteKey: currentSiteKey
				}, (response) => {
					if (response && response.success && Array.isArray(response.data)) {
						finalizeOverwrite(response.data);
					} else {
						finalizeOverwrite(currentTableData);
					}
				});
			} else {
				finalizeOverwrite(currentTableData);
			}
		}
	});
}

function exportSavedTable(tableId) {
	const tbl = cachedSavedTables.find(t => t.id === tableId);
	if (!tbl || !Array.isArray(tbl.data) || tbl.data.length === 0) {
		Swal.fire({ icon: 'warning', title: 'Thông báo', text: 'Bảng này không có dữ liệu để xuất Excel!' });
		return;
	}

	try {
		const ws = XLSX.utils.json_to_sheet(tbl.data);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "Result");
		const cleanName = (tbl.name || 'Export').replace(/[/\\?%*:|"<>]/g, '_');
		XLSX.writeFile(wb, `${cleanName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
	} catch (err) {
		Swal.fire({ icon: 'error', title: 'Lỗi xuất Excel', text: err.message });
	}
}

function deleteSavedTable(tableId) {
	const tbl = cachedSavedTables.find(t => t.id === tableId);
	if (!tbl) return;

	Swal.fire({
		title: 'Xác nhận xóa?',
		text: `Bạn có chắc chắn muốn xóa bảng đã lưu "${tbl.name}"? Hành động này không thể hoàn tác.`,
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#d33',
		confirmButtonText: 'Xóa Bảng',
		cancelButtonText: 'Hủy'
	}).then(res => {
		if (res.isConfirmed) {
			cachedSavedTables = cachedSavedTables.filter(t => t.id !== tableId);
			chrome.storage.local.set({ savedResultTables: cachedSavedTables }, () => {
				updateSavedTablesBadge();
				renderSavedTablesList();
				Swal.fire({
					icon: 'success',
					title: 'Đã xóa!',
					timer: 1200,
					showConfirmButton: false
				});
			});
		}
	});
}

function openCreateBlankTablePrompt() {
	Swal.fire({
		title: 'Tạo Bảng Dữ Liệu Trống Mới',
		html: `
			<div class="text-start">
				<div class="mb-3">
					<label class="form-label small fw-bold">Tên bảng: <span class="text-danger">*</span></label>
					<input type="text" id="swalBlankTableName" class="form-control form-control-sm" placeholder="Ví dụ: DANH_SACH_KHAM">
				</div>
				<div class="mb-2">
					<label class="form-label small fw-bold">Danh sách các cột (cách nhau bởi dấu phẩy): <span class="text-danger">*</span></label>
					<input type="text" id="swalBlankTableCols" class="form-control form-control-sm" placeholder="Ví dụ: MA_BN, HO_TEN, NGAYSINH, DIACHI">
					<div class="form-text small">Nhập tên các cột của bảng, phân tách bởi dấu phẩy (,).</div>
				</div>
			</div>
		`,
		showCancelButton: true,
		confirmButtonText: 'Tạo Bảng',
		cancelButtonText: 'Hủy',
		preConfirm: () => {
			const name = document.getElementById('swalBlankTableName').value.trim();
			const colsStr = document.getElementById('swalBlankTableCols').value.trim();
			if (!name) {
				Swal.showValidationMessage('Vui lòng nhập tên bảng!');
				return false;
			}
			if (!colsStr) {
				Swal.showValidationMessage('Vui lòng nhập ít nhất một cột dữ liệu!');
				return false;
			}
			const cols = colsStr.split(',').map(c => c.trim()).filter(c => c.length > 0);
			if (cols.length === 0) {
				Swal.showValidationMessage('Danh sách cột không hợp lệ!');
				return false;
			}
			return { name, cols };
		}
	}).then(res => {
		if (res.isConfirmed && res.value) {
			const emptyRow = {};
			res.value.cols.forEach(c => {
				emptyRow[c] = '';
			});

			const newTable = {
				id: 'stbl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
				name: res.value.name,
				description: 'Bảng thủ công tạo mới',
				siteKey: currentSiteKey,
				rowCount: 1,
				createdAt: new Date().toLocaleString('vi-VN'),
				updatedAt: new Date().toLocaleString('vi-VN'),
				data: [emptyRow]
			};

			cachedSavedTables.unshift(newTable);
			chrome.storage.local.set({ savedResultTables: cachedSavedTables }, () => {
				updateSavedTablesBadge();
				renderSavedTablesList();
				loadSavedTable(newTable.id);
			});
		}
	});
}

// Thao tác CRUD trực tiếp trên từng dòng của bảng hiện tại
function openEditRowModal(rowIndex, isNew = false) {
	if (!currentTableData || currentTableData.length === 0) {
		if (isNew) {
			Swal.fire({
				icon: 'info',
				title: 'Bảng trống',
				text: 'Hiện chưa có cấu trúc bảng nào đang mở. Bạn có thể bấm "Bảng đã lưu" -> "+ Tạo Bảng Trống" để định nghĩa các cột trước.'
			});
		}
		return;
	}

	const cols = Object.keys(currentTableData[0]);
	if (cols.length === 0) {
		Swal.fire({ icon: 'warning', title: 'Thông báo', text: 'Bảng này chưa có cột nào!' });
		return;
	}

	currentEditingRowIndex = isNew ? -1 : rowIndex;
	const titleEl = document.getElementById('editTableRowModalTitle');
	if (titleEl) {
		titleEl.innerText = isNew ? 'Thêm Dòng Dữ Liệu Mới' : `Chỉnh Sửa Dòng Dữ Liệu #${rowIndex + 1}`;
	}

	const targetRow = (!isNew && currentTableData[rowIndex]) ? currentTableData[rowIndex] : {};
	const form = document.getElementById('editTableRowForm');
	if (!form) return;

	let fieldsHtml = '';
	cols.forEach(col => {
		const val = targetRow[col] !== undefined && targetRow[col] !== null ? String(targetRow[col]) : '';
		const safeVal = val.replace(/"/g, '&quot;');
		fieldsHtml += `
			<div class="col-md-6 mb-2">
				<label class="form-label small fw-semibold text-secondary mb-1">${col}</label>
				<input type="text" class="form-control form-control-sm row-data-field" data-col="${col}" value="${safeVal}">
			</div>
		`;
	});

	form.innerHTML = fieldsHtml;
	showModal('editTableRowModal');
}

function saveTableRowFromModal() {
	const form = document.getElementById('editTableRowForm');
	if (!form) return;

	const inputs = form.querySelectorAll('.row-data-field');
	const rowObj = {};
	inputs.forEach(input => {
		const col = input.getAttribute('data-col');
		rowObj[col] = input.value;
	});

	if (currentEditingRowIndex === -1) {
		currentTableData.unshift(rowObj);
		totalRows++;
	} else if (currentTableData[currentEditingRowIndex]) {
		currentTableData[currentEditingRowIndex] = rowObj;
	}

	currentData = currentTableData;
	const currentTab = getCurrentTab();
	if (currentTab) {
		currentTab.data = currentTableData;
		currentTab.totalRows = totalRows;
	}

	renderTable(currentTableData);
	updatePaginationUI();
	hideModal('editTableRowModal');

	Swal.fire({
		icon: 'success',
		title: currentEditingRowIndex === -1 ? 'Đã thêm dòng mới!' : 'Đã cập nhật dòng!',
		timer: 1200,
		showConfirmButton: false
	});
}

function deleteTableRow(rowIndex) {
	if (!currentTableData || !currentTableData[rowIndex]) return;

	Swal.fire({
		title: 'Xác nhận xóa dòng?',
		text: `Bạn có chắc muốn xóa dòng số ${rowIndex + 1}?`,
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#d33',
		confirmButtonText: 'Xóa Dòng',
		cancelButtonText: 'Hủy'
	}).then(res => {
		if (res.isConfirmed) {
			currentTableData.splice(rowIndex, 1);
			totalRows = Math.max(0, totalRows - 1);
			currentData = currentTableData;

			const currentTab = getCurrentTab();
			if (currentTab) {
				currentTab.data = currentTableData;
				currentTab.totalRows = totalRows;
			}

			renderTable(currentTableData);
			updatePaginationUI();

			Swal.fire({
				icon: 'success',
				title: 'Đã xóa dòng!',
				timer: 1000,
				showConfirmButton: false
			});
		}
	});
}

/* ==========================================================================
   SESSION MANAGER (Tab To - Quản lý các Phiên làm việc & Tab Con)
   ========================================================================== */

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
    const currentSess = getCurrentSession();
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
function initGlobalSearchText() {
    const btnOpen = document.getElementById('btnSearchTextModal');
    if (btnOpen) {
        btnOpen.addEventListener('click', openSearchTextModal);
    }

    const btnExec = document.getElementById('btnExecuteSearchText');
    if (btnExec) {
        btnExec.addEventListener('click', executeGlobalSearch);
    }

    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                executeGlobalSearch();
            }
        });
    }

    const scopeRadios = document.querySelectorAll('input[name="searchScopeOption"]');
    scopeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (searchInput && searchInput.value.trim()) {
                executeGlobalSearch();
            }
        });
    });

    const matchCaseCheck = document.getElementById('searchMatchCase');
    if (matchCaseCheck) {
        matchCaseCheck.addEventListener('change', () => {
            if (searchInput && searchInput.value.trim()) {
                executeGlobalSearch();
            }
        });
    }

    // Shortcut Ctrl+Shift+F
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
            e.preventDefault();
            openSearchTextModal();
        }
    });
}

function openSearchTextModal() {
    const curTab = getCurrentTab();
    if (curTab && editor) {
        curTab.sql = editor.getValue();
    }

    const curSess = getCurrentSession();
    const lblScopeCurrent = document.getElementById('lblSearchScopeCurrent');
    if (lblScopeCurrent) {
        lblScopeCurrent.innerText = `Phiên hiện tại (${curSess ? curSess.name : 'Phiên 1'})`;
    }

    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput && editor) {
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
            const selectedText = editor.getModel().getValueInRange(selection).trim();
            if (selectedText && selectedText.length < 100) {
                searchInput.value = selectedText;
            }
        }
    }

    showModal('searchTextModal');

    setTimeout(() => {
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }, 200);
}

function executeGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const keyword = input ? input.value.trim() : '';
    if (!keyword) {
        Swal.fire({
            icon: 'warning',
            title: 'Thông báo',
            text: 'Vui lòng nhập từ khóa tìm kiếm!'
        });
        return;
    }

    const curTab = getCurrentTab();
    if (curTab && editor) {
        curTab.sql = editor.getValue();
    }
    const curSess = getCurrentSession();
    if (curSess) {
        curSess.tabs = tabsBySite[currentSiteKey];
    }

    const scopeRadio = document.querySelector('input[name="searchScopeOption"]:checked');
    const scope = scopeRadio ? scopeRadio.value : 'current';
    const matchCase = document.getElementById('searchMatchCase') ? document.getElementById('searchMatchCase').checked : false;

    let targetSessions = [];
    if (scope === 'all') {
        targetSessions = (sessionsBySite && sessionsBySite[currentSiteKey]) ? sessionsBySite[currentSiteKey] : [];
    } else {
        if (curSess) targetSessions = [curSess];
    }

    const results = [];
    const searchFor = matchCase ? keyword : keyword.toLowerCase();

    targetSessions.forEach(sess => {
        const tabsList = (sess.id === currentSessionId) ? (tabsBySite[currentSiteKey] || []) : (sess.tabs || []);
        tabsList.forEach(tab => {
            let sqlText = '';
            if (tab.id === currentTabId && editor) {
                sqlText = editor.getValue();
            } else if (tabModels[tab.id]) {
                sqlText = tabModels[tab.id].getValue();
            } else {
                sqlText = tab.sql || '';
            }

            if (!sqlText) return;

            const lines = sqlText.split(/\r?\n/);
            lines.forEach((line, lineIdx) => {
                const lineToSearch = matchCase ? line : line.toLowerCase();
                const foundIndex = lineToSearch.indexOf(searchFor);
                if (foundIndex !== -1) {
                    results.push({
                        sessionId: sess.id,
                        sessionName: sess.name || 'Phiên',
                        tabId: tab.id,
                        tabName: tab.name || 'Tab',
                        lineNumber: lineIdx + 1,
                        startCol: foundIndex + 1,
                        endCol: foundIndex + 1 + keyword.length,
                        lineText: line
                    });
                }
            });
        });
    });

    renderSearchResults(results, keyword, matchCase);
}

function renderSearchResults(results, keyword, matchCase) {
    const body = document.getElementById('searchResultBody');
    const summary = document.getElementById('searchResultSummary');
    const badge = document.getElementById('searchResultCountBadge');
    if (!body) return;

    if (badge) {
        badge.style.display = 'inline-block';
        badge.innerText = `${results.length} kết quả`;
        badge.className = results.length > 0 ? 'badge bg-success font-monospace' : 'badge bg-secondary font-monospace';
    }

    if (summary) {
        summary.innerText = results.length > 0 
            ? `Tìm thấy ${results.length} dòng chứa từ khóa "${keyword}"` 
            : `Không tìm thấy kết quả nào khớp với "${keyword}"`;
    }

    if (results.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Không tìm thấy kết quả nào</td></tr>';
        return;
    }

    let html = '';
    results.forEach((item, idx) => {
        const escapedLine = escapeHtml(item.lineText);
        let highlightedHtml = '';
        if (matchCase) {
            const escapedKw = escapeHtml(keyword);
            highlightedHtml = escapedLine.split(escapedKw).join(`<mark>${escapedKw}</mark>`);
        } else {
            const reg = new RegExp(escapeRegExp(escapeHtml(keyword)), 'gi');
            highlightedHtml = escapedLine.replace(reg, match => `<mark>${match}</mark>`);
        }

        const isCurrentSess = item.sessionId === currentSessionId;
        const isCurrentT = item.tabId === currentTabId;

        html += `
            <tr class="search-result-row" data-sess-id="${item.sessionId}" data-tab-id="${item.tabId}" data-line="${item.lineNumber}" data-start-col="${item.startCol}" data-end-col="${item.endCol}">
                <td class="text-center text-muted small fw-bold">${idx + 1}</td>
                <td>
                    <span class="badge ${isCurrentSess ? 'bg-primary' : 'bg-light text-dark border'} text-truncate d-inline-block" style="max-width: 130px;" title="${escapeHtml(item.sessionName)}">
                        ${escapeHtml(item.sessionName)}
                    </span>
                </td>
                <td>
                    <span class="badge ${isCurrentT ? 'bg-info text-dark' : 'bg-light text-dark border'} text-truncate d-inline-block" style="max-width: 120px;" title="${escapeHtml(item.tabName)}">
                        ${escapeHtml(item.tabName)}
                    </span>
                </td>
                <td class="text-center font-monospace fw-bold text-primary">${item.lineNumber}</td>
                <td>
                    <div class="search-result-match-line">${highlightedHtml}</div>
                </td>
                <td class="text-center">
                    <button class="btn btn-outline-primary btn-sm py-0 px-2 fw-semibold btn-jump-to-line" title="Nhảy đến dòng này trong editor">
                        🚀 Đi tới
                    </button>
                </td>
            </tr>
        `;
    });

    body.innerHTML = html;

    body.querySelectorAll('.search-result-row').forEach(row => {
        row.addEventListener('click', () => {
            const sessId = row.getAttribute('data-sess-id');
            const tabId = row.getAttribute('data-tab-id');
            const lineNum = parseInt(row.getAttribute('data-line'), 10) || 1;
            const startCol = parseInt(row.getAttribute('data-start-col'), 10) || 1;
            const endCol = parseInt(row.getAttribute('data-end-col'), 10) || startCol;

            hideModal('searchTextModal');
            goToSearchResult(sessId, tabId, lineNum, startCol, endCol);
        });
    });
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function goToSearchResult(sessionId, tabId, lineNumber, startCol, endCol) {
    if (sessionId && sessionId !== currentSessionId) {
        switchSession(sessionId);
    }
    if (tabId && currentTabId !== tabId) {
        switchTab(tabId);
    }

    setTimeout(() => {
        if (editor) {
            editor.focus();
            editor.revealLineInCenter(lineNumber);
            editor.setPosition({ lineNumber: lineNumber, column: startCol });
            if (typeof monaco !== 'undefined' && monaco.Range) {
                editor.setSelection(new monaco.Range(lineNumber, startCol, lineNumber, endCol));
            }
        }
    }, 100);
}
