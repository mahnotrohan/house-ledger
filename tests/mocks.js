/* In-memory stand-ins for the Apps Script services House Ledger uses. */

if (typeof console === 'undefined') {
  globalThis.console = { log: function () {}, warn: function () {}, error: function () {} };
}
globalThis.QUIET = true;
console.log = function () { if (!QUIET) print(Array.prototype.join.call(arguments, ' ')); };
console.warn = function () { if (!QUIET) print('WARN ' + Array.prototype.join.call(arguments, ' ')); };
console.error = function () { if (!QUIET) print('ERROR ' + Array.prototype.join.call(arguments, ' ')); };

// ─── Sheets ────────────────────────────────────────────────────────────────

function FakeRange(sheet, r, c, nr, nc) {
  this.sheet = sheet; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1;
}
FakeRange.prototype.getValues = function () {
  const out = [];
  for (let i = 0; i < this.nr; i++) {
    const row = [];
    for (let j = 0; j < this.nc; j++) row.push(this.sheet.read(this.r + i, this.c + j));
    out.push(row);
  }
  return out;
};
FakeRange.prototype.getValue = function () { return this.getValues()[0][0]; };
FakeRange.prototype.setValues = function (vals) {
  if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues size mismatch');
  for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.write(this.r + i, this.c + j, vals[i][j]);
  this.sheet.writes++;
  return this;
};
FakeRange.prototype.setValue = function (v) { this.sheet.write(this.r, this.c, v); this.sheet.writes++; return this; };
FakeRange.prototype.setFormula = function (f) { return this.setValue(f); };
FakeRange.prototype.setNumberFormat = function () { return this; };
FakeRange.prototype.setFontWeight = function () { return this; };

function FakeSheet(name) { this.name = name; this.cells = []; this.writes = 0; }
FakeSheet.prototype.write = function (r, c, v) {
  while (this.cells.length < r) this.cells.push([]);
  this.cells[r - 1][c - 1] = v;
};
FakeSheet.prototype.read = function (r, c) {
  const row = this.cells[r - 1];
  let v = row && row[c - 1] !== undefined ? row[c - 1] : '';
  const f = typeof v === 'string' && v.match(/^=G(\d+)-H(\d+)$/);
  if (f) v = Math.round((Number(this.read(+f[1], 7)) - Number(this.read(+f[2], 8) || 0)) * 100) / 100;
  return v;
};
FakeSheet.prototype.getLastRow = function () {
  for (let i = this.cells.length; i > 0; i--) {
    if ((this.cells[i - 1] || []).some(function (v) { return v !== '' && v !== undefined; })) return i;
  }
  return 0;
};
FakeSheet.prototype.getMaxRows = function () { return 1000; };
FakeSheet.prototype.getRange = function (r, c, nr, nc) { return new FakeRange(this, r, c, nr, nc); };
FakeSheet.prototype.appendRow = function (row) {
  const r = this.getLastRow() + 1;
  row.forEach(function (v, j) { this.write(r, j + 1, v); }, this);
};
FakeSheet.prototype.setFrozenRows = function () {};
FakeSheet.prototype.rows = function () {
  const n = this.getLastRow();
  return n > 1 ? this.getRange(2, 1, n - 1, (this.cells[0] || []).length).getValues() : [];
};

function FakeSpreadsheet() { this.sheets = {}; }
FakeSpreadsheet.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
FakeSpreadsheet.prototype.insertSheet = function (n) { return (this.sheets[n] = new FakeSheet(n)); };
FakeSpreadsheet.prototype.getId = function () { return 'sheet-123'; };
FakeSpreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/sheet-123'; };

// ─── World ─────────────────────────────────────────────────────────────────

const W = {};

function resetWorld() {
  W.ss = new FakeSpreadsheet();
  W.props = {};
  W.mail = [];
  W.tg = { calls: [], updates: [], nextMsgId: 5000, nextUpdateId: 1 };
  W.splitwise = [];
  W.splitwiseFail = null;
  W.now = new Date('2026-10-05T06:00:00Z'); // 11:30 IST, 5 Oct 2026
  merchantCache_ = null;
}

globalThis.now_ = function () { return new Date(W.now.getTime()); };

globalThis.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return W.ss; },
  openById: function () { return W.ss; },
};

globalThis.PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return W.props[k] === undefined ? null : W.props[k]; },
      setProperty: function (k, v) { W.props[k] = String(v); },
      deleteProperty: function (k) { delete W.props[k]; },
    };
  },
};

