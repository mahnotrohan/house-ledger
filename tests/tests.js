/* House Ledger tests. Run with tests/run.sh. */

const results = { pass: 0, fail: 0 };

function test(name, fn) {
  resetWorld();
  try {
    fn();
    results.pass++;
    print('  ✓ ' + name);
  } catch (e) {
    results.fail++;
    print('  ✗ ' + name + '\n      ' + e.message + (e.stack ? '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ') : ''));
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((what || 'value') + ': expected ' + e + ', got ' + a);
}

function ok(cond, what) {
  if (!cond) throw new Error(what || 'expected true');
}

function has(text, part, what) {
  if (String(text).indexOf(part) < 0) throw new Error((what || 'text') + ' should contain ' + JSON.stringify(part) + ' but was ' + JSON.stringify(text));
}

function ready() {
  setup();
  W.props.TELEGRAM_TOKEN = 'tok';
  W.props.CHAT_ID = String(OWNER.id);
  W.props.SPLITWISE_KEY = 'swkey';
  W.props.SPLITWISE_GROUP_ID = '42';
  W.ss.getSheetByName('Fixed').getRange(2, 1, 2, 3).setValues([['Cook', 4000, true], ['Maid', 3000, true]]);
}

function txns() {
  return new Ledger().all();
}

function logRows() {
  return W.ss.getSheetByName('Log').rows();
}

function mailAt(name, when, thread) {
  const s = SAMPLES[name];
  return addMail(s, when || s.received, thread);
}

/** Moves the clock to the sample's arrival + 1 min, then runs tick(). */
function tickAt(iso) {
  W.now = new Date(new Date(iso).getTime() + 60000);
  tick();
}

/** A sample alert lands in Gmail and the next minute's tick() runs. */
function arrive(name) {
  const m = mailAt(name);
  tickAt(m.date.toISOString());
  return m;
}

// ───────────────────────────────────────────────────────────────────────────
print('\nUtil');

test('money formats the Indian way', function () {
  eq(formatRupees(1450), '₹1,450');
  eq(formatRupees(2310.5), '₹2,310.50');
  eq(formatRupees(123456.78), '₹1,23,456.78');
  eq(formatRupees(-450), '−₹450');
  eq(formatRupees(18420), '₹18,420');
});

test('share replies: 220, ₹220, Rs 220, 220.5, 1,200 work; junk and negatives do not', function () {
  eq([parseAmountInput('220'), parseAmountInput('₹220'), parseAmountInput('Rs 220'), parseAmountInput('220.5'), parseAmountInput('1,200')],
    [220, 220, 220, 220.5, 1200]);
  eq([parseAmountInput('-220'), parseAmountInput('abc'), parseAmountInput('2 20'), parseAmountInput('')], [null, null, null, null]);
});

test('months step across year ends and name themselves', function () {
  eq(nextMonth('2026-12'), '2027-01');
  eq(prevMonth('2026-01'), '2025-12');
  eq(monthLabel('2026-10'), 'Oct 2026');
  eq(lastDayOfMonth('2026-02'), '2026-02-28');
  eq(lastDayOfMonth('2028-02'), '2028-02-29');
  eq(monthOf(new Date('2026-10-31T19:00:00Z')), '2026-11', 'month is IST (00:30 on 1 Nov)');
});

// ───────────────────────────────────────────────────────────────────────────
print('\nAlert reader');

Object.keys(SAMPLES).forEach(function (name) {
  const s = SAMPLES[name];
  test(name + ' → ' + s.expect.kind, function () {
    const p = parseAlert({ subject: s.subject, body: s.body, date: new Date(s.received) });
    eq(p.kind, s.expect.kind, 'kind');
    if (s.expect.reason) eq(p.reason, s.expect.reason, 'reason');
    if (s.expect.amount !== undefined) eq(p.amount, s.expect.amount, 'amount');
    if (s.expect.merchant !== undefined) eq(p.merchant, s.expect.merchant, 'merchant');
    if (s.expect.time !== undefined) eq(formatIst(p.time), s.expect.time, 'time');
    if (s.expect.app !== undefined) eq(appFor(p.merchant), s.expect.app, 'app');
  });
});

