/*
 * ui_units.js - Đơn vị y tế (CSYTID/Schema): tìm kiếm, gần đây, điền tham số.
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
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

