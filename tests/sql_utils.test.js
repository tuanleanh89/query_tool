const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../code/sql_utils.js');

test('stripCommentsAndLiterals: bỏ comment và chuỗi, giữ từ khóa thật', () => {
    const s = U.stripCommentsAndLiterals("SELECT 'DELETE FROM x', \"UPDATE\" -- DROP TABLE a\nFROM t /* WHERE 1=1 */");
    assert.ok(!/DELETE|DROP|WHERE/i.test(s), s);
    assert.ok(/SELECT/.test(s) && /FROM t/.test(s));
});

test('stripCommentsAndLiterals: chuỗi có dấu nháy kép escape và q-quote', () => {
    const s = U.stripCommentsAndLiterals("SELECT 'it''s UPDATE', q'[x' DELETE ]' FROM dual");
    assert.ok(!/UPDATE|DELETE/.test(s), s);
    assert.ok(/FROM dual/.test(s));
});

test('analyze: SELECT thường là chỉ đọc, an toàn', () => {
    const a = U.analyze('SELECT * FROM DMC.DMC_THE_BHYT WHERE ROWNUM <= 50');
    assert.equal(a.kind, 'SELECT');
    assert.equal(a.isReadOnly, true);
    assert.equal(a.isProcedure, false);
    assert.equal(a.level, 'safe');
});

test('analyze: từ khóa nguy hiểm trong comment/chuỗi không làm cảnh báo sai', () => {
    const a = U.analyze("-- UPDATE x SET a=1\nSELECT 'DELETE FROM t' AS c FROM dual");
    assert.equal(a.level, 'safe');
    assert.equal(a.isReadOnly, true);
});

test('analyze: UPDATE có comment đứng trước vẫn bị nhận diện (bản cũ bị bỏ lọt)', () => {
    const a = U.analyze('-- sửa\nUPDATE t SET a = 1');
    assert.equal(a.kind, 'DML');
    assert.equal(a.missingWhere, true);
    assert.equal(a.level, 'block');
});

test('analyze: WHERE chỉ nằm trong comment/chuỗi vẫn bị coi là thiếu WHERE', () => {
    assert.equal(U.analyze("DELETE FROM t -- WHERE id=1").missingWhere, true);
    assert.equal(U.analyze("UPDATE t SET a='WHERE'").missingWhere, true);
});

test('analyze: UPDATE/DELETE có WHERE chỉ cảnh báo', () => {
    const a = U.analyze('UPDATE t SET a = 1 WHERE id = 5');
    assert.equal(a.missingWhere, false);
    assert.equal(a.level, 'safe'); // DML trực tiếp do UI xác nhận riêng, không cộng dồn cảnh báo khối
    assert.equal(a.kind, 'DML');
    assert.equal(a.isReadOnly, false);
});

test('analyze: khối PL/SQL chứa DML bị cảnh báo; khối chỉ gọi thủ tục thì không', () => {
    const w = U.analyze('BEGIN UPDATE t SET a=1 WHERE id=2; COMMIT; END;');
    assert.equal(w.kind, 'PLSQL');
    assert.equal(w.isProcedure, true);
    assert.equal(w.level, 'warn');
    const p = U.analyze('BEGIN S.PKG.PROC(I_HID => 1, O_CUR => :c); END;');
    assert.equal(p.level, 'safe');
    assert.equal(p.isProcedure, true);
});

test('analyze: DELETE thiếu WHERE trong khối PL/SQL: cảnh báo; DML trực tiếp: chặn', () => {
    const a = U.analyze('BEGIN DELETE FROM t; END;');
    assert.equal(a.missingWhere, true);
    assert.equal(a.level, 'warn');
    assert.equal(U.analyze('DELETE FROM t').level, 'block');
});

test('analyze: v.DELETE (phương thức collection) không bị coi là DML', () => {
    const a = U.analyze('DECLARE v t_arr := t_arr(); BEGIN v.DELETE; END;');
    assert.equal(a.hasDML, false);
    assert.equal(a.missingWhere, false);
});

test('analyze: MERGE không bị báo thiếu WHERE oan', () => {
    const a = U.analyze('MERGE INTO a USING b ON (a.id=b.id) WHEN MATCHED THEN UPDATE SET a.x=b.x');
    assert.equal(a.missingWhere, false);
});

test('analyze: DDL và DROP/TRUNCATE được cảnh báo', () => {
    assert.equal(U.analyze('DROP TABLE t').destructiveDDL, true);
    assert.equal(U.analyze('DROP TABLE t').level, 'warn');
    assert.equal(U.analyze('TRUNCATE TABLE t').level, 'warn');
    assert.equal(U.analyze('ALTER TABLE t ADD c NUMBER').level, 'warn');
});

test('analyze: CREATE OR REPLACE PROCEDURE là biên dịch, không cảnh báo DDL kép', () => {
    const a = U.analyze('CREATE OR REPLACE PROCEDURE p IS BEGIN UPDATE t SET a=1 WHERE b=2; END;');
    assert.equal(a.isCompile, true);
    assert.equal(a.missingWhere, false);
});

test('analyze: FOR UPDATE bị cảnh báo, không bị nhầm thành UPDATE thiếu WHERE', () => {
    const a = U.analyze('SELECT * FROM t WHERE id=1 FOR UPDATE NOWAIT');
    assert.equal(a.forUpdate, true);
    assert.equal(a.missingWhere, false);
    assert.equal(a.isReadOnly, false);
    assert.equal(a.level, 'warn');
});

test('analyze: EXECUTE IMMEDIATE được cảnh báo', () => {
    assert.equal(U.analyze("BEGIN EXECUTE IMMEDIATE 'drop table x'; END;").hasDynamic, true);
});

