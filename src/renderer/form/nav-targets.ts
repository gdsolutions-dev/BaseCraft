// A navigation control's tabs (D4): its NavigationTargets property, one line per tab, `Caption|form:Name` or `Caption|report:Name`.
export interface NavTarget { caption: string; kind: 'form' | 'report'; name: string }

/** The tabs of a NavigationTargets value (a list of lines). A line without `|` is its target alone (the caption is the object's name); a line
 *  that names neither `form:` nor `report:`, or no object, is dropped. */
export function parseTargets(v: unknown): NavTarget[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((line): NavTarget[] => {
    if (typeof line !== 'string') return [];
    const bar = line.lastIndexOf('|');
    const spec = (bar < 0 ? line : line.slice(bar + 1)).trim();
    const m = /^(form|report):(.+)$/i.exec(spec);
    const name = m?.[2].trim();
    if (!m || !name) return [];
    return [{ caption: (bar < 0 ? '' : line.slice(0, bar).trim()) || name, kind: m[1].toLowerCase() as NavTarget['kind'], name }];
  });
}
