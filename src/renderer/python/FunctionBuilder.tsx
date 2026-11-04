// R11: the function builder. Lists every exported function of the saved modules as `Module.fn(params)`; OK rounds `=fn()` or
// `=fn([p1]; [p2])` (parameter names as bracketed references, in the display separator), to be read back by the Property Sheet.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listFunctions, type FunctionRef } from './function-index';

export function FunctionBuilder({ sep, close }: { sep: string; close(text: string | null): void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<FunctionRef[] | null>(null);
  const [pick, setPick] = useState<FunctionRef | null>(null);
  useEffect(() => { listFunctions().then(setList, () => setList([])); }, []);
  const done = (f: FunctionRef) => close(`=${f.fn}(${f.params.filter((p) => !p.startsWith('*')).map((p) => `[${p}]`).join(`${sep} `)})`);
  return (
    <div className="xb">
      {list?.length === 0 && <p className="muted" data-testid="fn-empty">{t('builder.function.empty')}</p>}
      <ul role="listbox" aria-label={t('builder.function.title')} style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflow: 'auto' }}>
        {list?.map((f) => {
          const id = `${f.module}.${f.fn}`;
          return (
            <li key={id} role="option" aria-selected={pick === f}>
              <button type="button" className={`btn${pick === f ? ' btn-primary' : ''}`} style={{ width: '100%', textAlign: 'left' }} data-testid={`fn-item-${id}`}
                onClick={() => setPick(f)} onDoubleClick={() => done(f)}>
                {id}({f.params.join(', ')})
              </button>
            </li>
          );
        })}
      </ul>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="fn-ok" disabled={!pick} onClick={() => pick && done(pick)}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="fn-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
