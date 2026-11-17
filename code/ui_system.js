/*
 * ui_system.js - Nhật ký thao tác, modal, Jasper Helper, kiểm tra và áp dụng cập nhật.
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
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
						${changelog.map(item => `<li style="margin-bottom: 4px;">${escapeHtml(item)}</li>`).join('')}
					</ul>
				</div>`
				: '';

			const confirmResult = await Swal.fire({
				title: `Đã có phiên bản mới: v${remoteVersion}`,
				html: `
					<div style="font-size: 14px; text-align: left;">
						<p class="mb-1">Phiên bản hiện tại của bạn: <b>v${currentVersion}</b></p>
						<p class="mb-2 text-muted" style="font-size: 12px;">Ngày phát hành: ${escapeHtml(updateData.release_date || 'Mới nhất')}</p>
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
				await performAutoUpdate(downloadUrl, remoteVersion, (updateData.sha256 && (isFirefox ? updateData.sha256.firefox : updateData.sha256.chrome)) || '');
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

async function performAutoUpdate(downloadUrl, newVersion, sha256) {
	if (!downloadUrl) {
		Swal.fire('Lỗi', 'Không tìm thấy link tải bản cập nhật.', 'error');
		return;
	}

	// 1. Kiểm tra máy chủ Jasper Helper có online để tự ghi đè không (cần mã SHA-256 để xác minh gói tải về)
	let helperReady = false;
	try {
		const res = await fetch('http://localhost:8080/list-logs', { signal: AbortSignal.timeout(1500) });
		if (res.ok) helperReady = true;
	} catch (_) {}

	if (helperReady && !sha256) {
		helperReady = false;   // manifest không có SHA-256: không tự động ghi đè, chuyển sang tải thủ công
	}

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
				body: JSON.stringify({ downloadUrl, sha256 })
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
