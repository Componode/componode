/**
 * Escapes a string for use inside a Markdown table cell.
 * Backslashes MUST be escaped before pipes — escaping `|` first would
 * turn a literal `\` into `\|`-forming sequences and leave the escape
 * order ambiguous (CodeQL js/incomplete-sanitization).
 */
export function mdCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
