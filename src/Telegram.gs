/**
 * House Ledger: the Telegram bot.
 *
 * Apps Script can't take Telegram webhooks (it answers with a redirect that
 * Telegram rejects), so tick() asks for new updates with getUpdates every
 * minute. Button taps often arrive too late to acknowledge ("query is too
 * old"); that's expected, and the edited message is the confirmation.
 *
 * Button data (64-byte limit) carries only a row hint and an action:
 *   t:<row>:h  all house     t:<row>:p  part mine     t:<row>:m  all mine
 *   c:<yyyy-mm>:post         post that month to Splitwise
 */

const QUIET_ERRORS_RE = /query is too old|query id is invalid|message is not modified/i;

function telegramReady() {
  return !!(prop('TELEGRAM_TOKEN') && prop('CHAT_ID'));
}

function tg_(method, params) {
  const url = 'https://api.telegram.org/bot' + requireProp('TELEGRAM_TOKEN') + '/' + method;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(params || {}),
    muteHttpExceptions: true,
  });
  let body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { ok: false, description: res.getContentText() }; }
  if (!body.ok && !QUIET_ERRORS_RE.test(body.description || '')) {
    console.warn('Telegram ' + method + ' failed: ' + body.description);
  }
  return body;
}

function sendMessage(text, keyboard, extra) {
  const params = { chat_id: requireProp('CHAT_ID'), text: text, disable_web_page_preview: true };
  if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
  Object.keys(extra || {}).forEach(function (k) { params[k] = extra[k]; });
  const res = tg_('sendMessage', params);
  return res.ok ? res.result.message_id : null;
}

function editMessage(msgId, text, keyboard) {
  const params = { chat_id: requireProp('CHAT_ID'), message_id: Number(msgId), text: text, disable_web_page_preview: true };
  params.reply_markup = { inline_keyboard: keyboard || [] };
  return tg_('editMessageText', params);
}

function askFor(text) {
  return sendMessage(text, null, { reply_markup: { force_reply: true, input_field_placeholder: 'e.g. 220' } });
}

function isOwner_(user, chat) {
  const me = prop('CHAT_ID');
  if (!me || !user || String(user.id) !== me) return false;
  return !chat || String(chat.id) === me;
}

// ─── Polling ───────────────────────────────────────────────────────────────

function pollTelegram(ledger) {
  const offset = Number(prop('TG_OFFSET') || 0);
  const res = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
  if (!res.ok || !res.result.length) return 0;

  let next = offset;
  res.result.forEach(function (u) {
    next = Math.max(next, u.update_id + 1);
    try {
      if (u.callback_query) handleCallback_(u.callback_query, ledger);
      else if (u.message) handleMessage_(u.message, ledger, u.update_id);
    } catch (e) {
      logError('telegram update ' + u.update_id, e);
    }
  });
  setProp('TG_OFFSET', next);
  return res.result.length;
}

// ─── Prompts ───────────────────────────────────────────────────────────────

function sendPrompts(recs, ledger) {
  recs.forEach(function (rec) {
    const msgId = sendMessage(promptText(rec), promptKeyboard(rec));
    if (msgId) ledger.update(rec.row, { tg_msg_id: msgId });
  });
}

function label_(rec) {
  return rec.app && rec.app !== 'Other' ? rec.app : (rec.merchant_raw || 'Other');
}

function promptText(rec) {
  const when = parseIst(rec.txn_time);
  const head = formatRupees(rec.amount) + ' · ' + label_(rec) + (rec.amount < 0 ? ' refund' : '') +
    (when ? ' · ' + shortStamp(when) : '');
  let status;
  if (rec.amount < 0) {
    status = rec.tag === 'mine' ? 'Refund on your share.' : 'Counted as a house refund.';
  } else if (rec.tag === 'house') {
    status = 'All house.';
  } else if (rec.tag === 'mine') {
    status = 'All yours.';
  } else if (rec.tag === 'part') {
    status = formatRupees(rec.house) + ' house · ' + formatRupees(rec.mine) + ' yours.';
  } else {
    status = 'Counts as house unless you say otherwise.';
  }
  return head + '\n' + status;
}

