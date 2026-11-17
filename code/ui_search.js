/*
 * ui_search.js - Tìm kiếm toàn cục xuyên phiên/tab.
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
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
