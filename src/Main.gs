/**
 * House Ledger: entry points.
 *
 * Run from the editor, in this order (README → Setup has the details):
 *   1. setup()             creates the tabs, headers and Summary formulas
 *   2. connectTelegram()   after you've sent your bot "hi"
 *   3. checkConfig()       shows which Script Properties are still missing
 *   4. installTriggers()   starts tick() every minute and dailyJob() at 9am IST
 *
 * Other handy ones: backfill('2026-09-01', '2026-10-01'), addFixedForThisMonth(),
 * previewClose(), listSplitwiseGroups().
 */

/** Every minute: new alerts → rows → prompts, then taps and replies. */
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const ledger = new Ledger();
    const added = captureNewAlerts(ledger);
    if (telegramReady()) {
      sendPrompts(added, ledger);
      pollTelegram(ledger);
    }
  } catch (e) {
    logError('tick', e);
  } finally {
    lock.releaseLock();
  }
}

/** Daily, 9–10am IST. Does its work only on the 1st. */
function dailyJob() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const today = now_();
    if (istParts(today).d !== 1) return;
    const ledger = new Ledger();
    const month = monthOf(today);
    const last = prevMonth(month);
    addFixedRows(month, ledger);
    if (telegramReady() && !isPosted(last) && !prop('SUMMARY_SENT_' + last)) {
      sendCloseSummary(last, ledger);
    }
  } catch (e) {
    logError('dailyJob', e);
  } finally {
    lock.releaseLock();
  }
}

/** For October (the first month): add the cook and maid rows by hand. */
function addFixedForThisMonth() {
  const ledger = new Ledger();
  const added = addFixedRows(openMonthFor(monthOf(now_())), ledger);
  console.log('Added ' + added.length + ' fixed rows: ' +
    added.map(function (r) { return r.merchant_raw + ' ' + formatRupees(r.amount); }).join(', '));
}

/** Logs what last month's close would post, without touching Telegram or Splitwise. */
function previewClose(month) {
  const m = month || prevMonth(monthOf(now_()));
  const s = monthSummary(m, new Ledger());
  console.log(summaryText(s));
  if (prop('SPLITWISE_GROUP_ID')) console.log(describePayload_(splitwisePayload(s)));
  return s;
}

// ─── Setup ─────────────────────────────────────────────────────────────────

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setProp('SHEET_ID', ss.getId());

  const txns = ensureTab_(ss, TABS.TXNS, TXN_COLS);
  // Plain text for ids, times and months, so Sheets doesn't turn '2026-10' into a date.
  txns.getRange(1, 1, txns.getMaxRows(), 6).setNumberFormat('@');
  txns.getRange(1, 10, txns.getMaxRows(), 3).setNumberFormat('@');
  txns.getRange(1, 7, txns.getMaxRows(), 3).setNumberFormat('#,##0.##');

  const fixed = ensureTab_(ss, TABS.FIXED, FIXED_COLS);
  if (fixed.getLastRow() < 2) fixed.getRange(2, 1, DEFAULT_FIXED.length, 3).setValues(DEFAULT_FIXED);

  const merchants = ensureTab_(ss, TABS.MERCHANTS, MERCHANT_COLS);
  if (merchants.getLastRow() < 2) merchants.getRange(2, 1, DEFAULT_MERCHANTS.length, 2).setValues(DEFAULT_MERCHANTS);

  ensureTab_(ss, TABS.LOG, LOG_COLS);

  const summary = ss.getSheetByName(TABS.SUMMARY) || ss.insertSheet(TABS.SUMMARY);
  summary.getRange(1, 1).setValue('By month (house share)');
  summary.getRange(2, 1).setFormula(
    '=QUERY(Txns!A1:L, "select C, sum(I), sum(H), count(A) where C is not null group by C order by C desc ' +
    'label C \'Month\', sum(I) \'House total\', sum(H) \'Your items taken out\', count(A) \'Rows\'", 1)');
  summary.getRange(1, 7).setValue('By app');
  summary.getRange(2, 7).setFormula(
    '=QUERY(Txns!A1:L, "select C, sum(I) where C is not null group by C pivot F order by C desc label C \'Month\'", 1)');
  summary.getRange(1, 1, 1, 7).setFontWeight('bold');

  if (!GmailApp.getUserLabelByName(GMAIL_LABEL)) GmailApp.createLabel(GMAIL_LABEL);
  console.log('Sheet ready. Fill in the Fixed tab amounts, then run connectTelegram().');
}

function ensureTab_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/** Send your bot "hi" first. This finds your chat and remembers it. */
function connectTelegram() {
  requireProp('TELEGRAM_TOKEN');
  tg_('deleteWebhook', {});
  const res = tg_('getUpdates', { timeout: 0 });
  const msgs = (res.result || [])
    .map(function (u) { return u.message; })
    .filter(function (m) { return m && m.chat && m.chat.type === 'private'; });
  if (!msgs.length) throw new Error('No messages found. Open your bot in Telegram, send it "hi", then run this again.');

  const last = msgs[msgs.length - 1];
  setProp('CHAT_ID', last.chat.id);
  const lastUpdate = res.result[res.result.length - 1].update_id;
  setProp('TG_OFFSET', lastUpdate + 1);
  sendMessage('Connected. I\'ll only listen to this chat.\n\n' + HELP_TEXT);
  console.log('Connected to ' + (last.from.username || last.from.first_name) + ' (chat ' + last.chat.id + ').');
}

function checkConfig() {
  const needed = ['TELEGRAM_TOKEN', 'CHAT_ID', 'SPLITWISE_KEY', 'SPLITWISE_GROUP_ID'];
  needed.forEach(function (k) { console.log((prop(k) ? '✓ ' : '✗ ') + k); });
  console.log('DRY_RUN = ' + (isDryRun() ? 'true (test mode)' : 'false'));
  console.log('Posted months: ' + (Object.keys(postedMonths()).join(', ') || 'none'));
  console.log('Fixed: ' + fixedList().map(function (f) {
    return f.name + ' ' + formatRupees(f.amount) + (f.active ? '' : ' (off)');
  }).join(', '));
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['tick', 'dailyJob'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(9).everyDays(1).inTimezone('Asia/Kolkata').create();
  console.log('Triggers installed: tick every minute, dailyJob daily 9–10am IST.');
}

/** Switch to this if runs get slow (quota: 90 min/day of trigger time). */
function slowDownToEvery5Minutes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
}

// ─── Errors ────────────────────────────────────────────────────────────────

/** Logs to the Log tab; pings Telegram at most once an hour so a stuck error doesn't spam you. */
function logError(where, e) {
  const detail = (e && e.stack) || String(e);
  console.error(where + ': ' + detail);
  try { appendLog('error', where, detail); } catch (ignored) { /* sheet unavailable */ }
  const last = Number(prop('LAST_ERROR_PING') || 0);
  if (telegramReady() && now_().getTime() - last > 3600000) {
    setProp('LAST_ERROR_PING', now_().getTime());
    try { sendMessage('House Ledger hit an error in ' + where + ': ' + (e && e.message) + '\nDetails are in the Log tab.'); } catch (ignored) { /* offline */ }
  }
}
