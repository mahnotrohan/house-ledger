/**
 * House Ledger: turns new house-card alert emails into Txns rows.
 *
 * Gmail groups alerts with the same subject into one thread, so this walks
 * individual messages and skips any message id already in Txns or Log.
 */

/** Every-minute path: looks at the last few days of labelled mail. */
function captureNewAlerts(ledger) {
  const since = new Date(now_().getTime() - GMAIL_LOOKBACK_DAYS * 86400000);
  return captureSince_(since, null, ledger);
}

/**
 * Loads older alerts, e.g. the last statement period, to check the reader
 * against the statement total. No Telegram prompts are sent for these.
 *   backfill('2026-09-01', '2026-10-01')
 */
function backfill(fromDay, toDay) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const from = parseIst(fromDay);
    const to = toDay ? parseIst(toDay) : null;
    const added = captureSince_(from, to, new Ledger(), 500);
    const total = added.reduce(function (s, r) { return s + r.amount; }, 0);
    console.log('Backfill added ' + added.length + ' rows, net ' + formatRupees(total));
    return added;
  } finally {
    lock.releaseLock();
  }
}

function captureSince_(since, until, ledger, maxThreads) {
  let query = 'label:' + GMAIL_LABEL + ' after:' + Math.floor(since.getTime() / 1000);
  if (until) query += ' before:' + Math.floor(until.getTime() / 1000);
  const threads = GmailApp.search(query, 0, maxThreads || 50);
  if (!threads.length) return [];

  const known = ledger.ids();
  logIds().forEach(function (id) { known.add(id); });

  const messages = [];
  GmailApp.getMessagesForThreads(threads).forEach(function (list) {
    list.forEach(function (m) { messages.push(m); });
  });
  messages.sort(function (a, b) { return a.getDate() - b.getDate(); });

  const added = [];
  messages.forEach(function (msg) {
    const id = 'gm:' + msg.getId();
    const date = msg.getDate();
    // A thread can hold older alerts from before the window; leave those alone.
    if (known.has(id) || date < since || (until && date >= until)) return;
    known.add(id);

    let parsed;
    try {
      parsed = parseAlert({ subject: msg.getSubject(), body: msg.getPlainBody() || msg.getBody(), date: date });
    } catch (e) {
      parsed = { kind: 'unknown', reason: 'reader error: ' + e.message };
    }

    if (parsed.kind === 'skip') {
      appendLog('skipped', id, parsed.reason + ' · ' + msg.getSubject(), gmailLink(msg.getId()));
      return;
    }
    if (parsed.kind === 'unknown') {
      appendLog('unreadable', id, parsed.reason + ' · ' + msg.getSubject(), gmailLink(msg.getId()));
      notifyUnreadable_(msg, parsed.reason);
      return;
    }
    added.push(ledger.append(alertToRec_(id, parsed)));
  });
  return added;
}

function alertToRec_(id, parsed) {
  return {
    id: id,
    txn_time: formatIst(parsed.time),
    month: openMonthFor(monthOf(parsed.time)),
    source: 'email',
    merchant_raw: parsed.merchant,
    app: appFor(parsed.merchant),
    amount: parsed.kind === 'credit' ? -parsed.amount : parsed.amount,
    mine: 0,
    tag: 'auto',
  };
}

function notifyUnreadable_(msg, reason) {
  if (!telegramReady()) return;
  sendMessage(
    'I couldn\'t read a house-card email (' + reason + ').\n' +
    '“' + msg.getSubject() + '”\n' +
    'If it was a charge, add it with /add <amount> <note>.',
    [[{ text: 'Open email', url: gmailLink(msg.getId()) }]]
  );
}