function promptKeyboard(rec) {
  const r = rec.row;
  if (rec.amount < 0) {
    return rec.tag === 'mine'
      ? [[{ text: 'It was house', callback_data: 't:' + r + ':h' }]]
      : [[{ text: 'It was mine', callback_data: 't:' + r + ':m' }]];
  }
  return [[
    { text: 'All house', callback_data: 't:' + r + ':h' },
    { text: 'Part mine', callback_data: 't:' + r + ':p' },
    { text: 'All mine', callback_data: 't:' + r + ':m' },
  ]];
}

// ─── Taps ──────────────────────────────────────────────────────────────────

function handleCallback_(cq, ledger) {
  if (!isOwner_(cq.from, cq.message && cq.message.chat)) return;
  const parts = String(cq.data || '').split(':');
  let note = null;
  if (parts[0] === 't') note = handleTxnTap_(Number(parts[1]), parts[2], cq, ledger);
  if (parts[0] === 'c') note = handleCloseTap(parts[1], parts[2], cq, ledger);
  tg_('answerCallbackQuery', { callback_query_id: cq.id, text: note || '' });
}

function handleTxnTap_(rowHint, action, cq, ledger) {
  const msgId = cq.message && cq.message.message_id;
  const rec = ledger.byPrompt(rowHint, msgId);
  if (!rec) {
    sendMessage('I can\'t find that order in the sheet any more.');
    return 'Not found';
  }
  if (refuseIfPosted_(rec)) return 'Already posted';

  let updated = rec;
  if (action === 'h') {
    clearPending_(rec.id);
    updated = ledger.update(rec.row, { mine: 0, tag: 'house' });
  } else if (action === 'm') {
    clearPending_(rec.id);
    updated = ledger.update(rec.row, { mine: rec.amount, tag: 'mine' });
  } else if (action === 'p' && rec.amount > 0) {
    const q = askFor('How much of ' + formatRupees(rec.amount) + ' · ' + label_(rec) + ' was yours?');
    pushPending_({ id: rec.id, row: rec.row, q: q });
    return 'Reply with your share';
  } else {
    return null;
  }
  editMessage(msgId, promptText(updated), promptKeyboard(updated));
  return 'Saved';
}

function refuseIfPosted_(rec) {
  if (!rec.posted_on && !isPosted(rec.month)) return false;
  sendMessage(monthName(rec.month) + ' is already posted to Splitwise, so this order can\'t change now. ' +
    'If it needs fixing, use /add with a negative amount (for example /add -220 fix) and it goes into this month.');
  return true;
}

// ─── Pending "Part mine" questions ─────────────────────────────────────────

function pending_() {
  return jsonProp('PENDING_PART', []);
}

function savePending_(list) {
  setProp('PENDING_PART', JSON.stringify(list.slice(-20)));
}

function pushPending_(item) {
  const list = pending_().filter(function (p) { return p.id !== item.id; });
  list.push(item);
  savePending_(list);
}

function clearPending_(id) {
  const list = pending_();
  const kept = list.filter(function (p) { return p.id !== id; });
  if (kept.length !== list.length) savePending_(kept);
}

// ─── Messages ──────────────────────────────────────────────────────────────

function handleMessage_(msg, ledger, updateId) {
  if (!isOwner_(msg.from, msg.chat)) return;
  const text = String(msg.text || '').trim();
  if (!text) return;

  if (text.charAt(0) === '/') {
    handleCommand_(text, ledger, updateId);
    return;
  }

  const list = pending_();
  if (!list.length) {
    sendMessage(parseAmountInput(text) !== null
      ? 'There\'s no open question. Tap “Part mine” on an order first.'
      : HELP_TEXT);
    return;
  }

  // A reply to a specific question goes to that question; otherwise the latest one.
  const replyTo = msg.reply_to_message && msg.reply_to_message.message_id;
  const target = list.filter(function (p) { return replyTo && String(p.q) === String(replyTo); })[0] || list[list.length - 1];
  answerPart_(target, text, ledger);
}

