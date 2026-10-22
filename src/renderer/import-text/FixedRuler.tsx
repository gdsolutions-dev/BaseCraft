// Largeur fixe : règle des colonnes et lignes du fichier. Clic sur la règle = nouvelle coupure, glisser = déplacer,
// double-clic = supprimer. Une liste de positions offre les mêmes actions au clavier.
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { addBreak, moveBreak, removeBreak } from './wizard-model';

const PAD = 8; // marge intérieure gauche de la zone, en pixels

export function FixedRuler({ lines, breaks, onChange }: { lines: string[]; breaks: number[]; onChange: (b: number[]) => void }) {
  const { t } = useTranslation();
  const probe = useRef<HTMLSpanElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(8);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [typed, setTyped] = useState('');
  useLayoutEffect(() => { if (probe.current) setCw(probe.current.getBoundingClientRect().width / 100 || 8); }, []);

  const width = Math.max(40, ...lines.map((l) => [...l].length)) + 10;
  const posAt = (clientX: number) => Math.round((clientX - area.current!.getBoundingClientRect().left - PAD) / cw);

  const down = (b: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: b, to: b });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag) setDrag({ ...drag, to: Math.max(1, Math.min(width, posAt(e.clientX))) }); };
  const up = () => { if (drag) { onChange(moveBreak(breaks, drag.from, drag.to)); setDrag(null); } };
  const shown = drag ? breaks.map((b) => (b === drag.from ? drag.to : b)) : breaks;

  const ticks = Array.from({ length: width + 1 }, (_x, i) => i);
  return (
    <div className="iw-fixed">
      <div className="iw-fixed-scroll">
      <div className="iw-fixed-area" ref={area} style={{ width: width * cw + PAD * 2 }}>
        <span ref={probe} className="iw-probe" aria-hidden>{'0'.repeat(100)}</span>
        <div className="iw-ruler" data-testid="import-ruler" title={t('importText.fixed.ruler')} aria-hidden
          onClick={(e) => onChange(addBreak(breaks, posAt(e.clientX)))}>
          {ticks.map((i) => (
            <span key={i} className={i % 10 === 0 ? 'iw-tick iw-tick-10' : i % 5 === 0 ? 'iw-tick iw-tick-5' : 'iw-tick'} style={{ left: PAD + i * cw }}>
              {i % 10 === 0 && i > 0 ? <em>{i}</em> : null}
            </span>
          ))}
        </div>
        <pre className="iw-fixed-lines" style={{ paddingLeft: PAD }}>{lines.join('\n')}</pre>
        {shown.map((b, i) => (
          <div key={breaks[i]} className="iw-break" style={{ left: PAD + b * cw - 4 }} data-testid={`import-break-${breaks[i]}`}
            onPointerDown={down(breaks[i])} onPointerMove={move} onPointerUp={up}
            onDoubleClick={(e) => { e.stopPropagation(); onChange(removeBreak(breaks, breaks[i])); }} />
        ))}
      </div>
      </div>
      <div className="iw-breaks" role="group" aria-label={t('importText.fixed.breaks')}>
        <span className="muted">{t('importText.fixed.breaks')}</span>
        {breaks.length === 0 && <span className="muted">{t('importText.fixed.none')}</span>}
        {breaks.map((b) => (
          <span key={b} className="iw-chip">
            {b}
            <button type="button" className="iconbtn" data-testid={`import-break-remove-${b}`} aria-label={t('importText.fixed.remove', { pos: b })}
              title={t('importText.fixed.remove', { pos: b })} onClick={() => onChange(removeBreak(breaks, b))}><X className="ic ic-sm" aria-hidden /></button>
          </span>
        ))}
        <input className="iw-input iw-input-sm" type="number" min={1} data-testid="import-break-input" aria-label={t('importText.fixed.breakAt')}
          value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="button" className="btn btn-sm" data-testid="import-break-add" disabled={!/^\d+$/.test(typed) || Number(typed) < 1}
          onClick={() => { onChange(addBreak(breaks, Number(typed))); setTyped(''); }}>{t('importText.fixed.add')}</button>
      </div>
    </div>
  );
}