globalThis.LockService = {
  getScriptLock: function () {
    return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} };
  },
};

globalThis.ScriptApp = {
  getProjectTriggers: function () { return []; },
};

// ─── Gmail ─────────────────────────────────────────────────────────────────

let mailSeq = 0;
function addMail(sample, date, threadId) {
  const m = {
    id: 'm' + (++mailSeq).toString(16),
    threadId: threadId || 't' + mailSeq,
    subject: sample.subject,
    body: sample.body,
    html: !!sample.html,
    date: new Date(date),
  };
  W.mail.push(m);
  return m;
}

function FakeMessage(m) { this.m = m; }
FakeMessage.prototype.getId = function () { return this.m.id; };
FakeMessage.prototype.getSubject = function () { return this.m.subject; };
FakeMessage.prototype.getPlainBody = function () { return this.m.html ? '' : this.m.body; };
FakeMessage.prototype.getBody = function () { return this.m.body; };
FakeMessage.prototype.getDate = function () { return this.m.date; };

globalThis.GmailApp = {
  search: function (q) {
    const after = +((q.match(/after:(\d+)/) || [])[1] || 0) * 1000;
    const before = +((q.match(/before:(\d+)/) || [])[1] || Infinity) * 1000;
    const ids = [];
    W.mail.forEach(function (m) {
      if (m.date >= after && m.date < before && ids.indexOf(m.threadId) < 0) ids.push(m.threadId);
    });
    return ids;
  },
  getMessagesForThreads: function (threadIds) {
    return threadIds.map(function (t) {
      return W.mail.filter(function (m) { return m.threadId === t; }).map(function (m) { return new FakeMessage(m); });
    });
  },
  getUserLabelByName: function () { return {}; },
  createLabel: function () { return {}; },
};

// ─── Telegram + Splitwise over UrlFetchApp ─────────────────────────────────

function response(code, obj) {
  return { getResponseCode: function () { return code; }, getContentText: function () { return JSON.stringify(obj); } };
}

globalThis.UrlFetchApp = {
  fetch: function (url, opts) {
    const payload = opts.payload ? JSON.parse(opts.payload) : {};
    const tg = url.match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
    if (tg) return response(200, telegram(tg[1], payload));
    const sw = url.match(/splitwise\.com\/api\/v3\.0\/(\w+)/);
    if (sw) {
      if (sw[1] === 'create_expense') {
        if (W.splitwiseFail) return response(200, { expenses: [], errors: { base: [W.splitwiseFail] } });
        W.splitwise.push({ payload: payload, auth: opts.headers.Authorization });
        return response(200, { expenses: [{ id: 900 + W.splitwise.length }], errors: {} });
      }
      if (sw[1] === 'get_groups') return response(200, { groups: [{ id: 42, name: 'Flat', members: [1, 2, 3] }] });
    }
    throw new Error('Unexpected fetch ' + url);
  },
};

function telegram(method, p) {
  W.tg.calls.push({ method: method, p: p });
  if (method === 'getUpdates') {
    return { ok: true, result: W.tg.updates.filter(function (u) { return u.update_id >= (p.offset || 0); }) };
  }
  if (method === 'sendMessage') return { ok: true, result: { message_id: ++W.tg.nextMsgId } };
  if (method === 'answerCallbackQuery') return { ok: false, description: 'Bad Request: query is too old and response timeout expired' };
  return { ok: true, result: true };
}

const OWNER = { id: 111, first_name: 'Rohan' };
const STRANGER = { id: 999, first_name: 'Someone' };

function userSays(text, from, replyTo) {
  const u = from || OWNER;
  const msg = { message_id: 1, from: u, chat: { id: u.id, type: 'private' }, text: text };
  if (replyTo) msg.reply_to_message = { message_id: replyTo };
  W.tg.updates.push({ update_id: W.tg.nextUpdateId++, message: msg });
}

function userTaps(data, msgId, from) {
  const u = from || OWNER;
  W.tg.updates.push({
    update_id: W.tg.nextUpdateId++,
    callback_query: { id: 'cq' + W.tg.nextUpdateId, from: u, data: data, message: { message_id: msgId, chat: { id: u.id } } },
  });
}

function sent(method) {
  return W.tg.calls.filter(function (c) { return c.method === (method || 'sendMessage'); });
}

function lastSent() {
  const s = sent();
  return s.length ? s[s.length - 1].p : null;
}
