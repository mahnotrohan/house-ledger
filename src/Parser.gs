/**
 * House Ledger: reads a bank card-alert email.
 *
 * parseAlert({subject, body, date}) returns one of:
 *   {kind: 'debit' | 'credit', amount, merchant, time, timeFromBody}
 *   {kind: 'skip', reason}     – recognised, but not a charge (bill payment, OTP, statement, declined)
 *   {kind: 'unknown', reason}  – couldn't read it; goes to the Log tab and pings you
 *
 * It's deliberately bank-agnostic: it looks for an amount, a direction word and
 * a merchant phrase the way Indian card alerts usually write them (HDFC, ICICI,
 * Axis, SBI Card and similar). If your bank's format isn't read, add a sample to
 * tests/samples.js and adjust the patterns below.
 */

const SKIP_PATTERNS = [
  [/\b(?:declined|unsuccessful|could not be processed|has failed|was failed)\b/i, 'declined'],
  [/\bpayment\b.{0,60}\b(?:has been |is |was )?received\b|\breceived (?:a |your )?payment\b|\bthank you for (?:your |the )?payment\b|\btowards your credit card (?:bill|dues|outstanding)\b/i, 'card payment'],
  [/\bstatement\b.{0,60}\b(?:is ready|has been generated|is generated|is now available|is available)\b|\be-?statement\b/i, 'statement'],
  [/\b\d{4,8}\b is (?:your|the) (?:otp|one[- ]time password)|\b(?:otp|one[- ]time password)(?: is|:)\s*\d{4,8}\b/i, 'otp'],
];

const AMOUNT_RE_SRC = '(?:\\bINR|\\bRs\\.?|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
const LABELLED_AMOUNT_RE = new RegExp('\\b(?:transaction|txn)\\s+amount\\s*[:\\-]?\\s*' + AMOUNT_RE_SRC, 'i');
const ANY_AMOUNT_RE = new RegExp(AMOUNT_RE_SRC, 'i');

const CREDIT_RE = /\b(?:refund(?:ed)?|revers(?:al|ed)|credited|credit of)\b/i;
const DEBIT_RE = /\b(?:spent|debited|charged|purchase|thank you for using|used for|used at|has been used|was used|is used|transaction of|transaction alert|txn of)\b/i;

// Merchant phrases. Labelled ones are trusted first; otherwise the earliest
// contextual phrase in the text wins.
const MERCHANT_END = '(?=\\s+(?:on|at|for|to|has|is|was|dated|avl|available|ref|txn|transaction|if|not|axis|date|card|time|the|and|via)\\b|\\s*[.;,|]|\\s+\\d|$)';
const LABELLED_MERCHANT_RES = [
  new RegExp('\\bmerchant(?: name)?\\s*[:\\-]\\s*([A-Za-z0-9][^:;|]*?)' + MERCHANT_END, 'i'),
  new RegExp('\\binfo\\s*[:\\-]\\s*([A-Za-z0-9][^:;|]*?)' + MERCHANT_END, 'i'),
];
const CONTEXT_MERCHANT_RES = [
  new RegExp('\\b(?:refund|reversal)\\s+(?:from|by|of)\\s+([A-Za-z][A-Za-z0-9*&\'\\-\\/ ]*?)' + MERCHANT_END, 'i'),
  new RegExp('\\bat\\s+([A-Za-z][A-Za-z0-9*&\'\\-\\/ ]*?)' + MERCHANT_END, 'i'),
  new RegExp('\\btowards\\s+([A-Za-z][A-Za-z0-9*&\'\\-\\/ ]*?)' + MERCHANT_END, 'i'),
];

const MON_RE_SRC = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const TIME_RE_SRC = '(?:[ ,]+(?:at\\s+)?(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';
const DATE_RES = [
  // 2026-10-03 12:34:56 · 2026-10-03:12:34:56
  { re: new RegExp('\\b(\\d{4})-(\\d{2})-(\\d{2})(?:[ T:]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?'), order: 'ymd' },
  // 03-10-2026, 12:34:56 · 03/10/26 · 03.10.2026 (day first, as Indian banks write it)
  { re: new RegExp('\\b(\\d{1,2})[-\\/.](\\d{1,2})[-\\/.](\\d{4}|\\d{2})\\b' + TIME_RE_SRC), order: 'dmy' },
  // 03 Oct, 2026 at 12:34 · 14-Oct-26 · 03Oct2026
  { re: new RegExp('\\b(\\d{1,2})[- ]?' + MON_RE_SRC + '[-, ]*(\\d{4}|\\d{2})\\b' + TIME_RE_SRC, 'i'), order: 'dMy' },
  // Oct 07, 2026 at 09:15:22
  { re: new RegExp('\\b' + MON_RE_SRC + ' (\\d{1,2}),? (\\d{4})\\b' + TIME_RE_SRC, 'i'), order: 'Mdy' },
];
const MAX_DATE_DRIFT_MS = 5 * 86400000;

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|td|th|li|h\d|table)>/gi, ' \n ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
    .replace(/&[a-z]+;/gi, ' ');
}

