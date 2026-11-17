/*
 * ui_tables.js - Bảng kết quả đã lưu và trình sửa dòng.
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
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

	const cleanName = (tbl.name || 'Export').replace(/[/\\?%*:|"<>]/g, '_');
	exportRowsToExcel(tbl.data, {
		sheetName: 'Result',
		fileName: `${cleanName}_${new Date().toISOString().slice(0, 10)}.xlsx`,
		withStt: false
	});
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