// ───────────────────────────────────────────────────────────────────────────
print('\nPhase 1 · capture');

test('a charge and a refund become rows; unrelated mail does not', function () {
  setup();
  arrive('statement');
  arrive('hdfc_debit');
  arrive('hdfc_refund');
  const rows = txns();
  eq(rows.map(function (r) { return [r.id.slice(0, 3), r.month, r.app, r.amount, r.house, r.tag, r.source]; }), [
    ['gm:', '2026-10', 'Blinkit', 1450, 1450, 'auto', 'email'],
    ['gm:', '2026-10', 'Blinkit', -450, -450, 'auto', 'email'],
  ]);
  eq(logRows().map(function (r) { return r[1]; }), ['skipped']);
});

test('running twice adds nothing new', function () {
  setup();
  arrive('hdfc_debit');
  arrive('icici_debit');
  tickAt('2026-10-07T03:47:00Z');
  tick();
  eq(txns().length, 2);
});

test('alerts sharing one Gmail thread are each picked up', function () {
  setup();
  mailAt('hdfc_debit', '2026-10-03T07:05:30Z', 'thread-A');
  tickAt('2026-10-03T07:05:30Z');
  mailAt('hdfc_debit_old', '2026-10-05T14:42:10Z', 'thread-A');
  tickAt('2026-10-05T14:42:10Z');
  eq(txns().map(function (r) { return r.amount; }), [1450, 2310.5]);
});

test('old messages in a thread, before the look-back window, are left alone', function () {
  setup();
  addMail(SAMPLES.hdfc_debit, '2026-09-10T07:00:00Z', 'thread-A');
  mailAt('hdfc_debit_old', '2026-10-05T14:42:10Z', 'thread-A');
  tickAt('2026-10-05T14:42:10Z');
  eq(txns().map(function (r) { return r.amount; }), [2310.5]);
});

