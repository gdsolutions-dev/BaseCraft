import { describe, expect, it } from 'vitest';
import type { ControlDef } from '../../shared/design/model';
import { armedTool, browseName, galleryItems, withToolProps } from './image-gallery-model';

const ctl = (name: string, props = {}): ControlDef => ({ kind: 'image', name, left: 0, top: 0, width: 10, height: 10, props });

describe('image gallery model', () => {
  it('sorts items case-insensitively', () => {
    expect(galleryItems([{ name: 'b', type: 'png', bytes: 1 }, { name: 'A', type: 'gif', bytes: 2 }, { name: 'a2', type: 'png', bytes: 3 }]).map((i) => i.name)).toEqual(['A', 'a2', 'b']);
  });
  it('armedTool arms the image tool with the shared picture', () => {
    expect(armedTool('Logo')).toEqual({ kind: 'image', locked: false, props: { PictureType: 'shared', Picture: 'Logo' } });
  });
  it('withToolProps merges into the first control only', () => {
    const list = [ctl('Image1', { A: 1 }), ctl('Etiquette1')];
    const out = withToolProps(list, { Picture: 'x' });
    expect(out[0]!.props).toEqual({ A: 1, Picture: 'x' });
    expect(out[1]).toBe(list[1]);
    expect(list[0]!.props).toEqual({ A: 1 });
    expect(withToolProps(list)).toBe(list);
  });
  it('browseName', () => {
    expect(browseName({ name: 'Logo société.png', size: 10 })).toEqual({ ok: true, name: 'Logo société' });
    expect(browseName({ name: 'a.png', size: 1048577 })).toEqual({ ok: false, reason: 'tooLarge' });
    expect(browseName({ name: 'a.png', size: 1048576 })).toEqual({ ok: true, name: 'a' });
    expect(browseName({ name: '.png', size: 1 })).toEqual({ ok: false, reason: 'badName' });
  });
});
