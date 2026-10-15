/*
 * Alphatronic Repair ERP - LAN server
 * ------------------------------------------------------------
 * Run on the MAIN laptop (Manager). The other laptops only need a browser.
 *
 *  - Creates / opens the SQLite database automatically:
 *        <this folder>\database\alphatronic_erp.db
 *  - Serves the web app on http://<this-laptop-name>:8080
 *  - Pushes every change to every connected laptop instantly
 *    over a full-duplex WebSocket (no internet needed).
 *
 * No npm packages required: uses Node's built-in http, crypto and node:sqlite.
 *
 * Usage:
 *   node server.js                     start the server
 *   node server.js --reset-pin ceo     clear a role's PIN (ceo | intake | tech)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const DATA_DIR = process.env.ERP_DATA_DIR || path.join(APP_DIR, 'database');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'alphatronic_erp.db');
const BACKUPS_TO_KEEP = 30;

const ROLES = ['ceo', 'intake', 'tech'];
const ROLE_NAMES = { ceo: 'Manager', intake: 'Front Desk', tech: 'Technician' };
const STATUS = {
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
    WAITING: 'Waiting for CEO Confirmation',
    CONFIRMED: 'CEO Confirmed'
};
const OUTCOMES = ['In Progress', 'Successful', 'Unrepairable'];

// ------------------------------------------------------------------
// Database
// ------------------------------------------------------------------
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const isNewDb = !fs.existsSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);

db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS users (
        role        TEXT PRIMARY KEY,
        pin_hash    TEXT,
        pin_salt    TEXT,
        updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        role        TEXT NOT NULL,
        device      TEXT,
        created_at  TEXT NOT NULL,
        last_seen   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
        id            TEXT PRIMARY KEY,
        customer      TEXT NOT NULL,
        phone         TEXT NOT NULL,
        product       TEXT NOT NULL,
        fee           REAL NOT NULL DEFAULT 0,
        extra_fee     REAL NOT NULL DEFAULT 0,
        deadline      TEXT NOT NULL,
        notes         TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'Pending',
        outcome       TEXT NOT NULL DEFAULT 'In Progress',
        comments      TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        completed_at  TEXT,
        confirmed_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS order_parts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        sku         TEXT NOT NULL,
        qty         INTEGER NOT NULL DEFAULT 1,
        unit_price  REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_parts_order ON order_parts(order_id);

    CREATE TABLE IF NOT EXISTS activity_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        TEXT NOT NULL,
        role      TEXT,
        device    TEXT,
        action    TEXT NOT NULL,
        order_id  TEXT,
        details   TEXT
    );
`);
for (const r of ROLES) {
    db.prepare('INSERT OR IGNORE INTO users (role) VALUES (?)').run(r);
}

const nowIso = () => new Date().toISOString();

function logActivity(session, action, orderId, details) {
    db.prepare('INSERT INTO activity_log (ts, role, device, action, order_id, details) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nowIso(), session ? session.role : null, session ? session.device : null, action, orderId || null,
            details ? JSON.stringify(details) : null);
}

function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

// Daily automatic backup (a consistent copy of the live DB)
function runBackup(tag) {
    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `alphatronic_erp_${stamp}${tag ? '_' + tag : ''}.db`);
    if (fs.existsSync(file)) return file;
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
    while (old.length > BACKUPS_TO_KEEP) fs.unlinkSync(path.join(BACKUP_DIR, old.shift()));
    return file;
}

// ------------------------------------------------------------------
// CLI: --reset-pin <role>
// ------------------------------------------------------------------
const resetIdx = process.argv.indexOf('--reset-pin');
if (resetIdx !== -1) {
    const role = process.argv[resetIdx + 1];
    if (!ROLES.includes(role)) {
        console.error('Usage: node server.js --reset-pin <ceo|intake|tech>');
        process.exit(1);
    }
    db.prepare('UPDATE users SET pin_hash = NULL, pin_salt = NULL, updated_at = ? WHERE role = ?').run(nowIso(), role);
    db.prepare('DELETE FROM sessions WHERE role = ?').run(role);
    console.log(`PIN for ${ROLE_NAMES[role]} cleared. The next person who selects that role will set a new PIN.`);
    process.exit(0);
}

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------
function hashPin(pin, salt) {
    return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function roleHasPin(role) {
    const row = db.prepare('SELECT pin_hash FROM users WHERE role = ?').get(role);
    return !!(row && row.pin_hash);
}

function getSession(token) {
    if (!token || typeof token !== 'string') return null;
    const s = db.prepare('SELECT token, role, device FROM sessions WHERE token = ?').get(token);
    if (!s) return null;
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(nowIso(), token);
    return { token: s.token, role: s.role, device: s.device };
}

const failedLogins = new Map(); // ip -> { count, until }
function isLockedOut(ip) {
    const f = failedLogins.get(ip);
    return f && f.until > Date.now();
}
function noteFailedLogin(ip) {
    const f = failedLogins.get(ip) || { count: 0, until: 0 };
    f.count++;
    if (f.count >= 5) { f.until = Date.now() + 60_000; f.count = 0; }
    failedLogins.set(ip, f);
}

// ------------------------------------------------------------------
// Orders
// ------------------------------------------------------------------
function rowToOrder(row, parts) {
    return {
        id: row.id,
        customer: row.customer,
        phone: row.phone,
        product: row.product,
        fee: row.fee,
        extraFee: row.extra_fee,
        deadline: row.deadline,
        notes: row.notes,
        status: row.status,
        outcome: row.outcome,
        comments: row.comments,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        confirmedAt: row.confirmed_at,
        parts: parts.map(p => ({ sku: p.sku, qty: p.qty, unitPrice: p.unit_price }))
    };
}

function getAllOrders() {
    const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    const parts = db.prepare('SELECT * FROM order_parts ORDER BY id').all();
    const byOrder = {};
    for (const p of parts) (byOrder[p.order_id] = byOrder[p.order_id] || []).push(p);
    return rows.map(r => rowToOrder(r, byOrder[r.id] || []));
}

function getOrder(id) {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) return null;
    return rowToOrder(row, db.prepare('SELECT * FROM order_parts WHERE order_id = ? ORDER BY id').all(id));
}

function orderTotal(o) {
    return (o.fee || 0) + (o.extraFee || 0) + o.parts.reduce((s, p) => s + (p.qty || 1) * (p.unitPrice || 0), 0);
}

// What each role is allowed to receive. The technician never receives money figures.
function orderForRole(o, role) {
    if (role === 'tech') {
        const { fee, extraFee, ...rest } = o;
        return { ...rest, parts: o.parts.map(p => ({ sku: p.sku, qty: p.qty })) };
    }
    return { ...o, total: orderTotal(o) };
}

function nextBillId() {
    const ids = db.prepare("SELECT id FROM orders WHERE id LIKE 'ORD-%'").all();
    let max = 1000;
    for (const { id } of ids) {
        const n = parseInt(id.slice(4), 10);
        if (!isNaN(n) && n > max) max = n;
    }
    return `ORD-${max + 1}`;
}

// ------------------------------------------------------------------
// Validation helpers
// ------------------------------------------------------------------
class UserError extends Error {}
function str(v, field, { required = false, max = 500 } = {}) {
    const s = (v === undefined || v === null) ? '' : String(v).trim();
    if (required && !s) throw new UserError(`${field} is required.`);
    if (s.length > max) throw new UserError(`${field} is too long (max ${max} characters).`);
    return s;
}
function money(v, field) {
    const n = parseFloat(v);
    if (v === '' || v === undefined || v === null) return 0;
    if (isNaN(n) || n < 0) throw new UserError(`${field} must be a positive number.`);
    return Math.round(n * 100) / 100;
}
function cleanParts(list, withPrice) {
    if (!Array.isArray(list)) return [];
    return list
        .map(p => ({
            sku: str(p && p.sku, 'Component SKU / name', { max: 120 }),
            qty: Math.max(1, Math.min(100000, parseInt(p && p.qty, 10) || 1)),
            unitPrice: withPrice ? money(p && p.unitPrice, 'Component price') : 0
        }))
        .filter(p => p.sku);
}

function replaceParts(orderId, parts) {
    db.prepare('DELETE FROM order_parts WHERE order_id = ?').run(orderId);
    const ins = db.prepare('INSERT INTO order_parts (order_id, sku, qty, unit_price) VALUES (?, ?, ?, ?)');
    for (const p of parts) ins.run(orderId, p.sku, p.qty, p.unitPrice || 0);
}

// ------------------------------------------------------------------
// Actions (called over the WebSocket). Each checks the caller's role.
// ------------------------------------------------------------------
const ACTIONS = {
    createOrder: {
        roles: ['intake', 'ceo'],
        run(session, p) {
            const id = str(p.id, 'Bill number', { required: true, max: 40 }).toUpperCase();
            const order = {
                customer: str(p.customer, 'Customer name', { required: true, max: 120 }),
                phone: str(p.phone, 'Contact number', { required: true, max: 40 }),
                product: str(p.product, 'Product name', { required: true, max: 200 }),
                fee: money(p.fee, 'Service payment'),
                deadline: str(p.deadline, 'Release date', { required: true, max: 30 }),
                notes: str(p.notes, 'Fault note', { max: 2000 })
            };
            if (isNaN(new Date(order.deadline).getTime())) throw new UserError('Release date is not valid.');
            if (db.prepare('SELECT 1 FROM orders WHERE id = ?').get(id)) {
                throw new UserError(`Bill number ${id} already exists. Use a different bill number.`);
            }
            const ts = nowIso();
            db.prepare(`INSERT INTO orders (id, customer, phone, product, fee, extra_fee, deadline, notes, status, outcome,
                        comments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'In Progress', '', ?, ?)`)
                .run(id, order.customer, order.phone, order.product, order.fee, order.deadline, order.notes,
                    STATUS.PENDING, ts, ts);
            logActivity(session, 'CREATE_ORDER', id, order);
            return { id };
        }
    },

    updateTechLog: {
        roles: ['tech', 'ceo'],
        run(session, p) {
            const order = getOrder(str(p.id, 'Order', { required: true }));
            if (!order) throw new UserError('Order not found.');
            if (order.status === STATUS.CONFIRMED && session.role !== 'ceo') {
                throw new UserError('This job is already billed by the Manager and is locked.');
            }
            const completed = p.stage === 'COMPLETED';
            let outcome = completed ? p.outcome : 'In Progress';
            if (!OUTCOMES.includes(outcome) || (completed && outcome === 'In Progress')) {
                throw new UserError('Choose a result: Successful or Dead / Unrepairable.');
            }
            // Keep CEO prices for components the technician did not change.
            const oldPrices = {};
            for (const op of order.parts) oldPrices[op.sku.toLowerCase()] = op.unitPrice;
            const parts = cleanParts(p.parts, false).map(np => ({ ...np, unitPrice: oldPrices[np.sku.toLowerCase()] || 0 }));

            let status;
            if (!completed) status = STATUS.IN_PROGRESS;
            else status = order.status === STATUS.CONFIRMED ? STATUS.CONFIRMED : STATUS.WAITING;

            const ts = nowIso();
            transaction(() => {
                db.prepare(`UPDATE orders SET status = ?, outcome = ?, comments = ?, updated_at = ?,
                            completed_at = ?, confirmed_at = ? WHERE id = ?`)
                    .run(status, outcome, str(p.comments, 'Comment', { max: 4000 }), ts,
                        completed ? (order.completedAt || ts) : null,
                        status === STATUS.CONFIRMED ? order.confirmedAt : null, order.id);
                replaceParts(order.id, parts);
            });
            logActivity(session, 'TECH_UPDATE', order.id, { status, outcome, parts });
            return { id: order.id };
        }
    },

    confirmBilling: {
        roles: ['ceo'],
        run(session, p) {
            const order = getOrder(str(p.id, 'Order', { required: true }));
            if (!order) throw new UserError('Order not found.');
            if (order.status !== STATUS.WAITING && order.status !== STATUS.CONFIRMED) {
                throw new UserError('The technician has not completed this job yet.');
            }
            const fee = money(p.fee, 'Service charge');
            const extraFee = money(p.extraFee, 'Extra fee');
            const prices = Array.isArray(p.partPrices) ? p.partPrices : [];
            const parts = order.parts.map((part, i) => ({ ...part, unitPrice: money(prices[i] ?? part.unitPrice, 'Component price') }));
            const ts = nowIso();
            transaction(() => {
                db.prepare('UPDATE orders SET fee = ?, extra_fee = ?, status = ?, confirmed_at = ?, updated_at = ? WHERE id = ?')
                    .run(fee, extraFee, STATUS.CONFIRMED, order.confirmedAt || ts, ts, order.id);
                replaceParts(order.id, parts);
            });
            logActivity(session, 'CEO_CONFIRM', order.id, { fee, extraFee, parts });
            return { id: order.id };
        }
    },

    deleteOrder: {
        roles: ['ceo'],
        run(session, p) {
            const order = getOrder(str(p.id, 'Order', { required: true }));
            if (!order) throw new UserError('Order not found.');
            db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
            // The full record stays in the activity log, so nothing is ever truly lost.
            logActivity(session, 'DELETE_ORDER', order.id, order);
            return { id: order.id };
        }
    },

    resetPin: {
        roles: ['ceo'],
        run(session, p) {
            const role = p.role;
            if (!ROLES.includes(role) || role === 'ceo') throw new UserError('Choose Front Desk or Technician.');
            db.prepare('UPDATE users SET pin_hash = NULL, pin_salt = NULL, updated_at = ? WHERE role = ?').run(nowIso(), role);
            db.prepare('DELETE FROM sessions WHERE role = ?').run(role);
            logActivity(session, 'RESET_PIN', null, { role });
            kickRole(role);
            return { role };
        }
    },

    changeOwnPin: {
        roles: ['ceo', 'intake', 'tech'],
        run(session, p) {
            const pin = String(p.pin || '');
            if (!/^\d{4,8}$/.test(pin)) throw new UserError('PIN must be 4 to 8 digits.');
            const salt = crypto.randomBytes(16).toString('hex');
            db.prepare('UPDATE users SET pin_hash = ?, pin_salt = ?, updated_at = ? WHERE role = ?')
                .run(hashPin(pin, salt), salt, nowIso(), session.role);
            logActivity(session, 'CHANGE_PIN', null, null);
            return { ok: true };
        }
    },

    activityLog: {
        roles: ['ceo'],
        readOnly: true,
        run() {
            return db.prepare('SELECT id, ts, role, device, action, order_id AS orderId FROM activity_log ORDER BY id DESC LIMIT 200').all()
                .map(r => ({ ...r }));
        }
    }
};

// ------------------------------------------------------------------
// Minimal WebSocket server (RFC 6455) - text frames, ping/pong, close
// ------------------------------------------------------------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_MESSAGE = 2 * 1024 * 1024;
const clients = new Set();

function wsSend(client, obj) {
    if (client.closed) return;
    const payload = Buffer.from(JSON.stringify(obj));
    wsWriteFrame(client.socket, 0x1, payload);
}

function wsWriteFrame(socket, opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { socket.write(Buffer.concat([header, payload])); } catch (_) { /* socket already gone */ }
}

