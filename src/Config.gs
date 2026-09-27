/**
 * House Ledger: configuration and constants.
 *
 * Secrets live in Script Properties (Project Settings → Script Properties),
 * never in the sheet:
 *   TELEGRAM_TOKEN      from @BotFather
 *   CHAT_ID             filled in by connectTelegram()
 *   SPLITWISE_KEY       API key from secure.splitwise.com/apps
 *   SPLITWISE_GROUP_ID  your flat's group id (listSplitwiseGroups() prints it)
 *   DRY_RUN             "true" = Post to Splitwise only shows what it would send
 *
 * State the script keeps for itself (don't edit unless you know why):
 *   SHEET_ID, TG_OFFSET, PENDING_PART, POSTED_MONTHS, SUMMARY_SENT_<yyyy-mm>
 */

const TABS = {
  TXNS: 'Txns',
  FIXED: 'Fixed',
  SUMMARY: 'Summary',
  LOG: 'Log',
  MERCHANTS: 'Merchants',
};

const TXN_COLS = ['id', 'txn_time', 'month', 'source', 'merchant_raw', 'app',
  'amount', 'mine', 'house', 'tag', 'tg_msg_id', 'posted_on'];

const LOG_COLS = ['logged_at', 'kind', 'ref', 'detail', 'link'];
const FIXED_COLS = ['name', 'amount', 'active'];
const MERCHANT_COLS = ['contains', 'app'];

const GMAIL_LABEL = 'house-card';
const GMAIL_LOOKBACK_DAYS = 3;

// Matched case-insensitively as substrings of the alert's merchant name, top to
// bottom; first match wins. Edit the Merchants tab to change these.
const DEFAULT_MERCHANTS = [
  ['INSTAMART', 'Instamart'],
  ['BUNDL', 'Instamart'],
  ['SWIGGY', 'Swiggy'],
  ['BLINKIT', 'Blinkit'],
  ['BLINK COMMERCE', 'Blinkit'],
  ['GROFERS', 'Blinkit'],
  ['ZEPTO', 'Zepto'],
  ['KIRANAKART', 'Zepto'],
  ['AMAZON', 'Amazon'],
  ['AMZN', 'Amazon'],
  ['BIGBASKET', 'BigBasket'],
  ['INNOVATIVE RETAIL', 'BigBasket'],
];

// Amounts of 0 are skipped when the month's rows are added. Fill them in.
const DEFAULT_FIXED = [
  ['Cook', 0, true],
  ['Maid', 0, true],
];

function props_() {
  return PropertiesService.getScriptProperties();
}

function prop(key) {
  return props_().getProperty(key);
}

function setProp(key, value) {
  props_().setProperty(key, String(value));
}

function deleteProp(key) {
  props_().deleteProperty(key);
}

function requireProp(key) {
  const v = prop(key);
  if (!v) throw new Error('Script Property ' + key + ' is not set. See README → Setup.');
  return v;
}

function jsonProp(key, fallback) {
  const v = prop(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

function isDryRun() {
  return String(prop('DRY_RUN') || '').toLowerCase() === 'true';
}

/** Overridden in tests. */
function now_() {
  return new Date();
}
