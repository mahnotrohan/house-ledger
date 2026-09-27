/*
 * Sample card alerts. These are written in the style Indian banks use; none is
 * a real email. When you get your first real alert, paste it in here (card
 * number hidden) with what it should read as, and run tests/run.sh.
 */

const SAMPLES = {
  hdfc_debit: {
    subject: 'Alert : Update on your HDFC Bank Credit Card',
    body: 'Dear Customer,\n\nRs.1,450.00 is debited from your HDFC Bank Credit Card ending 1234 towards BLINKIT on 03 Oct, 2026 at 12:34:56.\n\n' +
      'If you did not authorize this transaction, please report it immediately by calling on 18002586161 Or SMS BLOCK CC 1234 to 7308080808.\n\nWarm Regards,\nHDFC Bank',
    received: '2026-10-03T07:05:30Z',
    expect: { kind: 'debit', amount: 1450, merchant: 'BLINKIT', time: '2026-10-03 12:34', app: 'Blinkit' },
  },
  hdfc_debit_old: {
    subject: 'Alert : Update on your HDFC Bank Credit Card',
    body: 'Dear Card Member, Thank you for using your HDFC Bank Credit Card ending 1234 for Rs 2,310.50 at SWIGGY INSTAMART on 05-10-2026 20:11:04. ' +
      'Authorization code:- 004512. Please note that this transaction was conducted on your HDFC Bank Credit Card. Not you? Call us at 18002586161.',
    received: '2026-10-05T14:42:10Z',
    expect: { kind: 'debit', amount: 2310.5, merchant: 'SWIGGY INSTAMART', time: '2026-10-05 20:11', app: 'Instamart' },
  },
  icici_debit: {
    subject: 'Transaction alert for your ICICI Bank Credit Card',
    body: 'Dear Customer, Your ICICI Bank Credit Card XX1234 has been used for a transaction of INR 612.00 on Oct 07, 2026 at 09:15:22. ' +
      'Info: KIRANAKART TECHNOLOGIES. The Available Credit Limit on your card is INR 1,23,456.78 and Total Credit Limit is INR 2,00,000.00.',
    received: '2026-10-07T03:46:00Z',
    expect: { kind: 'debit', amount: 612, merchant: 'KIRANAKART TECHNOLOGIES', time: '2026-10-07 09:15', app: 'Zepto' },
  },
  axis_debit_html: {
    subject: 'Transaction alert on Axis Bank Credit Card no. XX1234',
    html: true,
    body: '<html><head><style>td{font:12px}</style></head><body><table>' +
      '<tr><td>Transaction Amount:</td><td>INR 899</td></tr>' +
      '<tr><td>Merchant Name:</td><td>AMAZON PAY INDIA</td></tr>' +
      '<tr><td>Axis Bank Credit Card No.</td><td>XX1234</td></tr>' +
      '<tr><td>Date &amp; Time:</td><td>09-10-2026, 18:02:44 IST</td></tr>' +
      '<tr><td>Available Limit*:</td><td>INR 50,000</td></tr></table></body></html>',
    received: '2026-10-09T12:33:00Z',
    expect: { kind: 'debit', amount: 899, merchant: 'AMAZON PAY INDIA', time: '2026-10-09 18:02', app: 'Amazon' },
  },
  sbi_debit_date_only: {
    subject: 'Transaction Alert from SBI Card',
    body: 'Rs.1,020.00 spent on your SBI Credit Card ending with 1234 at ZEPTO MARKETPLACE on 11/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute',
    received: '2026-10-11T15:20:00Z',
    // No time in the body, so the email's time (20:50 IST) is used.
    expect: { kind: 'debit', amount: 1020, merchant: 'ZEPTO MARKETPLACE', time: '2026-10-11 20:50', app: 'Zepto' },
  },
  hdfc_refund: {
    subject: 'Refund credited to your HDFC Bank Credit Card',
    body: 'Dear Customer, Rs.450.00 has been credited to your HDFC Bank Credit Card ending 1234 on 12 Oct, 2026 as a refund from BLINKIT. Warm Regards, HDFC Bank',
    received: '2026-10-12T05:00:00Z',
    expect: { kind: 'credit', amount: 450, merchant: 'BLINKIT', time: '2026-10-12 10:30', app: 'Blinkit' },
  },
  icici_reversal: {
    subject: 'Transaction alert for your ICICI Bank Credit Card',
    body: 'Dear Customer, a reversal of INR 612.00 has been credited to your ICICI Bank Credit Card XX1234 on 14-Oct-26. Info: KIRANAKART TECHNOLOGIES.',
    received: '2026-10-14T09:00:00Z',
    expect: { kind: 'credit', amount: 612, merchant: 'KIRANAKART TECHNOLOGIES', time: '2026-10-14 14:30', app: 'Zepto' },
  },
  card_payment: {
    subject: 'Payment received on your HDFC Bank Credit Card',
    body: 'Dear Customer, Payment of Rs. 25,000.00 has been received towards your HDFC Bank Credit Card ending 1234 on 15-10-2026. Thank you.',
    received: '2026-10-15T06:00:00Z',
    expect: { kind: 'skip', reason: 'card payment' },
  },
  statement: {
    subject: 'Your HDFC Bank Credit Card statement',
    body: 'Your HDFC Bank Credit Card statement for Sep 2026 is ready. Total amount due: Rs 18,234.00. Minimum amount due: Rs 920.00.',
    received: '2026-10-02T04:00:00Z',
    expect: { kind: 'skip', reason: 'statement' },
  },
  otp: {
    subject: 'OTP for your transaction',
    body: '482913 is your OTP for a transaction of INR 1,450.00 at BLINKIT on your card ending 1234. Do not share it with anyone.',
    received: '2026-10-03T07:04:00Z',
    expect: { kind: 'skip', reason: 'otp' },
  },
  declined: {
    subject: 'Transaction declined',
    body: 'Transaction of INR 5,000.00 on your ICICI Bank Credit Card XX1234 at AMAZON has been declined due to insufficient limit.',
    received: '2026-10-16T06:00:00Z',
    expect: { kind: 'skip', reason: 'declined' },
  },
  promo: {
    subject: 'Exclusive offer on your card ending 1234',
    body: 'Get 10X reward points on dining this weekend! Offer valid till 31 Oct.',
    received: '2026-10-17T06:00:00Z',
    expect: { kind: 'unknown' },
  },
  statement_date_far_away: {
    subject: 'Alert : Update on your HDFC Bank Credit Card',
    body: 'Rs.300.00 is debited from your HDFC Bank Credit Card ending 1234 towards ZEPTO on 01-01-2020 00:00:00.',
    received: '2026-10-18T06:00:00Z',
    // A body date miles from the email's date is ignored.
    expect: { kind: 'debit', amount: 300, merchant: 'ZEPTO', time: '2026-10-18 11:30', app: 'Zepto' },
  },
};
