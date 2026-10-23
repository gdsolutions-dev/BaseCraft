// End message of Compact and Repair (A6): sizes in the interface language, at most 10 problems listed.
import type { CompactResult } from '../../shared/api';

export const MAX_PROBLEMS = 10;

export function formatSize(bytes: number, lang: string): string {
  const mb = bytes >= 1024 ** 2;
  return new Intl.NumberFormat(lang, { style: 'unit', unit: mb ? 'megabyte' : 'kilobyte', maximumFractionDigits: mb ? 1 : 0 })
    .format(bytes / (mb ? 1024 ** 2 : 1024));
}

/** The modal's message key and params; `more` turns the count of problems left out into text ("… and 3 more"). */
export function compactMessage(r: CompactResult, lang: string, more: (count: number) => string): { messageKey: string; params: Record<string, unknown> } {
  const list = (all: string[]) => [...all.slice(0, MAX_PROBLEMS), ...(all.length > MAX_PROBLEMS ? [more(all.length - MAX_PROBLEMS)] : [])].join('\n');
  if (!r.ok) return { messageKey: 'compact.corrupt', params: { problems: list(r.problems), backup: r.backupPath } };
  const params = { before: formatSize(r.sizeBefore, lang), after: formatSize(r.sizeAfter, lang), backup: r.backupPath };
  if (!r.repaired.length) return { messageKey: 'compact.done', params };
  return { messageKey: 'compact.repaired', params: { ...params, count: r.repaired.length, problems: list(r.repaired) } };
}
