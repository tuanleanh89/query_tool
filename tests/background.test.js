const test = require('node:test');
const assert = require('node:assert/strict');

// ---- Mô phỏng môi trường extension -------------------------------------------------
const store = {};
global.chrome = {
    storage: {
        local: {
            async get(keys) {
                const out = {};
                for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
                return out;
            },
            async set(obj) { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
            async remove(keys) { for (const k of [].concat(keys)) delete store[k]; }
        }
    }
};

let calls = [];      // mọi request gửi tới RestService
let handler = null;  // (payload) => response object
global.fetch = async (url, init) => {
    if (String(url).includes('127.0.0.1:8080')) return { ok: true, text: async () => '' };   // log tới daemon
    const payload = JSON.parse(init.body);
    calls.push(payload);
    const res = handler(payload);
    return { ok: true, text: async () => JSON.stringify(res) };
};

const B = require('../code/background.js');

// Khóa AES thật của Node (thay cho IndexedDB trong service worker)
const nodeCrypto = require('node:crypto');
global.crypto = nodeCrypto.webcrypto;
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
let testKey = null;
B._setKeyProvider(async () => testKey || (testKey = await nodeCrypto.webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])));
async function seedCreds(site, username, password) {
    const box = await (async () => { const iv = nodeCrypto.webcrypto.getRandomValues(new Uint8Array(12)); const key = await (testKey || (testKey = await nodeCrypto.webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']))); const ct = await nodeCrypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password)); return { iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') }; })();
    store.siteCredentials = Object.assign(store.siteCredentials || {}, { [site]: { username, passwordEnc: box } });
}

function jwt(expSecFromNow) {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecFromNow })).toString('base64url');
    return `h.${payload}.s`;
}
let tokenSeq = 0;
function loginOk() { return { error_code: 0, result: JSON.stringify({ UUID: jwt(3600) + '.' + (++tokenSeq) }) }; }
function reset() {
    for (const k of Object.keys(store)) delete store[k];
    calls = [];
    tokenSeq = 0;
    for (const k of Object.keys(B._cachedUsers)) delete B._cachedUsers[k];
    store.siteCredentials = { hung_yen: { username: 'u', password: 'p' } };   // bản ghi dạng cũ: phải vẫn dùng được và tự nâng cấp
}
const funcs = () => calls.map(c => c.func);

test('chưa cấu hình riêng: dùng tài khoản mặc định, đăng nhập và chạy luôn', async () => {
    reset(); delete store.siteCredentials;
    handler = (p) => p.func === 'doLogin' ? loginOk() : { error_code: 0, result: [{ A: 1 }] };
    const r = await B.handleSqlExecution('SELECT 1 FROM dual ORDER BY 1', 'hung_yen');
    assert.equal(r.success, true);
    assert.ok(!r.needCredentials);
    assert.deepEqual(funcs(), ['doLogin', 'ajaxCALL_SP_O']);
});
test('SELECT: đăng nhập lần đầu, ghép phân trang, bỏ dấu ; cuối câu', async () => {
    reset();
    handler = (p) => p.func === 'doLogin' ? loginOk() : { error_code: 0, result: [{ A: 1 }] };
    const r = await B.handleSqlExecution('SELECT a FROM t ORDER BY a;', 'hung_yen', 1, 50);
    assert.equal(r.success, true);
    assert.deepEqual(funcs(), ['doLogin', 'ajaxCALL_SP_O']);
    const sent = calls[1].params[1];
    assert.ok(sent.includes('OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY'), sent);
    assert.ok(!sent.includes(';'), sent);
    assert.equal(r.totalRows, 1);          // < pageSize: biết ngay tổng số dòng
    assert.equal(r.warning, undefined);
});

test('SELECT hết phiên giữa chừng: tự đăng nhập lại và chạy lại đúng 1 lần', async () => {
    reset();
    store.cachedUser_hung_yen = { UUID: jwt(3600) };
    let n = 0;
    handler = (p) => {
        if (p.func === 'doLogin') return loginOk();
        return (++n === 1) ? { error_code: 2, result: 'session=NULL' } : { error_code: 0, result: [{ A: 1 }] };
    };
    const r = await B.handleSqlExecution('SELECT a FROM t ORDER BY a', 'hung_yen');
    assert.equal(r.success, true);
    assert.deepEqual(funcs(), ['ajaxCALL_SP_O', 'doLogin', 'ajaxCALL_SP_O']);
});

