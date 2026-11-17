/*
 * ui_query.js - Thực thi truy vấn, phân trang, bảng kết quả, làm sạch/định dạng SQL.
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
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

// Vỏ an toàn: dù bên trong có lỗi bất ngờ, nút "Thực hiện" không bao giờ bị kẹt ở trạng thái khóa và loading luôn tắt.
async function executeWithPagination() {
	try {
		await executeWithPaginationImpl();
	} catch (err) {
		console.error('[EXECUTE] Lỗi không mong muốn:', err);
		try { if (typeof hideLoading === 'function') hideLoading(); } catch (e) { /* bỏ qua */ }
		const btn = document.getElementById('btnExecute');
		if (btn) btn.disabled = false;
		const st = document.getElementById('status');
		if (st) { st.className = 'text-danger'; st.innerText = '❌ Lỗi giao diện: ' + (err && err.message ? err.message : err); }
	}
}

async function executeWithPaginationImpl() {
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

	const analysis = SqlUtils.analyze(content);
	const isNonQuery = analysis.kind === 'DML';

	// Khối PL/SQL / DDL / SQL động có rủi ro: xác nhận rõ ràng trước khi chạy (không áp dụng cho CREATE OR REPLACE, đã có hộp thoại biên dịch riêng)
	if (!isNonQuery && !analysis.isCompile && analysis.level === 'warn') {
		const riskResult = await Swal.fire({
			icon: 'warning',
			title: 'Câu lệnh có rủi ro',
			html: '<ul style="text-align:left;font-size:14px;margin:0 0 0 18px">' + analysis.reasons.map(r => '<li>' + escapeHtml(r) + '</li>').join('') + '</ul><p class="mt-2 mb-0 small text-muted">Hệ thống có thể tự động COMMIT. Bạn có chắc chắn muốn thực thi?</p>',
			showCancelButton: true,
			confirmButtonColor: '#dc3545',
			confirmButtonText: 'Vẫn thực thi',
			cancelButtonText: 'Hủy'
		});
		if (!riskResult.isConfirmed) {
			document.getElementById('btnExecute').disabled = false;
			statusEl.className = "text-secondary";
			statusEl.innerText = "⚠️ Đã hủy thực thi câu lệnh.";
			return;
		}
	}

	if (isNonQuery) {
		const isUpdateOrDelete = /^\s*(?:UPDATE|DELETE)\b/i.test(SqlUtils.stripCommentsAndLiterals(content));
		if (isUpdateOrDelete) {
			const hasWhere = !analysis.missingWhere;
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

	if (!(await ensureCredentialsConfigured(currentSiteKey))) {
		document.getElementById('btnExecute').disabled = false;
		statusEl.className = "text-danger";
		statusEl.innerText = "🔑 Chưa cấu hình tài khoản hệ thống cho site này (bấm nút Tài khoản).";
		return;
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
		if (response.warning) {
			statusText += ` ⚠️ ${response.warning}`;
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

