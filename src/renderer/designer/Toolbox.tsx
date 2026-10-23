// Boîte à outils : Sélectionner puis les outils de l'hôte. Un clic choisit un outil pour un dépôt, un double-clic le verrouille (comme Access) ;
// au clavier, un seul arrêt de tabulation, les flèches parcourent la grille (2 colonnes), Entrée sur l'outil déjà choisi le verrouille.
import { Lock, MousePointer2 } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolDef, ToolState } from './Designer';

const COLUMNS = 2;
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS };

export function Toolbox(p: { tools: ToolDef[]; tool: ToolState; onTool(t: ToolState): void; readOnly: boolean }) {
  const { t } = useTranslation();
  const items = [{ kind: null, icon: MousePointer2, labelKey: 'ribbon.cmd.select' }, ...p.tools];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  // l'arrêt de tabulation : le dernier outil qui a eu le focus, sinon l'outil choisi ; en lecture seule, Sélectionner (le seul actif)
  const stop = p.readOnly ? 0 : Math.min(focused ?? Math.max(0, items.findIndex((x) => x.kind === p.tool.kind)), items.length - 1);

  const keys = (e: KeyboardEvent) => {
    const from = buttons.current.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0) return;
    const usable = (i: number) => !!buttons.current[i] && !buttons.current[i]!.disabled;
    let to = -1;
    if (e.key === 'Home' || e.key === 'End') {
      const order = items.map((_, i) => i);
      to = (e.key === 'Home' ? order : order.reverse()).find(usable) ?? -1;
    } else if (STEPS[e.key]) {
      for (let i = from + STEPS[e.key]; i >= 0 && i < items.length; i += STEPS[e.key]) if (usable(i)) { to = i; break; }
    } else return;
    e.preventDefault();
    if (to >= 0) buttons.current[to]!.focus();
  };

  return (
    <div className="dz-toolbox" role="toolbar" aria-orientation="vertical" aria-label={t('designer.toolbox')} data-testid="toolbox" onKeyDown={keys}>
      {items.map(({ kind, icon: Icon, labelKey }, i) => {
        const on = p.tool.kind === kind;
        return (
          <button key={kind ?? 'select'} ref={(el) => { buttons.current[i] = el; }} type="button" className={`dz-tool${on ? ' is-on' : ''}`}
            data-testid={`tool-${kind ?? 'select'}`} title={t(labelKey)} aria-label={t(labelKey)} aria-pressed={on} disabled={p.readOnly && kind !== null}
            tabIndex={i === stop ? 0 : -1} onFocus={() => setFocused(i)}
            onClick={() => p.onTool({ kind, locked: false })} onDoubleClick={() => kind && p.onTool({ kind, locked: true })}
            onKeyDown={(e) => { if (e.key === 'Enter' && on && kind) { e.preventDefault(); p.onTool({ kind, locked: true }); } }}>
            <Icon size={16} aria-hidden />
            {on && p.tool.locked && <Lock className="dz-tool-lock" size={8} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
