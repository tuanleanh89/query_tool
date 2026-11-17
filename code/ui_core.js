/*
 * ui_core.js - Tiện ích lõi: escapeHtml, tài khoản hệ thống, chế độ chỉ đọc, xuất Excel theo khối, lớp phủ loading.
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Tài khoản hệ thống & chế độ chỉ đọc (v1.2.0)
// ---------------------------------------------------------------------------
const SITE_LABELS = { hung_yen: 'Hưng Yên', thai_binh: 'Thái Bình' };
let credentialPromptInFlight = null;

function bgSend(message) {
    return new Promise((resolve) => {
        try {
            _origSendMessage(message, (resp) => resolve(resp || { success: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Không có phản hồi' }));
        } catch (e) {
            resolve({ success: false, error: e.message });
        }
    });
}

/** Hiện hộp thoại nhập tài khoản cho một site. Trả về true nếu đã lưu và đăng nhập thử thành công. */
async function promptCredentials(siteKey, reasonText) {
    if (credentialPromptInFlight) return credentialPromptInFlight;
    credentialPromptInFlight = (async () => {
        if (typeof hideLoading === 'function') hideLoading();   // lớp phủ "Đang xử lý" không được che hộp thoại
        const label = SITE_LABELS[siteKey] || siteKey;
        const status = await bgSend({ action: 'get_credentials_status' });
        const currentUser = (status && status.sites && status.sites[siteKey] && status.sites[siteKey].username) || '';
        for (;;) {
            const r = await Swal.fire({
                title: `Tài khoản hệ thống - ${label}`,
                html: `
                    <div style="text-align:left;font-size:13px">
                        <p class="mb-2 text-muted">${escapeHtml(reasonText || 'Nhập tài khoản dùng để thực thi truy vấn trên site này.')}</p>
                        <label class="form-label mb-1">Tài khoản</label>
                        <input id="credUser" class="swal2-input m-0 w-100" autocomplete="off" value="${escapeHtml(currentUser)}">
                        <label class="form-label mt-2 mb-1">Mật khẩu</label>
                        <input id="credPass" type="password" class="swal2-input m-0 w-100" autocomplete="new-password">
                        <p class="small text-muted mt-2 mb-0">Thông tin chỉ lưu trong bộ nhớ của extension trên máy này, không nằm trong mã nguồn.</p>
                    </div>`,
                showCancelButton: true,
                confirmButtonText: 'Lưu & đăng nhập thử',
                cancelButtonText: 'Để sau',
                focusConfirm: false,
                preConfirm: () => {
                    const u = document.getElementById('credUser').value.trim();
                    const pw = document.getElementById('credPass').value;
                    if (!u || !pw) { Swal.showValidationMessage('Vui lòng nhập đủ tài khoản và mật khẩu.'); return false; }
                    return { u, pw };
                }
            });
            if (!r.isConfirmed) return false;
            Swal.fire({ title: 'Đang đăng nhập thử...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const resp = await bgSend({ action: 'set_credentials', siteKey, username: r.value.u, password: r.value.pw });
            Swal.close();
            if (resp && resp.success) {
                Swal.fire({ icon: 'success', title: 'Đã lưu tài khoản', timer: 1400, showConfirmButton: false });
                return true;
            }
            await Swal.fire({ icon: 'error', title: 'Không đăng nhập được', text: (resp && resp.error) || 'Lỗi không xác định' });
        }
    })().finally(() => { credentialPromptInFlight = null; });
    return credentialPromptInFlight;
}

// Mọi lệnh gửi sang background nếu báo "chưa có tài khoản" sẽ tự hỏi người dùng rồi gửi lại đúng 1 lần.
const _origSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
chrome.runtime.sendMessage = function (message, callback) {
    if (typeof callback !== 'function') return _origSendMessage(message, callback);
    _origSendMessage(message, async (resp) => {
        if (resp && resp.needCredentials) {
            // Lớp phủ "Đang thực thi..." nằm đè lên hộp thoại nên phải ẩn đi khi hỏi tài khoản, rồi hiện lại nếu chạy tiếp
            const overlay = document.getElementById('loadingOverlay');
            const msgEl = document.getElementById('loadingMessage');
            const wasLoading = !!(overlay && !overlay.classList.contains('d-none'));
            const loadingText = msgEl ? msgEl.innerText : undefined;
            if (wasLoading) hideLoading();

            let ok = false;
            try {
                ok = await promptCredentials(resp.siteKey || (message && message.siteKey), resp.error);
            } catch (e) {
                console.error('Lỗi hộp thoại tài khoản:', e);
            }
            if (ok) {
                if (wasLoading) showLoading(loadingText);
                _origSendMessage(message, callback);
                return;
            }
        }
        callback(resp);
    });
};

/** Đã có tài khoản cho site chưa? Chưa có thì hỏi ngay (trước khi bật lớp phủ). Trả về true nếu dùng được. */
async function ensureCredentialsConfigured(siteKey) {
    const st = await bgSend({ action: 'get_credentials_status' });
    const configured = !!(st && st.success && st.sites && st.sites[siteKey] && st.sites[siteKey].configured);
    if (configured) return true;
    return await promptCredentials(siteKey, 'Site này chưa có tài khoản hệ thống để thực thi truy vấn.');
}

/**
 * Xuất Excel theo từng khối (mặc định 5.000 dòng) có thanh tiến trình, nhường luồng giao diện giữa các khối
 * để không treo trình duyệt khi xuất tới 100.000 dòng. Không nhân đôi dữ liệu trong bộ nhớ như json_to_sheet(map(...)).
 */
async function exportRowsToExcel(rows, options) {
    const o = Object.assign({ sheetName: 'Result', fileName: 'Export.xlsx', withStt: false, chunkSize: 5000 }, options || {});
    const total = rows.length;

    Swal.fire({
        title: 'Đang tạo file Excel...',
        html: `<div class="mb-2">Đang xử lý <b id="xlsxProgText">0 / ${total.toLocaleString('vi-VN')}</b> dòng</div>
               <div class="progress" style="height:10px"><div id="xlsxProgBar" class="progress-bar" style="width:0%"></div></div>`,
        allowOutsideClick: false,
        showConfirmButton: false
    });
    const setProgress = (done) => {
        const t = document.getElementById('xlsxProgText');
        const b = document.getElementById('xlsxProgBar');
        if (t) t.innerText = `${done.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')}`;
        if (b) b.style.width = `${Math.round(done * 100 / Math.max(total, 1))}%`;
    };
    const yieldToUi = () => new Promise(r => setTimeout(r, 0));

    try {
        const headerSet = new Set();
        if (o.withStt) headerSet.add('STT');
        for (const r of rows) for (const k of Object.keys(r)) headerSet.add(k);
        const headers = Array.from(headerSet);

        const ws = XLSX.utils.aoa_to_sheet([headers]);
        for (let i = 0; i < total; i += o.chunkSize) {
            const part = rows.slice(i, i + o.chunkSize);
            const shaped = o.withStt ? part.map((row, j) => Object.assign({ STT: i + j + 1 }, row)) : part;
            XLSX.utils.sheet_add_json(ws, shaped, { header: headers, skipHeader: true, origin: i + 1 });
            setProgress(Math.min(i + o.chunkSize, total));
            await yieldToUi();
        }
        if (o.withStt) ws['!cols'] = [{ wch: 8 }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, o.sheetName);
        XLSX.writeFile(wb, o.fileName);
        Swal.close();
        return true;
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Lỗi xuất Excel', text: err.message });
        return false;
    }
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

