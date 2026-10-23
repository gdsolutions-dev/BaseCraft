// Sous-formulaire : le formulaire Objet source dans son cadre, dans son affichage par défaut, avec ses propres enregistrements
// filtrés par les champs pères/fils. Entrer dans le cadre enregistre d'abord l'enregistrement du père ; le quitter vers le père
// enregistre celui du sous-formulaire (refusé : le focus y reste). Ctrl+Tab en sort. Erreurs : objet introuvable, lien inconnu,
// formulaire récursif — un cadre avec le message, le père reste utilisable. Sans objet source : un cadre vide.
import { useMemo, useRef } from 'react';
import type { SqlValue } from '../../../shared/coerce';
import { sameName } from '../../../shared/field-types';
import { EmbeddedForm, type EmbedLink } from '../FormRunView';
import { masterValues, MAX_SUBFORM_DEPTH, splitFields } from '../links';
import { prop } from '../run-model';
import { tipOf, type CtlProps, type RunnerApi } from './run-ctx';

export function SubformCtl({ c, x, style }: CtlProps) {
  const sub = x.sub;
  const frame = useRef<HTMLDivElement>(null);
  const api = useRef<RunnerApi | null>(null);
  const wanted = useRef(false);   // entered while the master's record was being saved: its form takes the focus once read again
  const source = String(prop(c, 'SourceObject') ?? '').trim();
  const masterText = String(prop(c, 'LinkMasterFields') ?? ''), childText = String(prop(c, 'LinkChildFields') ?? '');
  const masterF = useMemo(() => splitFields(masterText), [masterText]);
  const childF = useMemo(() => splitFields(childText), [childText]);
  // the master's values; kept while it moves or reads again (its count is then 0 for a moment: never a passing null link)
  const shown = useRef<SqlValue[] | null>(null);
  if (!x.snap.busy) shown.current = masterF.length ? masterValues(masterF, x.snap) : null;
  const values = shown.current;
  const key = JSON.stringify(values);
  const embed = useMemo<EmbedLink | null>(() => (sub ? {
    master: sub.records, childFields: childF, values,
    register: (a) => { api.current = a; sub.register(c.name, a); },
    exit: (dir) => sub.exit(c.name, dir),
    focusWanted: () => { const w = wanted.current; wanted.current = false; return w; },
    filter: (has) => sub.filterOf(c.name, has),
    dirty: (sources) => sub.dirtyOf(c.name, sources),
    current: () => (masterF.length ? masterValues(masterF, sub.records.snapshot) : null),
  } : null), [sub?.records, masterF, childF, key, c.name]);   // eslint-disable-line react-hooks/exhaustive-deps -- the values by their text

  const info = x.info;
  let problem: 'missing' | 'recursive' | 'badLink' | null = null;
  if (!sub) problem = 'missing';
  else if (sub.ancestors.length >= MAX_SUBFORM_DEPTH || sub.ancestors.some((a) => sameName(a, source))) problem = 'recursive';
  else if (masterF.length !== childF.length || (masterF.length > 0 && x.snap.status === 'ready' && (!info || masterF.some((n) => !info.fields.some((f) => sameName(f.name, n)))))) problem = 'badLink';
  // no Source Object yet: an empty frame, as Access; the master's source being read: empty until it is
  const waiting = !problem && (!source || (masterF.length > 0 && !info));
  const locked = prop(c, 'Locked') === true || prop(c, 'Enabled') === false;

  const inFrame = (n: EventTarget | null) => n instanceof Node && !!frame.current?.contains(n);
  return (
    <div ref={frame} className="frun-subform" role="group" aria-label={c.name} id={x.id(c.name)} style={style} data-testid={`form-ctl-${c.name}`} data-ctl={c.name}
      tabIndex={problem || waiting ? undefined : x.stops.has(c.name) ? 0 : -1} aria-disabled={prop(c, 'Enabled') === false || undefined} {...tipOf(c)}
      onFocus={(e) => {
        if (!sub || problem) return;
        sub.focusOf(c.name);
        if (!inFrame(e.relatedTarget)) {
          const m = sub.records.snapshot;
          wanted.current = m.isNew && m.dirty;   // only a new master changes the subform's rows under the focus
          void sub.enter(c.name).then((ok) => { if (!ok) wanted.current = false; });
        }
        if (e.target === frame.current) api.current?.focusIn();   // the frame itself (the master's Tab): its form's control
      }}
      onBlur={(e) => {
        // toward the master only: never into a cell editor, a message box or the ribbon
        const to = e.relatedTarget;
        if (!(to instanceof Node) || inFrame(to) || !sub?.root.current?.contains(to)) return;
        void api.current?.save();
      }}
      onKeyDownCapture={(e) => {
        // Ctrl+Tab (Ctrl+Maj+Tab): out of the innermost subform, to the master's next (previous) control
        if (e.key !== 'Tab' || !e.ctrlKey || e.altKey || e.metaKey || !sub || (e.target as Element).closest('.frun-subform') !== frame.current) return;
        e.preventDefault();
        e.stopPropagation();
        sub.exit(c.name, e.shiftKey ? -1 : 1);
      }}>
      {problem
        ? <div className="frun-subform-error" role="alert" data-testid="form-subform-error">{x.t(`form.subform.${problem}`, { name: source })}</div>
        : !waiting && sub && embed && <EmbeddedForm name={source} sub={sub} embed={embed} readOnly={sub.readOnly || locked} />}
    </div>
  );
}
