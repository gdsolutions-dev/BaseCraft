import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { ControlDef } from '../../../shared/design/model';
import { SubformCtl } from './SubformCtl';

vi.mock('../FormRunView', () => ({ EmbeddedForm: () => createElement('div', { className: 'embedded-form' }) }));
import type { RunCtx } from './run-ctx';

// E6c: a row of the print-all block holds a static subform frame: no embedded form, no registration on the live subform.
const sub = { records: {}, ancestors: ['FMaitre'], readOnly: false, active: true, region: 'en-US', root: { current: null }, register: vi.fn(), filterOf: vi.fn(), dirtyOf: vi.fn() };
const c = { kind: 'subform', name: 'Sous', props: { SourceObject: 'FSous' }, children: [] } as unknown as ControlDef;
const render = (print: boolean) => renderToStaticMarkup(createElement(SubformCtl, {
  c, style: { width: 100, height: 50 },
  x: { sub, print, snap: { busy: false, values: [], status: 'ready' }, info: undefined, stops: new Set(), id: (n: string) => `v-${n}`, t: (k: string) => k } as unknown as RunCtx,
}));

it('a print row renders the subform as an empty frame: nothing mounted, nothing registered', () => {
  const html = render(true);
  expect(html).toContain('data-ctl="Sous"');
  expect(html).not.toContain('frun-subform-error');
  expect(html).not.toContain('embedded-form');
  expect(sub.register).not.toHaveBeenCalled();
});

it('a live row mounts the embedded form (the control of the test above)', () => {
  expect(render(false)).toContain('embedded-form');
});
