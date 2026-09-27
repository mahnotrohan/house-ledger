# House Ledger

This tool picks up every charge on the house card and asks you in Telegram how much of each order was yours. On the 1st of each month it posts one Splitwise record for the previous month.

It runs as Google Apps Script attached to a Google Sheet, in the **personal** Google account where your card alerts arrive. It doesn't need a server, and everything it uses is free.

```
You pay with the house card → bank alert email → Gmail label "house-card"
Every minute, tick():  new alert → Txns row → Telegram prompt → your tap or reply → row updated
On the 1st, dailyJob(): cook and maid rows for the new month + last month's summary → you tap Post → one Splitwise expense
```

## What's in here

| File | Job |
|---|---|
| `src/Parser.gs` | Reads a card alert: amount, charge or refund, merchant, time. Recognises bill payments, OTPs, statements and declined charges, and skips them |
| `src/Capture.gs` | Turns new labelled emails into rows. Never adds the same email twice. Anything it can't read goes to the Log tab and pings you |
| `src/Telegram.gs` | Prompts, buttons, the "Part mine" reply, and the `/add`, `/fixed`, `/month` and `/close` commands |
| `src/Close.gs` | Monthly summary, test mode and the Splitwise post |
| `src/Ledger.gs` | The sheet: rows, merchant names, fixed payments, month locking |
| `src/Main.gs` | Entry points you run: `setup`, `connectTelegram`, `installTriggers`, `backfill`… |
| `tests/` | 41 tests against sample alerts and fake Gmail, Sheets, Telegram and Splitwise. Run `tests/run.sh` |

## Setup (about 45 minutes)

### 1. The card and Gmail
1. Save the house card as the preferred payment method in Instamart, Blinkit, Zepto and Amazon.
2. Turn on email alerts for every transaction on that card, then make a small test purchase.
3. In Gmail, create a filter. Set **From** to the bank's alert address and **Has the words** to the card's last 4 digits. Choose **Apply the label**, create a label called `house-card`, and tick **Also apply filter to matching conversations**.

### 2. The sheet and script
1. Create a new Google Sheet called **House Ledger**.
2. Open **Extensions → Apps Script**. Create one script file for each file in `src/` (for example `Parser.gs`) and paste its contents in. You can delete the default `Code.gs`.
   *Or use clasp:* `npm i -g @google/clasp && clasp login && clasp create --type sheets --title "House Ledger" --rootDir .`, then `clasp push`.
3. In **Project Settings**, set the time zone to **(GMT+05:30) India Standard Time**.
4. Pick `setup` from the function menu and click **Run**. Google warns that the app is unverified. That's normal for a script you wrote yourself: choose **Advanced → Go to House Ledger**.
   This creates five tabs: **Txns**, **Fixed**, **Summary**, **Log** and **Merchants**. The Merchants tab is the editable list that maps alert names to apps, such as KIRANAKART → Zepto.
5. In the **Fixed** tab, fill in the cook's and maid's monthly amounts. Rows left at 0 are skipped.

### 3. Telegram
1. In Telegram, message **@BotFather**, send `/newbot` and copy the token it gives you.
2. In Apps Script, go to **Project Settings → Script Properties** and add `TELEGRAM_TOKEN` = that token.
3. Open your new bot in Telegram and send it `hi`.
4. Run `connectTelegram`. The bot replies "Connected". From then on it only listens to your chat.

### 4. Splitwise
1. Register an app at <https://secure.splitwise.com/apps> and generate an API key.
2. Add the Script Properties `SPLITWISE_KEY` = the key and `DRY_RUN` = `true`.
3. Run `listSplitwiseGroups`. The execution log lists your groups. Add `SPLITWISE_GROUP_ID` = your flat's id.
4. Run `checkConfig`. It should show ✓ for all four properties.

### 5. Start it
Run `installTriggers`. This runs `tick` every minute and `dailyJob` every day between 9 and 10am IST.

**Done when:** a test purchase gets a Telegram prompt within about 2 minutes.

## Checking each phase

**Phase 1: capture.** Run `backfill('2026-09-01', '2026-10-01')` (use your last statement period) and compare Txns with the statement total. Backfilled rows get no prompts; fill in `mine` for them in the sheet. If an alert shows up in **Log** as `unreadable`, see *When your bank's format isn't read* below.

**Phase 2: tagging.** Pay for a real order. The prompt should arrive within about 2 minutes. Try each button, and try **Part mine** with a reply such as `220`. Taps from anyone else are ignored.

**Phase 3: close.** Leave `DRY_RUN` at `true` and send `/close` to the bot. Tap **Post to Splitwise**: it shows exactly what it would send, which should match the Summary tab. To post for real, set `DRY_RUN` to `false`. Posting twice isn't possible.

**October, the first month:** run `addFixedForThisMonth` once to add October's cook and maid rows. From November on, `dailyJob` adds them on the 1st.

**1 Nov, the first close:** compare the sheet with October's transactions in the card app, then tap Post. If everything matches, retire the Excel.

## Using it

- **After paying**, ignore the prompt if it was all house. Tap **Part mine** and reply with a number if some items were yours, or **All mine** if it was a personal order. Old prompts still work until the month is posted.
- `/add 340 kirana` adds a house purchase made on another card, by UPI or in cash. A negative amount, such as `/add -120 fix`, corrects something.
- `/fixed maid 2800` changes this month's amount. To change it for every month, edit the Fixed tab.
- `/month` shows the running total, and `/close` sends last month's summary again.
- **On the 1st** you get the summary. Check it against the card app, then tap **Post to Splitwise**. After that, the month is locked, and anything that arrives later (such as a refund on 3 Nov for an October order) goes into November.
- You can edit `mine` directly in the Txns tab at any time before the month is posted. The `house` column recalculates on its own.

## When your bank's format isn't read

The reader works with any bank. It looks for an amount (`Rs`, `INR` or `₹`), a word such as *spent*, *debited* or *credited*, and a merchant phrase such as *at …*, *towards …*, *Info: …* or *Merchant Name: …*. It has been tested against HDFC, ICICI, Axis and SBI-style alerts, but those samples are written from memory, not taken from real emails. If your first real alert lands in **Log**:

1. Copy the email into `tests/samples.js`, with the card number hidden, and add what it should read as.
2. Run `tests/run.sh`, adjust the patterns at the top of `src/Parser.gs` until everything passes, and paste the updated `Parser.gs` into Apps Script.

## Limits and settings

- A run with no new mail and no taps is one Gmail search plus one Telegram call, usually well under 2 seconds. Free accounts get 90 minutes of trigger time a day. If runs get slow, run `slowDownToEvery5Minutes`.
- Errors go to the **Log** tab. Telegram pings you about errors at most once an hour.
- Secrets are stored only in Script Properties, never in the sheet, so you can share the sheet safely. Telegram messages contain only amounts and merchant names.
- A Splitwise expense is split equally across the whole group, with you as the payer, and dated the last day of the month. To change that, edit `splitwisePayload` in `src/Close.gs`.

## Not built (Phase 5 / later)

The SMS backup, the Sunday update, monthly backup copies, flatmates tagging through the bot, and per-person splits. The design leaves room for all of them: rows have a `source` column, and the bot checks the sender on every update.
