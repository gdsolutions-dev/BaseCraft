import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RIBBON, commandEnabled, commandsVersion, runCommand, subscribeCommands,
  type RibbonCommand, type RibbonContext, type RibbonTab,
} from './ribbon-model';

const STACK = 3; // small buttons per column, as in the mockup

export function Ribbon({ ctx, onFile }: { ctx: RibbonContext; onFile: () => void }) {
  const { t } = useTranslation();
  useSyncExternalStore(subscribeCommands, commandsVersion); // re-render when the active document's commands change
  const tabs = RIBBON.filter((x) => !x.visible || x.visible(ctx));
  const [selected, setSelected] = useState<RibbonTab['id']>('home');
  // Entering Table Design brings its contextual tab forward, as in Access; leaving it falls back to Home.
  useEffect(() => { if (ctx.mode === 'design') setSelected('design'); }, [ctx.mode]);
  const current = tabs.find((x) => x.id === selected) ?? tabs[0];

  const button = (c: RibbonCommand) => {
    const label = t(c.labelKey);
    const Icon = c.icon;
    const on = c.active?.(ctx);
    return (
      <button key={c.id} data-testid={`cmd-${c.id}`} className={`rbtn-${c.size}${on ? ' is-on' : ''}`} title={label}
        aria-pressed={c.active ? !!on : undefined} disabled={!commandEnabled(c.id, ctx)}
        onClick={() => runCommand(c.id)}>
        <Icon className={c.size === 'lg' ? 'ic ic-lg' : 'ic'} aria-hidden />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <header className="ribbon" aria-label={t('ribbon.label')}>
      <nav className="rtabs" role="tablist">
        <button className="rtab rtab-file" data-testid="ribbon-tab-file" onClick={onFile}>{t('ribbon.file')}</button>
        {tabs.map((x, i) => (
          <Fragment key={x.id}>
            {x.contextual && i > 0 && !tabs[i - 1].contextual && <span className="rtab-sep" aria-hidden />}
            <button role="tab" aria-selected={x === current} data-testid={`ribbon-tab-${x.id}`}
              className={`rtab${x.contextual ? ' rtab-ctx' : ''}${x === current ? ' is-active' : ''}`}
              onClick={() => setSelected(x.id)}>{t(x.labelKey)}</button>
          </Fragment>
        ))}
      </nav>
      <div className="rbody" role="tabpanel">
        {current.groups.map((g) => {
          // large buttons alone, consecutive small ones stacked in columns
          const items: (RibbonCommand | RibbonCommand[])[] = [];
          for (const c of g.commands) {
            const last = items[items.length - 1];
            if (c.size === 'lg') items.push(c);
            else if (Array.isArray(last) && last.length < STACK) last.push(c);
            else items.push([c]);
          }
          return (
            <div key={g.labelKey} className="rgroup" role="group" aria-label={t(g.labelKey)}>
              <div className="ritems">
                {items.map((it, i) => (Array.isArray(it) ? <div key={i} className="rstack">{it.map(button)}</div> : button(it)))}
              </div>
              <div className="rlabel" aria-hidden>{t(g.labelKey)}</div>
            </div>
          );
        })}
      </div>
    </header>
  );
}
