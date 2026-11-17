/*
 * sql_utils.js - Tiện ích phân tích SQL/PL-SQL dùng chung cho UI (ui.js) và Service Worker (background.js).
 *
 * Mục tiêu: thay các heuristic dựa trên chuỗi thô (startsWith/includes) bằng phân tích đã loại bỏ
 * comment và chuỗi ký tự, để:
 *   - phân loại câu lệnh chính xác (SELECT / DML / DDL / PL-SQL),
 *   - phát hiện lệnh nguy hiểm (UPDATE/DELETE thiếu WHERE, DROP/TRUNCATE, EXECUTE IMMEDIATE...),
 *   - ghép phân trang an toàn (không dính dấu ';' hay comment cuối dòng),
 *   - bóc tổng số dòng từ COUNT(*) OVER().
 *
 * Module chạy được trong trình duyệt (global SqlUtils), Service Worker (importScripts) và Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SqlUtils = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const IDENT_CHAR = /[A-Za-z0-9_$#]/;
    const Q_CLOSERS = { '[': ']', '{': '}', '(': ')', '<': '>' };

    /**
     * Thay thế comment bằng khoảng trắng và nội dung chuỗi/định danh trong ngoặc kép bằng giá trị rỗng.
     * Hỗ trợ: -- comment, /* comment *\/, 'chuỗi ''escape''', q'[...]' (và nq'...'), "Identifier".
     * Độ dài không được bảo toàn (chỉ phục vụ phân tích từ khóa, không dùng để hiển thị).
     */
    function stripCommentsAndLiterals(sql) {
        const s = String(sql == null ? '' : sql);
        const n = s.length;
        let out = '';
        let i = 0;
        while (i < n) {
            const c = s[i];
            const c2 = s[i + 1];

            if (c === '-' && c2 === '-') {
                while (i < n && s[i] !== '\n') i++;
                continue;
            }
            if (c === '/' && c2 === '*') {
                const end = s.indexOf('*/', i + 2);
                i = end === -1 ? n : end + 2;
                out += ' ';
                continue;
            }
            // q'[...]' : chuỗi với ký tự phân cách tùy chọn
            if ((c === 'q' || c === 'Q') && c2 === "'" && i + 2 < n && !(i > 0 && IDENT_CHAR.test(s[i - 1]))) {
                const open = s[i + 2];
                const close = Q_CLOSERS[open] || open;
                const end = s.indexOf(close + "'", i + 3);
                i = end === -1 ? n : end + 2;
                out += "''";
                continue;
            }
            if (c === "'") {
                i++;
                while (i < n) {
                    if (s[i] === "'") {
                        if (s[i + 1] === "'") { i += 2; continue; }
                        i++;
                        break;
                    }
                    i++;
                }
                out += "''";
                continue;
            }
            if (c === '"') {
                const end = s.indexOf('"', i + 1);
                i = end === -1 ? n : end + 1;
                out += '"_"';
                continue;
            }
            out += c;
            i++;
        }
        return out;
    }

    /** Từ khóa đầu tiên của câu lệnh (đã bỏ comment, ngoặc mở và nhãn <<label>>). */
    function firstKeyword(cleaned) {
        const m = /^[\s(]*(?:<<\s*\w+\s*>>\s*)?([A-Za-z_]+)/.exec(cleaned);
        return m ? m[1].toUpperCase() : '';
    }

    /** Kiểm tra có ORDER BY ở mức ngoài cùng (không nằm trong ngoặc con). */
    function hasTopLevelOrderBy(cleaned) {
        let depth = 0;
        const up = cleaned.toUpperCase();
        for (let i = 0; i < up.length; i++) {
            const ch = up[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth = Math.max(0, depth - 1);
            else if (depth === 0 && ch === 'O' && /^ORDER\s+BY\b/.test(up.slice(i, i + 24)) && !(i > 0 && IDENT_CHAR.test(up[i - 1]))) {
                return true;
            }
        }
        return false;
    }

    function hasPagingClause(cleaned) {
        return /\bOFFSET\s+[\w:]+\s+ROWS?\b/i.test(cleaned) || /\bFETCH\s+(?:FIRST|NEXT)\b/i.test(cleaned);
    }

    /** Bỏ dấu ';' và '/' kết thúc câu lệnh để có thể ghép OFFSET/FETCH hoặc bọc subquery. */
    function stripTrailingTerminator(sql) {
        let s = String(sql == null ? '' : sql);
        for (;;) {
            const t = s.replace(/[\s;]+$/, '').replace(/\n\/\s*$/, '');
            if (t === s) break;
            s = t;
        }
        return s;
    }

    /**
     * Ghép mệnh đề phân trang Oracle. Trả về { sql, appended, unstableOrder }.
     * - Không ghép nếu câu lệnh đã có OFFSET/FETCH.
     * - unstableOrder = true khi không có ORDER BY ở ngoài cùng: các trang có thể trùng/sót dòng.
     */
    function applyPaging(sql, opts) {
        const o = opts || {};
        const base = stripTrailingTerminator(sql);
        const cleaned = stripCommentsAndLiterals(base);
        const unstableOrder = !hasTopLevelOrderBy(cleaned);
        if (hasPagingClause(cleaned)) {
            return { sql: base, appended: false, unstableOrder: false };
        }
        const suffix = o.noLimit
            ? `\nFETCH NEXT ${o.maxRows} ROWS ONLY`
            : `\nOFFSET ${o.offset} ROWS FETCH NEXT ${o.pageSize} ROWS ONLY`;
        return { sql: base + suffix, appended: true, unstableOrder };
    }

    /** SQL đếm tổng. Xuống dòng trước ')' để comment cuối câu không nuốt dấu đóng ngoặc. */
    function buildCountSql(sql) {
        return `SELECT COUNT(*) as TOTAL FROM (${stripTrailingTerminator(sql)}\n)`;
    }

    /**
     * Phân tích câu lệnh. Kết quả:
     *  kind: SELECT | DML | DDL | PLSQL | CALL | OTHER | EMPTY
     *  isProcedure: câu lệnh phải gửi theo kênh Stored Procedure (bọc $$) thay vì phân trang
     *  isReadOnly: chỉ đọc (SELECT/WITH không có FOR UPDATE, không có DML/DDL)
     *  hasDML / hasDDL / destructiveDDL / hasDynamic / forUpdate / missingWhere
     *  level: safe | warn | block ; reasons: danh sách lý do (tiếng Việt)
     */
    function analyze(sql, opts) {
        const o = opts || {};
        const cleaned = stripCommentsAndLiterals(sql);
        const trimmed = cleaned.trim();
        const result = {
            kind: 'EMPTY', isProcedure: false, isReadOnly: true,
            hasDML: false, hasDDL: false, destructiveDDL: false, isCompile: false,
            hasDynamic: false, forUpdate: false, missingWhere: false,
            level: 'safe', reasons: []
        };
        if (!trimmed) return result;

        const first = firstKeyword(trimmed);
        const noForUpdate = trimmed.replace(/\bFOR\s+UPDATE\b(?:\s+(?:OF\s+[\w.,\s]+?|NOWAIT|WAIT\s+\d+|SKIP\s+LOCKED))*/gi, ' ');
        result.forUpdate = noForUpdate.length !== trimmed.length;

        const isCreateCode = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|VIEW)\b/i.test(trimmed);
        result.isCompile = isCreateCode;

        result.hasDDL = /\b(?:DROP|TRUNCATE|ALTER|RENAME|GRANT|REVOKE|PURGE|FLASHBACK)\b/i.test(noForUpdate) ||
            /^\s*(?:CREATE|COMMENT)\b/i.test(trimmed);
        result.destructiveDDL = /(?<![\w.$#])(?:DROP|TRUNCATE|PURGE)\b/i.test(noForUpdate);
        result.hasDynamic = /\bEXECUTE\s+IMMEDIATE\b/i.test(noForUpdate) || /\bDBMS_SQL\b/i.test(noForUpdate);

        const dmlRe = /(?<![\w.$#])(?:INSERT\s+(?:ALL\s+|FIRST\s+)?INTO|UPDATE|DELETE|MERGE\s+INTO)\b/i;
        result.hasDML = dmlRe.test(noForUpdate);

        // UPDATE/DELETE thiếu WHERE: kiểm tra theo từng phân đoạn ngăn bởi ';'
        if (!isCreateCode) {
            for (const seg of noForUpdate.split(';')) {
                if (/\bMERGE\b/i.test(seg)) continue;
                if (/(?<![\w.$#])(?:UPDATE|DELETE)\b/i.test(seg) && !/\bWHERE\b/i.test(seg)) {
                    // Bỏ qua phương thức collection (v.DELETE) đã được lookbehind loại; DELETE ... FROM bảng vẫn bị bắt
                    result.missingWhere = true;
                    break;
                }
            }
        }

        const isSelectLike = first === 'SELECT' || first === 'WITH';
        const startsBlock = first === 'BEGIN' || first === 'DECLARE';
        const startsCall = first === 'CALL' || first === 'EXEC' || first === 'EXECUTE';

        if (isSelectLike) result.kind = 'SELECT';
        else if (startsBlock) result.kind = 'PLSQL';
        else if (startsCall) result.kind = 'CALL';
        else if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(first)) result.kind = 'DML';
        else if (['CREATE', 'DROP', 'TRUNCATE', 'ALTER', 'RENAME', 'GRANT', 'REVOKE', 'COMMENT'].includes(first)) result.kind = 'DDL';
        else result.kind = 'OTHER';

        // Kênh Stored Procedure: khối PL/SQL, CALL/EXEC, hoặc lời gọi dùng tham số có tên (=>) mà không phải SELECT
        result.isProcedure = startsBlock || startsCall || (!isSelectLike && /=>/.test(trimmed));

        result.isReadOnly = isSelectLike && !result.hasDML && !result.hasDDL && !result.forUpdate && !result.hasDynamic;

        // Đánh giá mức độ rủi ro
        const reasons = result.reasons;
        if (o.readOnlyMode && !result.isReadOnly) {
            result.level = 'block';
            reasons.push('Chế độ CHỈ ĐỌC đang bật: chỉ cho phép SELECT/WITH.');
            return result;
        }
        if (result.missingWhere) {
            // Lệnh DML trực tiếp: chặn hẳn. Bên trong khối PL/SQL (vd. dọn bảng tạm): cảnh báo mức cao, người dùng quyết định.
            result.level = result.kind === 'DML' ? 'block' : 'warn';
            reasons.push('Có lệnh UPDATE/DELETE không có điều kiện WHERE.');
        }
        if (result.level !== 'block') {
            if (result.destructiveDDL) { result.level = 'warn'; reasons.push('Có lệnh xóa cấu trúc (DROP/TRUNCATE/PURGE).'); }
            else if (result.hasDDL && !isCreateCode) { result.level = 'warn'; reasons.push('Có lệnh thay đổi cấu trúc/quyền (DDL).'); }
            if (result.hasDML && result.kind !== 'DML') { result.level = 'warn'; reasons.push('Khối lệnh có chứa INSERT/UPDATE/DELETE/MERGE.'); }
            if (result.hasDynamic) { result.level = 'warn'; reasons.push('Có SQL động (EXECUTE IMMEDIATE/DBMS_SQL), không kiểm tra được nội dung.'); }
            if (result.forUpdate) { result.level = 'warn'; reasons.push('SELECT ... FOR UPDATE sẽ khóa dòng dữ liệu.'); }
        }
        return result;
    }

    /**
     * Bóc tổng số dòng từ cột COUNT(*) OVER(...) của dòng đầu tiên.
     * Trả về số nguyên > 0 hoặc null nếu không xác định được.
     */
    function extractWindowTotal(sql, firstRow) {
        if (!firstRow || typeof firstRow !== 'object') return null;
        const cleaned = stripCommentsAndLiterals(sql);
        if (!/COUNT\s*\(\s*\*\s*\)\s*OVER\s*\(/i.test(cleaned)) return null;

        const keys = Object.keys(firstRow);
        const read = (key) => {
            const v = parseInt(firstRow[key], 10);
            return Number.isFinite(v) && v > 0 ? v : null;
        };
        const m = /COUNT\s*\(\s*\*\s*\)\s*OVER\s*\((?:[^()]|\([^()]*\))*\)\s*(?:AS\s+)?([A-Za-z0-9_#$]+)/i.exec(cleaned);
        const alias = m ? m[1].toUpperCase() : null;
        if (alias && alias !== 'FROM' && alias !== 'ORDER') {
            for (const k of keys) {
                if (k.toUpperCase() === alias) {
                    const v = read(k);
                    if (v !== null) return v;
                }
            }
        }
        for (const k of keys) {
            const u = k.toUpperCase();
            if (u === 'TOTAL' || u === 'TOTAL_ROWS' || u === 'TOTALROWS') {
                const v = read(k);
                if (v !== null) return v;
            }
        }
        return null;
    }

    /** Đã hết hạn phiên? strict=true: chỉ chấp nhận tín hiệu chắc chắn (dùng cho lệnh ghi, tránh chạy lại lệnh có tác dụng phụ). */
    function isSessionExpired(res, strict) {
        if (!res) return false;
        const msg = String(res.error_msg || '').toLowerCase();
        const result = typeof res.result === 'string' ? res.result.trim() : '';
        const definite = result === 'session=NULL' || res.error_code === 2 ||
            msg.includes('phiên') || msg.includes('hết hạn');
        if (definite) return true;
        if (strict) return false;
        return msg.includes('session') ||
            msg.includes('đã có lỗi xảy ra khi xử lý dữ liệu') ||
            (res.error_code !== 0 && (!res.result || res.result === '' || res.result === '[]'));
    }

    function isJwtExpired(token, now) {
        if (!token || typeof token !== 'string') return true;
        try {
            const parts = token.split('.');
            if (parts.length < 2) return true;
            let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
            const decoded = JSON.parse(json);
            if (decoded && decoded.exp) {
                return (decoded.exp * 1000) <= ((now || Date.now()) + 60000);
            }
        } catch (e) { /* token không phải JWT chuẩn: coi như còn hạn, để server quyết định */ }
        return false;
    }

    return {
        stripCommentsAndLiterals, firstKeyword, hasTopLevelOrderBy, hasPagingClause,
        stripTrailingTerminator, applyPaging, buildCountSql, analyze, extractWindowTotal,
        isSessionExpired, isJwtExpired
    };
}));