test('Thủ tục/ghi: lỗi chung chung (không phải hết phiên) KHÔNG bị chạy lại', async () => {
    reset();
    store.cachedUser_hung_yen = { UUID: jwt(3600) };
    handler = (p) => ({ error_code: 1, result: '', error_msg: 'ORA-06512: at line 1' });
    const r = await B.handleSqlExecution('BEGIN S.PKG.PROC(I_A => 1); END;', 'hung_yen');
    assert.equal(r.success, false);
    assert.equal(calls.length, 1);               // bản cũ sẽ gọi 3 lần (gọi, đăng nhập, gọi lại)
    assert.ok(calls[0].params[1].endsWith('$$'));
});

test('Thủ tục/ghi: hết phiên chắc chắn (error_code 2) vẫn được đăng nhập lại', async () => {
    reset();
    store.cachedUser_hung_yen = { UUID: jwt(3600) };
    let n = 0;
    handler = (p) => {
        if (p.func === 'doLogin') return loginOk();
        return (++n === 1) ? { error_code: 2, error_msg: 'phiên làm việc hết hạn' } : { error_code: 0, result: [{ X: 1 }] };
    };
    const r = await B.handleSqlExecution('BEGIN P(I_A => 1); END;', 'hung_yen');
    assert.equal(r.success, true);
    assert.deepEqual(funcs(), ['ajaxCALL_SP_O', 'doLogin', 'ajaxCALL_SP_O']);
});

test('Nhiều yêu cầu cùng hết phiên: chỉ đăng nhập một lần', async () => {
    reset();
    store.cachedUser_hung_yen = { UUID: jwt(30) };   // < 60s => coi như hết hạn ngay
    handler = (p) => p.func === 'doLogin' ? loginOk() : { error_code: 0, result: [{ A: 1 }] };
    await Promise.all([
        B.handleSqlExecution('SELECT 1 a FROM dual ORDER BY 1', 'hung_yen'),
        B.handleSqlExecution('SELECT 2 a FROM dual ORDER BY 1', 'hung_yen'),
        B.handleSqlExecution('SELECT 3 a FROM dual ORDER BY 1', 'hung_yen')
    ]);
    assert.equal(funcs().filter(f => f === 'doLogin').length, 1);
});

test('toàn quyền SQL: câu UPDATE có WHERE được gửi đi, không bị chặn', async () => {
    reset();
    handler = (p) => p.func === 'doLogin' ? loginOk() : { error_code: 0, result: [] };
    const r = await B.handleSqlExecution('UPDATE t SET a=1 WHERE id=2', 'hung_yen', 1, 50);
    assert.ok(!r.blocked);
    assert.ok(funcs().length >= 2);
});
test('Trang đầy: bóc tổng từ COUNT(*) OVER(), không gọi đếm riêng', async () => {
    reset();
    store.cachedUser_hung_yen = { UUID: jwt(3600) };
    const rows = Array.from({ length: 10 }, (_, i) => ({ A: i, TONG: '1250' }));
    handler = () => ({ error_code: 0, result: rows });
    const r = await B.handleSqlExecution('SELECT a, COUNT(*) OVER () AS TONG FROM t ORDER BY a', 'hung_yen', 1, 10);
    assert.equal(r.totalRows, 1250);
    assert.equal(calls.length, 1);
});

test('Trang đầy, không có window: totalRows=null (đếm ngầm) và cảnh báo thiếu ORDER BY', async () => {
    reset();
    store.cachedUser_hung_yen = { UUID: jwt(3600) };
    const rows = Array.from({ length: 10 }, (_, i) => ({ A: i }));
    handler = () => ({ error_code: 0, result: rows });
    const r = await B.handleSqlExecution('SELECT a FROM t', 'hung_yen', 1, 10);
    assert.equal(r.totalRows, null);
    assert.ok(r.warning && r.warning.includes('ORDER BY'));
});

test('Đếm tổng: bọc subquery, comment cuối câu không phá cú pháp', async () => {
    reset();
    store.cachedUser_hung_yen = { UUID: jwt(3600) };
    handler = () => ({ error_code: 0, result: [{ TOTAL: '77' }] });
    const r = await B.handleSqlCount('SELECT * FROM t -- ghi chú', 'hung_yen');
    assert.equal(r.totalRows, 77);
    assert.ok(calls[0].params[1].includes('-- ghi chú\n)'));
});

