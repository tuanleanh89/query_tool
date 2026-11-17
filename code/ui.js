/*
 * ui.js - Khởi tạo Monaco Editor và toàn bộ sự kiện giao diện (initLayoutAndEvents).
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
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

        chrome.storage.local.get(['sessionsBySite', 'tabsBySite', 'savedSessions', 'currentSessionIdBySite', 'sessionBarVisible', 'lastSiteKey'], (result) => {
            if (result.lastSiteKey === 'hung_yen' || result.lastSiteKey === 'thai_binh') {
                currentSiteKey = result.lastSiteKey;
                document.querySelectorAll('.site-item').forEach(i => i.classList.toggle('active', i.dataset.site === currentSiteKey));
                if (typeof renderRecentUnitsUI === 'function') renderRecentUnitsUI();
            }
            if (result.sessionBarVisible !== undefined) {
                toggleSessionBar(result.sessionBarVisible);
            } else {
                const localVis = localStorage.getItem('sessionBarVisible');
                if (localVis !== null) toggleSessionBar(localVis === '1');
            }
            sessionsBySite = result.sessionsBySite || { hung_yen: [], thai_binh: [] };
            console.info('[STORAGE] Nạp từ chrome.storage:', Object.fromEntries(Object.entries(sessionsBySite).map(([k, v]) => [k, (v || []).length + ' phiên'])), 'site cuối:', result.lastSiteKey);
            // Khôi phục từ bản sao dự phòng nếu chrome.storage không có phiên cho site nào đó
            const bk = readLocalSessionsBackup();
            if (bk && bk.sessionsBySite) {
                ['hung_yen', 'thai_binh'].forEach(site => {
                    const have = Array.isArray(sessionsBySite[site]) && sessionsBySite[site].length > 0;
                    const bkList = bk.sessionsBySite[site];
                    if (!have && Array.isArray(bkList) && bkList.length > 0) {
                        console.warn('[STORAGE] Khôi phục phiên', site, 'từ bản sao dự phòng');
                        sessionsBySite[site] = bkList;
                        if (bk.currentSessionIdBySite && bk.currentSessionIdBySite[site]) {
                            result.currentSessionIdBySite = Object.assign({}, result.currentSessionIdBySite, { [site]: bk.currentSessionIdBySite[site] });
                        }
                    }
                });
                if (!result.lastSiteKey && bk.lastSiteKey) {
                    currentSiteKey = bk.lastSiteKey;
                    document.querySelectorAll('.site-item').forEach(i => i.classList.toggle('active', i.dataset.site === currentSiteKey));
                }
            }
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

            storageReady = true;
            saveTabs();
        });

        setInterval(saveTabs, 2000);
        // Lưu ngay khi đóng/ẩn trang để không mất thay đổi trong 2 giây cuối
        window.addEventListener('pagehide', saveTabs);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveTabs(); });

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

        const doExport = async (dataRows, suffix = '') => {
            const cleanSite = currentSiteKey || 'HIS';
            if (dataRows.length >= 100000) {
                await Swal.fire({
                    icon: 'info', title: 'Đã đạt giới hạn 100.000 dòng',
                    text: 'Kết quả có thể còn nhiều dòng hơn nhưng file chỉ chứa tối đa 100.000 dòng đầu. Hãy chia nhỏ điều kiện lọc nếu cần đủ dữ liệu.'
                });
            }
            await exportRowsToExcel(dataRows, {
                sheetName: 'Kết quả SQL',
                fileName: `${cleanSite}_Result_${suffix || 'Full'}_${new Date().toISOString().slice(0, 10)}.xlsx`,
                withStt: true
            });
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
            currentSessionId = null;   // phiên cũ thuộc site khác; tránh bị nhận nhầm sang site mới
            currentTabId = null;
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



