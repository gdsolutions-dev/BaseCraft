// Hauteur de ligne et Largeur de colonne (Accueil › Enregistrements › Plus) : une valeur saisie, ou la valeur standard cochée.
// OK rend la taille en px ; une saisie illisible ou hors bornes reste dans la boîte, marquée invalide. Annuler (ou Échap) : null.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function SizeBox({ label, standardLabel, text, standard, parse, fit, close }: {
  label: string; standardLabel: string; text: string; standard: string; parse(text: string): number | null; close(px: number | null): void;
  /** Largeur de colonne : le bouton Ajuster (la taille du contenu). */
  fit?: { label: string; px(): number };
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(text);
  const [bad, setBad] = useState(false);
  useEffect(() => { input.current?.select(); }, []);
  const ok = () => { const px = parse(value); if (px === null) setBad(true); else close(px); };
  return (
    <form className="size-box" onSubmit={(e) => { e.preventDefault(); ok(); }}>
      <label className="size-box-row">
        <span>{label}</span>
        <input ref={input} type="text" data-testid="size-box-value" aria-invalid={bad} value={value} onChange={(e) => { setValue(e.target.value); setBad(false); }} />
      </label>
      <label className="size-box-row">
        <input type="checkbox" data-testid="size-box-standard" checked={value === standard} onChange={(e) => { if (e.target.checked) { setValue(standard); setBad(false); } }} />
        <span>{standardLabel}</span>
      </label>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="size-box-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="size-box-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
        {fit && <button type="button" className="btn" data-testid="size-box-fit" onClick={() => close(fit.px())}>{fit.label}</button>}
      </div>
    </form>
  );
}

/** Afficher les champs : chaque champ, coché quand il est affiché ; OK rend les champs masqués. Un champ au moins reste affiché. */
export function UnhideBox({ fields, hidden, close }: { fields: { name: string; title: string }[]; hidden: ReadonlySet<string>; close(hidden: string[] | null): void }) {
  const { t } = useTranslation();
  const [off, setOff] = useState<ReadonlySet<string>>(hidden);
  const toggle = (name: string) => setOff((cur) => { const next = new Set(cur); if (!next.delete(name)) next.add(name); return next; });
  return (
    <form className="size-box" onSubmit={(e) => { e.preventDefault(); close([...off]); }}>
      <div className="unhide-list" role="group">
        {fields.map((f) => (
          <label key={f.name} className="size-box-row">
            <input type="checkbox" data-testid={`unhide-${f.name}`} checked={!off.has(f.name)} disabled={!off.has(f.name) && off.size >= fields.length - 1} onChange={() => toggle(f.name)} />
            <span>{f.title}</span>
          </label>
        ))}
      </div>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="unhide-ok">{t('dialog.button.ok')}</button>
        <button type="button" className="btn" data-testid="unhide-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}