function wsClose(client, code = 1000) {
    if (client.closed) return;
    client.closed = true;
    const b = Buffer.alloc(2); b.writeUInt16BE(code, 0);
    wsWriteFrame(client.socket, 0x8, b);
    client.socket.end();
    clients.delete(client);
    broadcastPresence();
}

function handleUpgrade(req, socket) {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    const session = getSession(url.searchParams.get('token'));
    if (url.pathname !== '/ws' || !key || !session) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10_000);

    const client = {
        socket, session, closed: false, alive: true,
        ip: (req.socket.remoteAddress || '').replace('::ffff:', ''),
        connectedAt: nowIso(),
        buffer: Buffer.alloc(0), fragments: []
    };
    clients.add(client);

    socket.on('data', chunk => {
        client.buffer = Buffer.concat([client.buffer, chunk]);
        try { wsParse(client); } catch (e) { wsClose(client, 1002); }
    });
    socket.on('close', () => { client.closed = true; clients.delete(client); broadcastPresence(); });
    socket.on('error', () => { client.closed = true; clients.delete(client); });

    wsSend(client, { type: 'hello', role: session.role, roleName: ROLE_NAMES[session.role], server: serverInfo() });
    sendSnapshot(client);
    broadcastPresence();
}

function wsParse(client) {
    for (;;) {
        const buf = client.buffer;
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2); offset = 4;
        } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2)); offset = 10;
        }
        if (len > MAX_WS_MESSAGE) throw new Error('frame too large');
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + len) return;
        let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
        if (masked) {
            const mask = buf.subarray(offset, offset + 4);
            payload = Buffer.from(payload);
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        }
        client.buffer = buf.subarray(offset + maskLen + len);

        if (opcode === 0x8) { wsClose(client); return; }
        if (opcode === 0x9) { wsWriteFrame(client.socket, 0xA, payload); continue; }
        if (opcode === 0xA) { client.alive = true; continue; }
        if (opcode === 0x1 || opcode === 0x0) {
            client.fragments.push(payload);
            if (fin) {
                const text = Buffer.concat(client.fragments).toString('utf8');
                client.fragments = [];
                client.alive = true;
                handleWsMessage(client, text);
            }
        }
    }
}

