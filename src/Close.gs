/**
 * House Ledger: month-end close and Splitwise.
 *
 * On the 1st, dailyJob() adds the new month's fixed rows and sends last
 * month's summary with a Post button. Post adds one Splitwise expense and
 * locks the month; later arrivals go into the next open month.
 */

function monthSummary(month, ledger) {
  const s = { month: month, total: 0, groceries: 0, orders: 0, mineOut: 0, fixed: [], rows: 0 };
  ledger.inMonth(month).forEach(function (r) {
    s.rows++;
    s.total += r.house;
    if (r.source === 'fixed') {
      s.fixed.push({ name: r.merchant_raw, amount: r.house });
    } else {
      s.groceries += r.house;
      s.mineOut += r.mine;
      if (r.amount > 0) s.orders++;
    }
  });
  s.total = round2(s.total);
  s.groceries = round2(s.groceries);
  s.mineOut = round2(s.mineOut);
  return s;
}

function summaryLines_(s) {
  const lines = [];
  let g = 'Groceries ' + formatRupees(s.groceries) + ' · ' + s.orders + (s.orders === 1 ? ' order' : ' orders');
  if (s.mineOut) g += ' (' + formatRupees(s.mineOut) + ' of yours taken out)';
  lines.push(g);
  if (s.fixed.length) {
    lines.push(s.fixed.map(function (f) { return f.name + ' ' + formatRupees(f.amount); }).join(' · '));
  }
  return lines;
}

function summaryText(s) {
  return [monthName(s.month) + ' house total: ' + formatRupees(s.total)].concat(summaryLines_(s)).join('\n');
}

/** Running total for /month. */
function monthText(month, ledger) {
  const s = monthSummary(month, ledger);
  return monthName(s.month) + ' so far: ' + formatRupees(s.total) + ' house\n' + summaryLines_(s).join('\n');
}

function sendCloseSummary(month, ledger) {
  const posted = postedMonths()[month];
  const s = monthSummary(month, ledger);
  if (posted) {
    sendMessage(summaryText(s) + '\n\nAlready posted to Splitwise on ' + posted.on + '.',
      [[{ text: 'Open sheet', url: sheetUrl() }]]);
    return null;
  }
  const extra = isDryRun() ? '\n\nTest mode is on: Post will only show what it would send.' : '';
  const msgId = sendMessage(summaryText(s) + '\n\nCheck it against the card app, then post.' + extra, [
    [{ text: 'Post to Splitwise', callback_data: 'c:' + month + ':post' }],
    [{ text: 'Open sheet', url: sheetUrl() }],
  ]);
  setProp('SUMMARY_SENT_' + month, msgId || 'sent');
  return msgId;
}

function handleCloseTap(month, action, cq, ledger) {
  if (action !== 'post' || !/^\d{4}-\d{2}$/.test(month)) return null;
  const msgId = cq.message && cq.message.message_id;

  const posted = postedMonths()[month];
  if (posted) {
    sendMessage(monthName(month) + ' was already posted to Splitwise on ' + posted.on + '. Nothing more to do.');
    return 'Already posted';
  }

  const s = monthSummary(month, ledger);
  if (!(s.total > 0)) {
    sendMessage('Nothing to post for ' + monthName(month) + ': the house total is ' + formatRupees(s.total) + '.');
    return 'Nothing to post';
  }
  const payload = splitwisePayload(s);

  if (isDryRun()) {
    sendMessage('Test mode: this is what would go to Splitwise.\n\n' + describePayload_(payload) +
      '\n\nSet DRY_RUN to false in Script Properties to post for real.');
    return 'Test mode';
  }

  const result = splitwiseCreateExpense(payload);
  if (!result.ok) {
    appendLog('error', 'splitwise ' + month, result.error);
    sendMessage('Splitwise didn\'t accept it: ' + result.error + '\nNothing was posted. You can tap Post again.');
    return 'Failed';
  }

  markPosted(month, { on: formatIstDay(now_()), expense_id: result.id, total: s.total }, ledger);
  const done = summaryText(s) + '\n\nPosted to Splitwise as “' + payload.description + '”.';
  if (msgId) editMessage(msgId, done, [[{ text: 'Open sheet', url: sheetUrl() }]]);
  else sendMessage(done);
  return 'Posted';
}

function splitwisePayload(s) {
  const details = [monthName(s.month) + ' house total ' + formatRupees(s.total)]
    .concat(summaryLines_(s))
    .concat(['', 'Every order: ' + sheetUrl()])
    .join('\n');
  return {
    cost: s.total.toFixed(2),
    description: 'House · ' + monthLabel(s.month),
    currency_code: 'INR',
    group_id: Number(requireProp('SPLITWISE_GROUP_ID')),
    split_equally: true,
    date: lastDayOfMonth(s.month) + 'T06:30:00Z', // midday IST
    details: details,
  };
}

function describePayload_(p) {
  return [
    'Description: ' + p.description,
    'Cost: ₹' + p.cost + ' (' + p.currency_code + '), split equally, you paid',
    'Group: ' + p.group_id,
    'Date: ' + p.date.slice(0, 10),
    'Notes:\n' + p.details,
  ].join('\n');
}

function splitwise_(method, path, payload) {
  const opts = {
    method: method,
    headers: { Authorization: 'Bearer ' + requireProp('SPLITWISE_KEY') },
    muteHttpExceptions: true,
  };
  if (payload) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch('https://secure.splitwise.com/api/v3.0/' + path, opts);
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { error: res.getContentText() }; }
  return { code: res.getResponseCode(), body: body };
}

/** Returns {ok: true, id} or {ok: false, error}. */
function splitwiseCreateExpense(payload) {
  const res = splitwise_('post', 'create_expense', payload);
  const errors = res.body.errors;
  const errorText = errors && Object.keys(errors).length ? JSON.stringify(errors) : res.body.error;
  const expense = res.body.expenses && res.body.expenses[0];
  if (res.code >= 300 || errorText || !expense) {
    return { ok: false, error: errorText || ('HTTP ' + res.code) };
  }
  return { ok: true, id: expense.id };
}

/** Run once from the editor to find your flat's group id. */
function listSplitwiseGroups() {
  const res = splitwise_('get', 'get_groups');
  (res.body.groups || []).forEach(function (g) {
    console.log(g.id + '  ' + g.name + '  (' + (g.members || []).length + ' members)');
  });
  return res.body.groups;
}