function oneLine(s) {
  return String(s || '').replace(/[ \s]+/g, ' ').trim();
}

function parseAlert(msg) {
  const body = oneLine(/<[a-z][\s\S]*>/i.test(msg.body || '') ? htmlToText(msg.body) : msg.body);
  const text = oneLine((msg.subject || '') + ' . ' + body);

  for (let i = 0; i < SKIP_PATTERNS.length; i++) {
    if (SKIP_PATTERNS[i][0].test(text)) return { kind: 'skip', reason: SKIP_PATTERNS[i][1] };
  }

  const amount = findAmount_(body) || findAmount_(text);
  if (!amount) return { kind: 'unknown', reason: 'no amount found' };

  // The body decides; a generic subject ("Transaction alert") only breaks a tie.
  const kind = findDirection_(body) || findDirection_(msg.subject || '');
  if (!kind) return { kind: 'unknown', reason: 'no debit/credit wording found' };

  const time = findTime_(body, msg.date);
  return {
    kind: kind,
    amount: amount,
    merchant: findMerchant_(body),
    time: time.date,
    timeFromBody: time.fromBody,
  };
}

function findAmount_(text) {
  const m = text.match(LABELLED_AMOUNT_RE) || text.match(ANY_AMOUNT_RE);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return v > 0 ? round2(v) : null;
}

/** Whichever of debit/credit wording appears first. */
function findDirection_(text) {
  const c = text.search(CREDIT_RE);
  const d = text.search(DEBIT_RE);
  if (c < 0 && d < 0) return null;
  if (c < 0) return 'debit';
  if (d < 0) return 'credit';
  return c < d ? 'credit' : 'debit';
}

function findMerchant_(text) {
  for (let i = 0; i < LABELLED_MERCHANT_RES.length; i++) {
    const m = text.match(LABELLED_MERCHANT_RES[i]);
    if (m) return cleanMerchant_(m[1]);
  }
  let best = null;
  CONTEXT_MERCHANT_RES.forEach(function (re) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = m;
  });
  return best ? cleanMerchant_(best[1]) : '';
}

function cleanMerchant_(s) {
  return oneLine(s).replace(/[\s.,:;\-]+$/, '').slice(0, 60);
}

/**
 * Finds the transaction time in the body. Falls back to the email's own time if
 * nothing is found, or if what's found is more than 5 days from when the email
 * arrived (a statement date, a due date…).
 */
function findTime_(text, emailDate) {
  const fallback = { date: emailDate, fromBody: false };
  let best = null;
  DATE_RES.forEach(function (spec) {
    const m = spec.re.exec(text);
    if (m && (!best || m.index < best.m.index)) best = { m: m, order: spec.order };
  });
  if (!best) return fallback;

  const m = best.m;
  let y, mo, d;
  if (best.order === 'ymd') { y = +m[1]; mo = +m[2]; d = +m[3]; }
  if (best.order === 'dmy') { d = +m[1]; mo = +m[2]; y = +m[3]; }
  if (best.order === 'dMy') { d = +m[1]; mo = monthIndex_(m[2]); y = +m[3]; }
  if (best.order === 'Mdy') { mo = monthIndex_(m[1]); d = +m[2]; y = +m[3]; }
  if (y < 100) y += 2000;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return fallback;

  const hasTime = m[4] !== undefined;
  const h = hasTime ? +m[4] : 0;
  const mi = hasTime ? +m[5] : 0;
  if (h > 23 || mi > 59) return fallback;
  let date = istDate(y, mo, d, h, mi, hasTime && m[6] ? +m[6] : 0);

  if (emailDate && Math.abs(date - emailDate) > MAX_DATE_DRIFT_MS) return fallback;
  if (!hasTime) {
    // A date with no time: use the email's time if it's the same day, else midday.
    date = emailDate && formatIstDay(emailDate) === formatIstDay(date) ? emailDate : istDate(y, mo, d, 12, 0);
  }
  return { date: date, fromBody: true };
}

function monthIndex_(name) {
  return MONTH_SHORT.map(function (s) { return s.toLowerCase(); }).indexOf(name.slice(0, 3).toLowerCase()) + 1;
}
