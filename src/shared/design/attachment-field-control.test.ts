import { describe, expect, it } from 'vitest';
import { defaultProps } from '../field-types';
import { boundControlWithLabel } from './field-controls';

describe('a field dragged from the Field List', () => {
  it('an Attachment field is an Attachment control in a report as in a form', () => {
    const doc = { formatVersion: '1.0' as const, recordSource: null, props: {}, sections: [{ kind: 'detail' as const, height: 1000, props: {}, controls: [] }] };
    const f = { name: 'Pieces', type: 'attachment' as const, props: defaultProps('attachment') };
    for (const objectKind of ['form', 'report'] as const) {
      expect(boundControlWithLabel(doc, f, { section: 0, left: 0, top: 0 }, { objectKind, labelSuffix: 'Label' })[0]).toMatchObject({ kind: 'attachment', props: { ControlSource: 'Pieces' } });
    }
  });
});