test('set_credentials: đăng nhập thử thành công thì lưu; thất bại thì giữ cấu hình cũ', async () => {
    reset();
    handler = (p) => p.params[1] === 'good' ? loginOk() : { error_code: 1, result: '' };
    let r = await B.handleSetCredentials({ siteKey: 'hung_yen', username: 'good', password: 'x' });
    assert.equal(r.success, true);
    assert.equal(store.siteCredentials.hung_yen.username, 'good');

    r = await B.handleSetCredentials({ siteKey: 'hung_yen', username: 'bad', password: 'x' });
    assert.equal(r.success, false);
    assert.equal(store.siteCredentials.hung_yen.username, 'good');   // không bị ghi đè bởi thông tin sai
});

test('get_credentials_status: cả 2 site đã có tài khoản mặc định, không bao giờ trả mật khẩu', async () => {
    reset(); delete store.siteCredentials;
    const r = await B.getCredentialsStatus();
    assert.equal(r.sites.hung_yen.configured, true);
    assert.equal(r.sites.thai_binh.configured, true);
    assert.ok(!JSON.stringify(r).includes('"password"'));
});
test('tài khoản mặc định của từng site khác nhau và được dùng để đăng nhập', async () => {
    reset(); delete store.siteCredentials;
    const users = [];
    handler = (p) => { if (p.func === 'doLogin') { users.push(p.params[1]); return loginOk(); } return { error_code: 0, result: [] }; };
    await B.handleSqlExecution('SELECT 1 a FROM dual ORDER BY 1', 'hung_yen');
    await B.handleSqlExecution('SELECT 1 a FROM dual ORDER BY 1', 'thai_binh');
    assert.equal(users.length, 2);
    assert.notEqual(users[0], users[1]);
});
test('mật khẩu được mã hóa khi lưu, không còn bản rõ trong storage', async () => {
    reset();
    handler = (p) => p.func === 'doLogin' ? loginOk() : { error_code: 0, result: [] };
    const r = await B.handleSetCredentials({ siteKey: 'hung_yen', username: 'abc', password: 'Sup3r-Secret!' });
    assert.equal(r.success, true);
    const raw = JSON.stringify(store.siteCredentials);
    assert.ok(!raw.includes('Sup3r-Secret!'), raw);
    assert.ok(store.siteCredentials.hung_yen.passwordEnc && store.siteCredentials.hung_yen.passwordEnc.ct);
    assert.equal(store.siteCredentials.hung_yen.password, undefined);
    // đăng nhập lại dùng đúng mật khẩu giải mã được
    for (const k of Object.keys(B._cachedUsers)) delete B._cachedUsers[k];
    delete store.cachedUser_hung_yen; calls = [];
    await B.handleSqlExecution('SELECT 1 a FROM dual ORDER BY 1', 'hung_yen');
    assert.equal(calls[0].func, 'doLogin');
    assert.equal(calls[0].params[2], 'Sup3r-Secret!');
});

test('bản ghi dạng cũ (mật khẩu rõ) vẫn dùng được và tự được mã hóa lại', async () => {
    reset();   // reset() tạo bản ghi dạng cũ {username:'u', password:'p'}
    handler = (p) => p.func === 'doLogin' ? loginOk() : { error_code: 0, result: [] };
    await B.handleSqlExecution('SELECT 1 a FROM dual ORDER BY 1', 'hung_yen');
    assert.equal(calls[0].params[2], 'p');
    assert.equal(store.siteCredentials.hung_yen.password, undefined);
    assert.ok(store.siteCredentials.hung_yen.passwordEnc);
});

test('khóa mất/đổi: không giải mã được thì quay về tài khoản mặc định', async () => {
    reset();
    await seedCreds('hung_yen', 'u', 'pw');
    testKey = null;   // khóa mới khác khóa đã mã hóa
    const users = [];
    handler = (p) => { if (p.func === 'doLogin') { users.push(p.params[1]); return loginOk(); } return { error_code: 0, result: [] }; };
    const r = await B.handleSqlExecution('SELECT 1 a FROM dual ORDER BY 1', 'hung_yen');
    assert.ok(!r.needCredentials);
    assert.notEqual(users[0], 'u');
});
test('nhập sai tài khoản mới: giữ nguyên bản mã hóa cũ', async () => {
    reset();
    handler = (p) => p.params[1] === 'good' ? loginOk() : { error_code: 1, result: '' };
    await B.handleSetCredentials({ siteKey: 'hung_yen', username: 'good', password: 'x' });
    const before = JSON.stringify(store.siteCredentials.hung_yen);
    const r = await B.handleSetCredentials({ siteKey: 'hung_yen', username: 'bad', password: 'y' });
    assert.equal(r.success, false);
    assert.equal(JSON.stringify(store.siteCredentials.hung_yen), before);
});
