/**
 * House Ledger: the sheet.
 *
 * A Ledger reads the Txns tab once per run and keeps it in memory, so a run
 * costs one read no matter how many rows it touches. Rows are identified by
 * their sheet row number (2 = first data row).
 */

function spreadsheet_() {
  const id = prop('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function tab_(name) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" is missing. Run setup() once.');
  return sh;
}

function sheetUrl() {
  return spreadsheet_().getUrl();
}

class Ledger {
  constructor() {
    this.sheet_ = null;
    this.values = null;
  }

  // Opened on first use, so a quiet minute (no mail, no taps) never touches the sheet.
  get sh() {
    if (!this.sheet_) this.sheet_ = tab_(TABS.TXNS);
    return this.sheet_;
  }

  load_() {
    if (!this.values) {
      const n = this.sh.getLastRow() - 1;
      this.values = n > 0 ? this.sh.getRange(2, 1, n, TXN_COLS.length).getValues() : [];
    }
    return this.values;
  }

  /** All rows as {row, ...fields}. amount/mine are numbers; house is amount − mine. */
  all() {
    return this.load_().map(function (v, i) { return toRec_(v, i + 2); });
  }

  ids() {
    return new Set(this.load_().map(function (v) { return String(v[0]); }));
  }

  get(row) {
    const v = this.load_()[row - 2];
    return v && v[0] !== '' ? toRec_(v, row) : null;
  }

  byId(id) {
    const i = this.load_().findIndex(function (v) { return String(v[0]) === id; });
    return i < 0 ? null : toRec_(this.values[i], i + 2);
  }

  /** The row a Telegram prompt belongs to: try the row in the button first, then search by message id. */
  byPrompt(rowHint, msgId) {
    const hinted = rowHint ? this.get(rowHint) : null;
    if (hinted && String(hinted.tg_msg_id) === String(msgId)) return hinted;
    const i = this.load_().findIndex(function (v) { return String(v[10]) === String(msgId); });
    return i < 0 ? null : toRec_(this.values[i], i + 2);
  }

  inMonth(month) {
    return this.all().filter(function (r) { return r.month === month; });
  }

  /** Appends a row and returns it with its row number. */
  append(rec) {
    const row = this.load_().length + 2;
    const values = fromRec_(rec, row);
    this.sh.getRange(row, 1, 1, TXN_COLS.length).setValues([values]);
    this.values.push(values.slice());
    this.values[this.values.length - 1][8] = round2(num(rec.amount) - num(rec.mine));
    return toRec_(this.values[this.values.length - 1], row);
  }

  /** Changes some fields of a row. Only the changed cells are written. */
  update(row, fields) {
    const v = this.load_()[row - 2];
    const self = this;
    Object.keys(fields).forEach(function (k) {
      const c = TXN_COLS.indexOf(k);
      if (c < 0 || k === 'house') return;
      v[c] = fields[k];
      self.sh.getRange(row, c + 1).setValue(fields[k]);
    });
    v[8] = round2(num(v[6]) - num(v[7]));
    return toRec_(v, row);
  }
}

function toRec_(v, row) {
  const amount = num(v[6]);
  const mine = num(v[7]);
  return {
    row: row,
    id: String(v[0]),
    txn_time: timeCell(v[1]),
    month: monthCell(v[2]),
    source: String(v[3]),
    merchant_raw: String(v[4]),
    app: String(v[5]),
    amount: amount,
    mine: mine,
    house: round2(amount - mine),
    tag: String(v[9] || 'auto'),
    tg_msg_id: v[10] === '' || v[10] == null ? '' : String(v[10]),
    posted_on: v[11] instanceof Date ? formatIstDay(v[11]) : String(v[11] || ''),
  };
}

function fromRec_(rec, row) {
  return [
    rec.id, rec.txn_time, rec.month, rec.source, rec.merchant_raw || '', rec.app || 'Other',
    round2(rec.amount), round2(rec.mine || 0), '=G' + row + '-H' + row,
    rec.tag || 'auto', rec.tg_msg_id || '', rec.posted_on || '',
  ];
}

// ─── Posted months ─────────────────────────────────────────────────────────

function postedMonths() {
  return jsonProp('POSTED_MONTHS', {});
}

function isPosted(month) {
  return !!postedMonths()[month];
}

/** The month a new row goes into: its own month, or the next one still open. */
function openMonthFor(month) {
  const posted = postedMonths();
  let m = month;
  while (posted[m]) m = nextMonth(m);
  return m;
}

function markPosted(month, info, ledger) {
  const posted = postedMonths();
  posted[month] = info;
  setProp('POSTED_MONTHS', JSON.stringify(posted));
  ledger.inMonth(month).forEach(function (r) {
    ledger.update(r.row, { posted_on: info.on });
  });
}

// ─── Merchants ─────────────────────────────────────────────────────────────

let merchantCache_ = null;

function merchantList_() {
  if (merchantCache_) return merchantCache_;
  const sh = spreadsheet_().getSheetByName(TABS.MERCHANTS);
  const rows = sh && sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    : DEFAULT_MERCHANTS;
  merchantCache_ = rows
    .filter(function (r) { return String(r[0]).trim() && String(r[1]).trim(); })
    .map(function (r) { return [String(r[0]).trim().toUpperCase(), String(r[1]).trim()]; });
  return merchantCache_;
}

/** 'KIRANAKART TECHNOLOGIES' → 'Zepto'; unknown names → 'Other'. */
function appFor(merchantRaw) {
  const name = String(merchantRaw || '').toUpperCase();
  if (!name) return 'Other';
  const hit = merchantList_().find(function (m) { return name.indexOf(m[0]) >= 0; });
  return hit ? hit[1] : 'Other';
}

// ─── Fixed payments ────────────────────────────────────────────────────────

function fixedList() {
  const sh = tab_(TABS.FIXED);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return { name: String(r[0]).trim(), amount: num(r[1]), active: r[2] === true || String(r[2]).toUpperCase() === 'TRUE' };
    });
}

function fixedId(month, name) {
  return 'fix:' + month + ':' + slug(name);
}

/** Adds this month's cook/maid rows. Safe to run more than once. */
function addFixedRows(month, ledger) {
  const added = [];
  fixedList().forEach(function (f) {
    if (!f.active || !(f.amount > 0)) return;
    const id = fixedId(month, f.name);
    if (ledger.byId(id)) return;
    added.push(ledger.append({
      id: id, txn_time: month + '-01 00:00', month: month, source: 'fixed',
      merchant_raw: f.name, app: f.name, amount: f.amount, mine: 0, tag: 'house',
    }));
  });
  return added;
}

// ─── Log ───────────────────────────────────────────────────────────────────

function logIds() {
  const sh = spreadsheet_().getSheetByName(TABS.LOG);
  if (!sh || sh.getLastRow() < 2) return new Set();
  return new Set(sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }));
}

function appendLog(kind, ref, detail, link) {
  const sh = spreadsheet_().getSheetByName(TABS.LOG);
  const row = [formatIst(now_()), kind, ref || '', String(detail || '').slice(0, 500), link || ''];
  if (sh) sh.appendRow(row);
  console.log('[' + kind + '] ' + ref + ' ' + detail);
}

function gmailLink(messageId) {
  return 'https://mail.google.com/mail/u/0/#all/' + messageId;
}