function handleWsMessage(client, text) {
    let msg;
    try { msg = JSON.parse(text); } catch (_) { return; }
    if (msg.type === 'ping') { wsSend(client, { type: 'pong' }); return; }
    if (msg.type !== 'action') return;

    // Re-check the session every time: a revoked PIN logs the device out immediately.
    const session = getSession(client.session.token);
    if (!session) { wsSend(client, { type: 'logout', reason: 'Session ended. Please log in again.' }); wsClose(client, 4001); return; }

    const def = ACTIONS[msg.action];
    const reply = (ok, data, error) => wsSend(client, { type: 'result', reqId: msg.reqId, ok, data, error });
    if (!def) return reply(false, null, 'Unknown action.');
    if (!def.roles.includes(session.role)) return reply(false, null, 'You do not have permission for this.');
    try {
        const data = def.run(session, msg.payload || {});
        reply(true, data);
        if (!def.readOnly) broadcastSnapshots();
    } catch (e) {
        if (!(e instanceof UserError)) console.error(`[${msg.action}]`, e);
        reply(false, null, e instanceof UserError ? e.message : 'Server error: ' + e.message);
    }
}

function sendSnapshot(client, allOrders) {
    const orders = allOrders || getAllOrders();
    const role = client.session.role;
    wsSend(client, {
        type: 'snapshot',
        orders: orders.map(o => orderForRole(o, role)),
        nextBillId: role === 'tech' ? null : nextBillId(),
        serverTime: nowIso()
    });
}