test('an unreadable alert goes to Log (once), never to Txns, and pings you', function () {
  ready();
  arrive('promo');
  tickAt('2026-10-17T06:01:00Z');
  eq(txns().length, 0);
  eq(logRows().map(function (r) { return r[1]; }), ['unreadable']);
  has(sent()[0].p.text, 'couldn\'t read');
  has(sent()[0].p.reply_markup.inline_keyboard[0][0].url, 'mail.google.com');
  eq(sent().filter(function (c) { return /couldn't read/.test(c.p.text); }).length, 1, 'pings');
});

test('backfill loads a past period silently, and the total matches', function () {
  ready();
  addMail(SAMPLES.hdfc_debit, '2026-09-03T07:05:30Z');
  addMail(SAMPLES.icici_debit, '2026-09-07T03:46:00Z');
  addMail(SAMPLES.hdfc_refund, '2026-09-12T05:00:00Z');
  addMail(SAMPLES.hdfc_debit, '2026-10-03T07:05:30Z'); // outside the range
  W.now = new Date('2026-10-04T00:00:00Z');
  const added = backfill('2026-09-01', '2026-10-01');
  eq(added.length, 3);
  eq(txns().reduce(function (s, r) { return s + r.amount; }, 0), 1450 + 612 - 450);
  eq(sent().length, 0, 'no prompts for backfilled rows');
});

// ───────────────────────────────────────────────────────────────────────────
print('\nPhase 2 · tagging');

function chargeWithPrompt() {
  ready();
  arrive('hdfc_debit');
  return txns()[0];
}

test('a charge gets a prompt with three buttons', function () {
  const row = chargeWithPrompt();
  const p = sent()[0].p;
  eq(p.text, '₹1,450 · Blinkit · 3 Oct, 12:34\nCounts as house unless you say otherwise.');
  eq(p.reply_markup.inline_keyboard[0].map(function (b) { return b.text; }), ['All house', 'Part mine', 'All mine']);
  eq(p.reply_markup.inline_keyboard[0][1].callback_data, 't:' + row.row + ':p');
  ok(row.tg_msg_id, 'tg_msg_id saved');
});

test('All house confirms; All mine moves it to you; tapping twice changes nothing', function () {
  const row = chargeWithPrompt();
  userTaps('t:' + row.row + ':h', row.tg_msg_id);
  tick();
  eq([txns()[0].tag, txns()[0].mine], ['house', 0]);
  has(sent('editMessageText')[0].p.text, 'All house.');

  userTaps('t:' + row.row + ':m', row.tg_msg_id);
  userTaps('t:' + row.row + ':m', row.tg_msg_id);
  tick();
  eq([txns()[0].tag, txns()[0].mine, txns()[0].house], ['mine', 1450, 0]);
});

test('Part mine asks, and a reply of 220 splits it 1,230 / 220', function () {
  const row = chargeWithPrompt();
  userTaps('t:' + row.row + ':p', row.tg_msg_id);
  tick();
  eq(lastSent().text, 'How much of ₹1,450 · Blinkit was yours?');
  ok(lastSent().reply_markup.force_reply, 'force reply');

  userSays('₹220');
  tick();
  const r = txns()[0];
  eq([r.tag, r.mine, r.house], ['part', 220, 1230]);
  const edit = sent('editMessageText').pop().p;
  eq(edit.message_id, Number(row.tg_msg_id));
  has(edit.text, '₹1,230 house · ₹220 yours.');
  eq(W.props.PENDING_PART, '[]');
});

test('Part mine: junk, negatives and more than the total are asked again', function () {
  const row = chargeWithPrompt();
  userTaps('t:' + row.row + ':p', row.tg_msg_id);
  tick();
  ['lots', '-50', '2000'].forEach(function (bad) {
    userSays(bad);
    tick();
    has(lastSent().text, 'Send a number from 0 to 1,450');
    eq(txns()[0].mine, 0);
  });
  userSays('220.5');
  tick();
  eq(txns()[0].mine, 220.5);
});

test('a bare number goes to the latest open question; a reply goes to the one it replies to', function () {
  ready();
  arrive('hdfc_debit');
  arrive('icici_debit');
  const rows = txns();
  userTaps('t:' + rows[0].row + ':p', rows[0].tg_msg_id);
  userTaps('t:' + rows[1].row + ':p', rows[1].tg_msg_id);
  tick();
  const blinkitQuestion = 5000 + sent().length - 1; // message ids count up from 5001
  userSays('100');                          // latest → ICICI
  userSays('300', OWNER, blinkitQuestion);  // reply to the Blinkit question
  tick();
  eq(txns().map(function (r) { return r.mine; }), [300, 100]);
});

test('refunds get one button, It was mine', function () {
  ready();
  arrive('hdfc_refund');
  const row = txns()[0];
  const p = sent()[0].p;
  eq(p.text, '−₹450 · Blinkit refund · 12 Oct, 10:30\nCounted as a house refund.');
  eq(p.reply_markup.inline_keyboard, [[{ text: 'It was mine', callback_data: 't:' + row.row + ':m' }]]);
  userTaps('t:' + row.row + ':m', row.tg_msg_id);
  tick();
  eq([txns()[0].mine, txns()[0].house, txns()[0].tag], [-450, 0, 'mine']);
});

test('the bot ignores everyone except you', function () {
  const row = chargeWithPrompt();
  const before = sent().length;
  userTaps('t:' + row.row + ':m', row.tg_msg_id, STRANGER);
  userSays('/add 5000 stuff', STRANGER);
  tick();
  eq(txns().length, 1);
  eq(txns()[0].tag, 'auto');
  eq(sent().length, before);
});

test('/add, /fixed and /month', function () {
  ready();
  userSays('/add 340 kirana');
  userSays('/fixed maid 2800');
  tick();
  eq(txns().map(function (r) { return [r.id.slice(0, 4), r.amount, r.tag, r.source]; }),
    [['man:', 340, 'house', 'manual'], ['fix:', 2800, 'house', 'fixed']]);
  has(sent()[0].p.text, 'Added ₹340 · kirana to October');

  userSays('/fixed maid 3100');
  userSays('/month');
  tick();
  eq(txns().filter(function (r) { return r.source === 'fixed'; }).map(function (r) { return r.amount; }), [3100]);
  eq(lastSent().text, 'October so far: ₹3,440 house\nGroceries ₹340 · 1 order\nMaid ₹3,100');
});

test('/add is not applied twice if Telegram re-sends the same update', function () {
  ready();
  userSays('/add 340 kirana');
  tick();
  W.props.TG_OFFSET = '0'; // pretend the offset was lost
  tick();
  eq(txns().length, 1);
});

// ───────────────────────────────────────────────────────────────────────────
print('\nPhase 3 · month-end close');

function october() {
  ready();
  W.now = new Date('2026-10-01T03:00:00Z');
  addFixedForThisMonth();
  arrive('hdfc_debit');
  arrive('hdfc_debit_old');
  arrive('icici_debit');
  arrive('hdfc_refund');
  const rows = txns().filter(function (r) { return r.source === 'email'; });
  userTaps('t:' + rows[0].row + ':p', rows[0].tg_msg_id);
  tick();
  userSays('220');
  tick();
}

test('on the 1st: new month\'s fixed rows, then last month\'s summary', function () {
  october();
  W.now = new Date('2026-11-01T03:40:00Z'); // 09:10 IST
  dailyJob();
  const nov = txns().filter(function (r) { return r.month === '2026-11'; });
  eq(nov.map(function (r) { return r.id; }), ['fix:2026-11:cook', 'fix:2026-11:maid']);
  const p = lastSent();
  eq(p.text.split('\n\n')[0],
    'October house total: ₹10,702.50\nGroceries ₹3,702.50 · 3 orders (₹220 of yours taken out)\nCook ₹4,000 · Maid ₹3,000');
  eq(p.reply_markup.inline_keyboard[0][0].callback_data, 'c:2026-10:post');

  const count = sent().length;
  dailyJob();
  eq(sent().length, count, 'summary is sent once');
  eq(txns().filter(function (r) { return r.month === '2026-11'; }).length, 2, 'fixed rows added once');
});

test('dailyJob does nothing on other days', function () {
  october();
  W.now = new Date('2026-11-02T03:40:00Z');
  const count = sent().length;
  dailyJob();
  eq(sent().length, count);
  eq(txns().filter(function (r) { return r.month === '2026-11'; }).length, 0);
});

test('test mode shows exactly what would be posted, matching the summary, and posts nothing', function () {
  october();
  W.props.DRY_RUN = 'true';
  W.now = new Date('2026-11-01T03:40:00Z');
  dailyJob();
  const summaryId = 5000 + sent().length;
  userTaps('c:2026-10:post', summaryId);
  tick();
  eq(W.splitwise.length, 0);
  const t = lastSent().text;
  has(t, 'Test mode');
  has(t, 'Description: House · Oct 2026');
  has(t, 'Cost: ₹10702.50');
  has(t, 'Every order: https://docs.google.com/spreadsheets/d/sheet-123');
  ok(!isPosted('2026-10'), 'not marked posted');
});

test('the summary total equals the sum of the house column (what the Summary tab adds up)', function () {
  october();
  const s = monthSummary('2026-10', new Ledger());
  const sheetSum = W.ss.getSheetByName('Txns').rows()
    .filter(function (r) { return r[2] === '2026-10'; })
    .reduce(function (a, r) { return a + r[8]; }, 0);
  eq(s.total, Math.round(sheetSum * 100) / 100);
});

test('Post creates exactly one Splitwise expense; tapping again does nothing', function () {
  october();
  W.now = new Date('2026-11-01T03:40:00Z');
  dailyJob();
  const summaryId = 5000 + sent().length;
  userTaps('c:2026-10:post', summaryId);
  userTaps('c:2026-10:post', summaryId);
  tick();
  userTaps('c:2026-10:post', summaryId);
  tick();
  eq(W.splitwise.length, 1);
  const p = W.splitwise[0].payload;
  eq([p.cost, p.description, p.currency_code, p.group_id, p.split_equally, p.date],
    ['10702.50', 'House · Oct 2026', 'INR', 42, true, '2026-10-31T06:30:00Z']);
  eq(W.splitwise[0].auth, 'Bearer swkey');
  has(p.details, 'Every order: https://docs.google.com/spreadsheets/d/sheet-123');
  ok(isPosted('2026-10'));
  ok(txns().filter(function (r) { return r.month === '2026-10'; }).every(function (r) { return r.posted_on === '2026-11-01'; }), 'rows stamped');
  has(sent('editMessageText').pop().p.text, 'Posted to Splitwise');
  has(lastSent().text, 'already posted');
});

test('if Splitwise refuses, nothing is marked posted and you can retry', function () {
  october();
  W.splitwiseFail = 'Invalid group';
  W.now = new Date('2026-11-01T03:40:00Z');
  dailyJob();
  userTaps('c:2026-10:post', 5000 + sent().length);
  tick();
  ok(!isPosted('2026-10'));
  has(lastSent().text, 'Splitwise didn\'t accept it');
  W.splitwiseFail = null;
  userTaps('c:2026-10:post', 5000);
  tick();
  eq(W.splitwise.length, 1);
});

test('after the close: a late October refund goes into November, and October taps are refused', function () {
  october();
  W.now = new Date('2026-11-01T03:40:00Z');
  dailyJob();
  userTaps('c:2026-10:post', 5000 + sent().length);
  tick();

  // Refund for an October order, dated 31 Oct but arriving after the post.
  const late = { subject: SAMPLES.icici_reversal.subject, body: SAMPLES.icici_reversal.body.replace('14-Oct-26', '31-Oct-26') };
  addMail(late, '2026-11-01T05:00:00Z');
  tickAt('2026-11-01T05:00:00Z');
  const refund = txns().filter(function (r) { return r.amount === -612; })[0];
  eq(refund.month, '2026-11');
  eq(refund.txn_time.slice(0, 10), '2026-10-31');

  const oct = txns().filter(function (r) { return r.month === '2026-10' && r.source === 'email'; })[1];
  userTaps('t:' + oct.row + ':m', oct.tg_msg_id);
  tick();
  eq(txns().filter(function (r) { return r.id === oct.id; })[0].tag, 'auto');
  has(lastSent().text, 'October is already posted');
});

test('manual edits in the sheet (filling in mine) flow into the close', function () {
  october();
  const sh = W.ss.getSheetByName('Txns');
  const r = txns().filter(function (x) { return x.app === 'Zepto'; })[0];
  sh.getRange(r.row, 8).setValue(100);
  eq(monthSummary('2026-10', new Ledger()).mineOut, 320);
});

// ───────────────────────────────────────────────────────────────────────────
print('\nSetup');

test('setup is safe to re-run and never overwrites your Fixed amounts', function () {
  ready();
  setup();
  eq(fixedList().map(function (f) { return [f.name, f.amount]; }), [['Cook', 4000], ['Maid', 3000]]);
  eq(W.ss.getSheetByName('Txns').getRange(1, 1, 1, 12).getValues()[0], TXN_COLS);
});

test('connectTelegram remembers the chat that said hi', function () {
  setup();
  W.props.TELEGRAM_TOKEN = 'tok';
  userSays('hi');
  connectTelegram();
  eq(W.props.CHAT_ID, '111');
  eq(W.props.TG_OFFSET, '2');
  has(lastSent().text, 'Connected');
});

print('\n' + results.pass + ' passed, ' + results.fail + ' failed\n');
if (results.fail) throw new Error(results.fail + ' test(s) failed');