function answerPart_(pending, text, ledger) {
  const rec = ledger.byId(pending.id);
  if (!rec) {
    clearPending_(pending.id);
    sendMessage('That order isn\'t in the sheet any more.');
    return;
  }
  if (refuseIfPosted_(rec)) {
    clearPending_(rec.id);
    return;
  }
  const v = parseAmountInput(text);
  if (v === null || v > rec.amount) {
    const q = askFor('Send a number from 0 to ' + formatRupees(rec.amount).slice(1) +
      '. How much of ' + formatRupees(rec.amount) + ' · ' + label_(rec) + ' was yours?');
    pushPending_({ id: rec.id, row: rec.row, q: q });
    return;
  }

  clearPending_(rec.id);
  const tag = v === 0 ? 'house' : v === rec.amount ? 'mine' : 'part';
  const updated = ledger.update(rec.row, { mine: round2(v), tag: tag });
  if (updated.tg_msg_id) editMessage(updated.tg_msg_id, promptText(updated), promptKeyboard(updated));
  sendMessage('Got it: ' + label_(updated) + ' is ' + formatRupees(updated.house) + ' house, ' + formatRupees(updated.mine) + ' yours.');
}

// ─── Commands ──────────────────────────────────────────────────────────────

const HELP_TEXT = [
  'I post a prompt for every house-card charge. Tap a button, or ignore it and it counts as house.',
  '',
  '/add 340 kirana: add a house entry (another card, UPI, cash)',
  '/fixed maid 2800: change this month\'s amount for a fixed payment',
  '/month: running total for this month',
  '/close: send last month\'s summary again',
].join('\n');

function handleCommand_(text, ledger, updateId) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/@.*$/, '');
  const args = parts.slice(1);

  if (cmd === '/add') return cmdAdd_(args, ledger, updateId);
  if (cmd === '/fixed') return cmdFixed_(args, ledger);
  if (cmd === '/month') return sendMessage(monthText(openMonthFor(monthOf(now_())), ledger));
  if (cmd === '/close') return sendCloseSummary(args[0] || prevMonth(monthOf(now_())), ledger);
  sendMessage(HELP_TEXT);
}

function cmdAdd_(args, ledger, updateId) {
  const raw = String(args[0] || '');
  const negative = /^[-−]/.test(raw);
  const v = parseAmountInput(raw.replace(/^[-−]/, ''));
  if (v === null || v === 0) {
    sendMessage('Usage: /add 340 kirana (a negative amount like /add -120 refund also works)');
    return;
  }
  const note = args.slice(1).join(' ') || 'manual';
  const id = 'man:' + updateId;
  if (ledger.byId(id)) return;
  const month = openMonthFor(monthOf(now_()));
  const rec = ledger.append({
    id: id, txn_time: formatIst(now_()), month: month, source: 'manual',
    merchant_raw: note, app: appFor(note), amount: negative ? -v : v, mine: 0, tag: 'house',
  });
  sendMessage('Added ' + formatRupees(rec.amount) + ' · ' + note + ' to ' + monthName(month) + ' as house.');
}

function cmdFixed_(args, ledger) {
  const name = String(args[0] || '');
  const v = parseAmountInput(args[1]);
  const fixed = fixedList().filter(function (f) { return f.name.toLowerCase() === name.toLowerCase(); })[0];
  if (!fixed || v === null) {
    const names = fixedList().map(function (f) { return f.name.toLowerCase(); }).join(', ') || 'none yet';
    sendMessage('Usage: /fixed maid 2800 (fixed payments: ' + names + ')');
    return;
  }
  const month = openMonthFor(monthOf(now_()));
  const id = fixedId(month, fixed.name);
  const existing = ledger.byId(id);
  if (existing) {
    ledger.update(existing.row, { amount: v });
  } else {
    ledger.append({
      id: id, txn_time: month + '-01 00:00', month: month, source: 'fixed',
      merchant_raw: fixed.name, app: fixed.name, amount: v, mine: 0, tag: 'house',
    });
  }
  sendMessage(fixed.name + ' for ' + monthName(month) + ' is now ' + formatRupees(v) + '. ' +
    'To change it for every month, edit the Fixed tab.');
}