function broadcastSnapshots() {
    const all = getAllOrders();
    for (const c of clients) sendSnapshot(c, all);
}

function presenceList() {
    return [...clients].map(c => ({
        role: c.session.role, roleName: ROLE_NAMES[c.session.role],
        device: c.session.device, ip: c.ip, since: c.connectedAt
    }));
}

function broadcastPresence() {
    const list = presenceList();
    for (const c of clients) {
        if (c.session.role === 'ceo') wsSend(c, { type: 'presence', devices: list });
        else wsSend(c, { type: 'presence', count: list.length });
    }
}

function kickRole(role) {
    for (const c of [...clients]) {
        if (c.session.role === role) {
            wsSend(c, { type: 'logout', reason: 'Your PIN was reset by the Manager. Please log in again.' });
            wsClose(c, 4001);
        }
    }
}

// Heartbeat: drop laptops that vanished (Wi-Fi off, lid closed) so presence stays accurate.
setInterval(() => {
    for (const c of [...clients]) {
        if (!c.alive) { c.closed = true; c.socket.destroy(); clients.delete(c); continue; }
        c.alive = false;
        wsWriteFrame(c.socket, 0x9, Buffer.alloc(0));
    }
    broadcastPresence();
}, 20_000);

// ------------------------------------------------------------------
// HTTP: static files + login API + backup/import
// ------------------------------------------------------------------
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
};

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

