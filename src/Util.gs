/**
 * House Ledger: dates (always IST), months and money formatting.
 * India has no daylight saving, so IST is a fixed +05:30 offset.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function istParts(date) {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
  };
}

function istDate(y, m, d, h, mi, s) {
  return new Date(Date.UTC(y, m - 1, d, h || 0, mi || 0, s || 0) - IST_OFFSET_MS);
}

/** Date → '2026-10-03 12:34' in IST. */
function formatIst(date) {
  const p = istParts(date);
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d) + ' ' + pad2(p.h) + ':' + pad2(p.mi);
}

/** Date → '2026-10-03' in IST. */
function formatIstDay(date) {
  return formatIst(date).slice(0, 10);
}

/** '2026-10-03 12:34' (IST) or a Date → Date. */
function parseIst(v) {
  if (v instanceof Date) return v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return istDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0));
}

/** Date → '2026-10'. */
function monthOf(date) {
  return formatIst(date).slice(0, 7);
}

/** A sheet cell that should hold '2026-10' (Sheets may have turned it into a Date). */
function monthCell(v) {
  if (v instanceof Date) return monthOf(v);
  return String(v || '').trim().slice(0, 7);
}

/** A sheet cell holding a time, as the canonical '2026-10-03 12:34' string. */
function timeCell(v) {
  if (v instanceof Date) return formatIst(v);
  return String(v || '').trim();
}

function shiftMonth(key, delta) {
  const y = +key.slice(0, 4);
  const m = +key.slice(5, 7) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12 + 1;
  return yy + '-' + pad2(mm);
}

function nextMonth(key) { return shiftMonth(key, 1); }
function prevMonth(key) { return shiftMonth(key, -1); }

/** '2026-10' → 'Oct 2026' */
function monthLabel(key) {
  return MONTH_SHORT[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4);
}

/** '2026-10' → 'October' */
function monthName(key) {
  return MONTH_LONG[+key.slice(5, 7) - 1];
}

/** '2026-10' → '2026-10-31' */
function lastDayOfMonth(key) {
  const next = nextMonth(key);
  const d = new Date(Date.UTC(+next.slice(0, 4), +next.slice(5, 7) - 1, 1) - 86400000);
  return key + '-' + pad2(d.getUTCDate());
}

/** Date → '3 Oct, 12:34' in IST. */
function shortStamp(date) {
  const p = istParts(date);
  return p.d + ' ' + MONTH_SHORT[p.m - 1] + ', ' + pad2(p.h) + ':' + pad2(p.mi);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v || '').replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** '1234567' → '12,34,567' */
function indianGroup(intStr) {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + ',' + last3;
}

/** 1450 → '₹1,450'; 2310.5 → '₹2,310.50'; -450 → '−₹450' */
function formatRupees(n) {
  const v = round2(n);
  const abs = Math.abs(v);
  const whole = Math.floor(abs);
  const paise = Math.round((abs - whole) * 100);
  const s = '₹' + indianGroup(String(whole)) + (paise ? '.' + pad2(paise) : '');
  return v < 0 ? '−' + s : s;
}

/**
 * What you type for "how much was yours": '220', '₹220', 'Rs 220', '220.5', '1,200'.
 * Returns a number, or null if it isn't a plain non-negative amount.
 */
function parseAmountInput(text) {
  const t = String(text || '').trim().replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(t)) return null;
  return parseFloat(t);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