test('analyze: chế độ chỉ đọc chặn mọi thứ ngoài SELECT/WITH', () => {
    assert.equal(U.analyze('SELECT 1 FROM dual', { readOnlyMode: true }).level, 'safe');
    assert.equal(U.analyze('WITH a AS (SELECT 1 x FROM dual) SELECT * FROM a', { readOnlyMode: true }).level, 'safe');
    assert.equal(U.analyze('UPDATE t SET a=1 WHERE b=2', { readOnlyMode: true }).level, 'block');
    assert.equal(U.analyze('BEGIN p; END;', { readOnlyMode: true }).level, 'block');
    assert.equal(U.analyze('SELECT * FROM t FOR UPDATE', { readOnlyMode: true }).level, 'block');
});

test('analyze: SELECT dùng tham số có tên (=>) vẫn là truy vấn phân trang được', () => {
    const a = U.analyze('SELECT pkg.fn(p_a => 1) AS v FROM dual');
    assert.equal(a.isProcedure, false);
    assert.equal(a.kind, 'SELECT');
});

test('analyze: CALL/EXEC chạy theo kênh thủ tục; chuỗi chứa chữ "CALL " không bị nhầm', () => {
    assert.equal(U.analyze('CALL pkg.proc(1)').isProcedure, true);
    assert.equal(U.analyze("SELECT 'PLEASE CALL ME' FROM dual").isProcedure, false);
});

test('applyPaging: bỏ dấu ; cuối câu và ghép OFFSET/FETCH', () => {
    const r = U.applyPaging('SELECT * FROM t ORDER BY id;', { offset: 100, pageSize: 50 });
    assert.equal(r.appended, true);
    assert.equal(r.unstableOrder, false);
    assert.ok(!r.sql.includes(';'));
    assert.ok(r.sql.endsWith('OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY'));
});

test('applyPaging: comment cuối câu không nuốt mệnh đề phân trang', () => {
    const r = U.applyPaging('SELECT * FROM t -- ghi chú', { offset: 0, pageSize: 10 });
    assert.ok(r.sql.includes('\nOFFSET 0 ROWS'));
});

test('applyPaging: có sẵn OFFSET/FETCH thì giữ nguyên; chữ OFFSET trong chuỗi thì không tính', () => {
    assert.equal(U.applyPaging('SELECT * FROM t OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY', { offset: 0, pageSize: 10 }).appended, false);
    assert.equal(U.applyPaging("SELECT 'OFFSET 1 ROWS' FROM t", { offset: 0, pageSize: 10 }).appended, true);
});

test('applyPaging: cảnh báo thiếu ORDER BY ở mức ngoài cùng', () => {
    assert.equal(U.applyPaging('SELECT * FROM t', { offset: 0, pageSize: 10 }).unstableOrder, true);
    assert.equal(U.applyPaging('SELECT * FROM (SELECT * FROM t ORDER BY id)', { offset: 0, pageSize: 10 }).unstableOrder, true);
    assert.equal(U.applyPaging('SELECT * FROM t ORDER BY id', { offset: 0, pageSize: 10 }).unstableOrder, false);
});

test('applyPaging: noLimit', () => {
    const r = U.applyPaging('SELECT * FROM t', { noLimit: true, maxRows: 100000 });
    assert.ok(r.sql.endsWith('FETCH NEXT 100000 ROWS ONLY'));
});

test('buildCountSql: chịu được ; và comment cuối câu', () => {
    const s = U.buildCountSql('SELECT * FROM t -- x;');
    assert.ok(s.endsWith('\n)'));
    assert.ok(!s.includes('-- x;)'));
});

test('extractWindowTotal: theo alias, theo tên TOTAL, và không có window', () => {
    assert.equal(U.extractWindowTotal('SELECT a, COUNT(*) OVER () AS TONG FROM t', { A: 1, TONG: '1250' }), 1250);
    assert.equal(U.extractWindowTotal('SELECT a, COUNT(*) OVER (PARTITION BY NVL(b,0)) cnt FROM t', { a: 1, CNT: 7 }), 7);
    assert.equal(U.extractWindowTotal('SELECT a, COUNT(*) OVER () FROM t', { a: 1, TOTAL: 9 }), 9);
    assert.equal(U.extractWindowTotal('SELECT a FROM t', { a: 1 }), null);
    assert.equal(U.extractWindowTotal("SELECT 'COUNT(*) OVER (' FROM t", { TOTAL: 3 }), null);
});

test('isSessionExpired: lệnh ghi (strict) không chạy lại vì lỗi chung chung', () => {
    const generic = { error_code: 1, result: '', error_msg: 'ORA-00001: unique constraint' };
    assert.equal(U.isSessionExpired(generic, false), true);   // đọc: giữ hành vi cũ
    assert.equal(U.isSessionExpired(generic, true), false);   // ghi: không retry
    assert.equal(U.isSessionExpired({ result: 'session=NULL' }, true), true);
    assert.equal(U.isSessionExpired({ error_code: 2 }, true), true);
    assert.equal(U.isSessionExpired({ error_code: 0, result: '[]' }, false), false);
});

test('isJwtExpired', () => {
    const mk = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
    const now = 1_700_000_000_000;
    assert.equal(U.isJwtExpired(mk(now / 1000 + 3600), now), false);
    assert.equal(U.isJwtExpired(mk(now / 1000 + 30), now), true);   // còn < 60s coi như hết hạn
    assert.equal(U.isJwtExpired(null, now), true);
    assert.equal(U.isJwtExpired('abc', now), true);
});
