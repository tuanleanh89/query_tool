/*
 * ui_state.js - Biến trạng thái toàn cục của giao diện.
 * Tách nguyên văn từ ui.js (v1.2.0), không đổi logic. Các tệp ui_*.js dùng chung phạm vi toàn cục
 * và phải được nạp đúng thứ tự trong ui.html.
 */
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
let storageReady = false; // chỉ cho phép ghi storage sau khi đã nạp xong dữ liệu cũ (tránh ghi đè bằng dữ liệu rỗng)
let tabsBySite = { hung_yen: [], thai_binh: [] };
let sessionsBySite = { hung_yen: [], thai_binh: [] };
let currentSessionId = null;
let currentSessionIdBySite = { hung_yen: null, thai_binh: null };
let currentTabId = null;
let isDarkMode = false;
let tabModels = {}; 
let tabViewStates = {}; 

