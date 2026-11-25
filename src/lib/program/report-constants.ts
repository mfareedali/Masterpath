/**
 * Limits shared by the "Report incorrect data" form (client) and /api/report (server).
 * Kept separate from ./report.ts so the client bundle does not pull in zod.
 */
export const REPORT_MESSAGE_MIN = 10;
export const REPORT_MESSAGE_MAX = 1000;
/** Maximum request body size in bytes. */
export const REPORT_MAX_BYTES = 4096;
/** Reports allowed per IP per window. */
export const REPORT_RATE_LIMIT = 5;
export const REPORT_RATE_WINDOW_MS = 60_000;

export const REPORT_NOT_STORED_MESSAGE =
  'Thanks. Reports are stored once the database is connected; you can also open a GitHub issue.';
export const REPORT_STORED_MESSAGE = 'Thanks. Your report was saved and will be checked against the official page.';

export const REPORT_ERRORS = {
  tooLarge: `Your report is too long. Please keep the message under ${REPORT_MESSAGE_MAX} characters.`,
  notJson: 'We could not read your report. Please try again.',
  badField: 'Please choose which fact is wrong.',
  badProgram: 'We could not find this program. Please reload the page and try again.',
  tooShort: `Please write at least ${REPORT_MESSAGE_MIN} characters about what is wrong.`,
  tooLong: `Please keep your message under ${REPORT_MESSAGE_MAX} characters.`,
  rateLimited: 'You have sent several reports in a short time. Please wait a minute and try again.',
  storeFailed: 'We could not save your report right now. Please try again later.',
  offline: 'Could not send. Check your internet connection and try again.',
} as const;
