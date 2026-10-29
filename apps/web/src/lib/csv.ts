/**
 * CSV cell escaping for exports whose cells can contain attacker-controlled text.
 *
 * Spreadsheet apps treat a cell beginning with `=`, `+`, `-`, `@`, TAB or CR as a formula (or a
 * separator), so an unauthenticated form field like `=HYPERLINK("http://evil",...)` runs when an
 * operator opens the export. OWASP's CSV-injection guidance is to prefix such cells with a single
 * quote; the quote makes the cell literal text, and the usual RFC-4180 quoting still applies.
 */

/** A cell is dangerous when its first non-whitespace character (or a leading TAB/CR) can start a
 *  formula. Leading whitespace is skipped so `"  =cmd"` cannot slip through. */
const FORMULA_PREFIX = /^[\s]*[=+\-@\t\r]/;

/** Prefix a formula-like value with `'` so a spreadsheet renders it as text. */
export function neutralizeCsvFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** One CSV cell: neutralize formulas, then quote and double embedded quotes (RFC 4180-ish). */
export function escapeCsvCell(value: string): string {
  return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`;
}

/** Build a full CSV document (trailing newline included) from rows of raw cell values. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
}