function readBody(req, limit = 20 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', c => { size += c.length; if (size > limit) { reject(new UserError('Upload too large.')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (_) { reject(new UserError('Invalid data.')); } });
        req.on('error', reject);
    });
}

function lanAddresses() {
    const out = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address });
        }
    }
    return out;
}

function serverInfo() {
    const host = os.hostname();
    return {
        hostname: host,
        port: PORT,
        primaryUrl: `http://${host}:${PORT}`,
        ipUrls: lanAddresses().map(a => `http://${a.address}:${PORT}`),
        dbPath: DB_PATH
    };
}

function authFromReq(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url, 'http://x').searchParams.get('token');
    return getSession(token);
}

async function handleApi(req, res, pathname) {
    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');

    if (pathname === '/api/status' && req.method === 'GET') {
        return sendJson(res, 200, {
            roles: ROLES.map(r => ({ role: r, name: ROLE_NAMES[r], hasPin: roleHasPin(r) })),
            server: serverInfo()
        });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
        if (isLockedOut(ip)) return sendJson(res, 429, { error: 'Too many wrong PINs. Wait 1 minute and try again.' });
        const body = await readBody(req, 10_000);
        const role = body.role;
        const pin = String(body.pin || '');
        const device = str(body.device, 'Device name', { max: 60 }) || 'Laptop';
        if (!ROLES.includes(role)) return sendJson(res, 400, { error: 'Choose who you are.' });
        if (!/^\d{4,8}$/.test(pin)) return sendJson(res, 400, { error: 'PIN must be 4 to 8 digits.' });

        const user = db.prepare('SELECT pin_hash, pin_salt FROM users WHERE role = ?').get(role);
        let firstTime = false;
        if (!user.pin_hash) {
            // First person to pick this role sets its PIN.
            const salt = crypto.randomBytes(16).toString('hex');
            db.prepare('UPDATE users SET pin_hash = ?, pin_salt = ?, updated_at = ? WHERE role = ?')
                .run(hashPin(pin, salt), salt, nowIso(), role);
            firstTime = true;
        } else {
            const ok = crypto.timingSafeEqual(Buffer.from(hashPin(pin, user.pin_salt), 'hex'), Buffer.from(user.pin_hash, 'hex'));
            if (!ok) { noteFailedLogin(ip); return sendJson(res, 401, { error: 'Wrong PIN.' }); }
        }
        failedLogins.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        const ts = nowIso();
        db.prepare('INSERT INTO sessions (token, role, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(token, role, device, ts, ts);
        logActivity({ role, device }, firstTime ? 'PIN_CREATED_AND_LOGIN' : 'LOGIN', null, { ip });
        return sendJson(res, 200, { token, role, roleName: ROLE_NAMES[role], firstTime });
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
        const s = authFromReq(req);
        if (s) {
            db.prepare('DELETE FROM sessions WHERE token = ?').run(s.token);
            logActivity(s, 'LOGOUT', null, null);
            for (const c of [...clients]) if (c.session.token === s.token) wsClose(c);
        }
        return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/session' && req.method === 'GET') {
        const s = authFromReq(req);
        if (!s) return sendJson(res, 401, { error: 'Not logged in.' });
        return sendJson(res, 200, { role: s.role, roleName: ROLE_NAMES[s.role], device: s.device });
    }

    // ---- CEO only below ----
    const s = authFromReq(req);
    if (!s || s.role !== 'ceo') return sendJson(res, 403, { error: 'Manager only.' });

    if (pathname === '/api/backup' && req.method === 'GET') {
        const file = path.join(os.tmpdir(), `alphatronic_backup_${Date.now()}.db`);
        db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="Alphatronic_ERP_Backup_${new Date().toISOString().slice(0, 10)}.db"`
        });
        fs.createReadStream(file).on('close', () => fs.unlink(file, () => {})).pipe(res);
        logActivity(s, 'DOWNLOAD_BACKUP', null, null);
        return;
    }

    if (pathname === '/api/export.json' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="Alphatronic_ERP_Export_${new Date().toISOString().slice(0, 10)}.json"`
        });
        return res.end(JSON.stringify(getAllOrders(), null, 2));
    }

    // Import the JSON backup made by the old single-file HTML version (or an export from this one).
    if (pathname === '/api/import' && req.method === 'POST') {
        const body = await readBody(req);
        const list = Array.isArray(body) ? body : body.orders;
        if (!Array.isArray(list)) throw new UserError('The file does not contain a list of orders.');
        runBackup('before_import');
        let added = 0, skipped = 0;
        transaction(() => {
            for (const o of list) {
                const id = String(o.id || '').trim().toUpperCase();
                if (!id || !o.customer || db.prepare('SELECT 1 FROM orders WHERE id = ?').get(id)) { skipped++; continue; }
                const status = Object.values(STATUS).includes(o.status) ? o.status : STATUS.PENDING;
                const outcome = OUTCOMES.includes(o.outcome) ? o.outcome : 'In Progress';
                const ts = o.createdAt || nowIso();
                db.prepare(`INSERT INTO orders (id, customer, phone, product, fee, extra_fee, deadline, notes, status, outcome,
                            comments, created_at, updated_at, completed_at, confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                    .run(id, String(o.customer), String(o.phone || ''), String(o.product || ''),
                        parseFloat(o.fee) || 0, parseFloat(o.extraFee) || 0, String(o.deadline || nowIso().slice(0, 16)),
                        String(o.notes || ''), status, outcome, String(o.comments || ''), ts, nowIso(),
                        o.completedAt || null, o.confirmedAt || null);
                replaceParts(id, (Array.isArray(o.parts) ? o.parts : []).map(p => ({
                    sku: String(p.sku || '').trim(), qty: parseInt(p.qty, 10) || 1, unitPrice: parseFloat(p.unitPrice) || 0
                })).filter(p => p.sku));
                added++;
            }
        });
        logActivity(s, 'IMPORT', null, { added, skipped });
        broadcastSnapshots();
        return sendJson(res, 200, { added, skipped });
    }

    return sendJson(res, 404, { error: 'Not found.' });
}

function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
        });
        fs.createReadStream(file).pipe(res);
    });
}

const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    try {
        if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
        else serveStatic(req, res, pathname);
    } catch (e) {
        if (!(e instanceof UserError)) console.error(e);
        if (!res.headersSent) sendJson(res, e instanceof UserError ? 400 : 500, { error: e.message });
    }
});
server.on('upgrade', handleUpgrade);

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${PORT} is already in use. The ERP server is probably already running.`);
        console.error(`  Open http://localhost:${PORT} in the browser, or close the other window first.\n`);
    } else console.error(err);
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
    try { runBackup(); } catch (e) { console.warn('Backup failed:', e.message); }
    setInterval(() => { try { runBackup(); } catch (e) { console.warn('Backup failed:', e.message); } }, 60 * 60 * 1000);

    const info = serverInfo();
    const line = '='.repeat(66);
    console.log(`\n${line}`);
    console.log('  ALPHATRONIC REPAIR ERP - SERVER RUNNING');
    console.log(line);
    console.log(`  Database : ${DB_PATH}${isNewDb ? '   (NEW - created now)' : ''}`);
    console.log(`  Backups  : ${BACKUP_DIR}`);
    console.log('');
    console.log('  On THIS laptop open     :  http://localhost:' + PORT);
    console.log('  On the OTHER laptops    :  ' + info.primaryUrl + '   <-- use this, works even if the IP changes');
    if (info.ipUrls.length) console.log('  (fallback, current IP)  :  ' + info.ipUrls.join('   '));
    console.log('');
    console.log('  Keep this window open. Closing it stops the ERP for everyone.');
    console.log(`${line}\n`);
});

function shutdown() {
    console.log('\nStopping server...');
    for (const c of [...clients]) wsClose(c, 1001);
    try { db.close(); } catch (_) {}
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
