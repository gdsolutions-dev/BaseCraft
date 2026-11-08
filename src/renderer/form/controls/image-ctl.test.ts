import { describe, expect, it } from 'vitest';
import { imageSource, tiledStyle } from './ImageCtl';
import type { CtlProps } from './run-ctx';

const png = 'data:image/png;base64,iVBORw0KGgo=';
describe('imageSource', () => {
  it('incorporée : la donnée elle-même ; partagée : la galerie ; sinon undefined', () => {
    expect(imageSource({ Picture: png }, {})).toBe(png);
    expect(imageSource({ PictureType: 'shared', Picture: 'logo' }, { logo: png })).toBe(png);
    expect(imageSource({ PictureType: 'shared', Picture: 'logo' }, {})).toBeUndefined();
    expect(imageSource({ Picture: 'x' }, {})).toBeUndefined();
  });
});

describe('tiledStyle', () => {
  const c = (props: Record<string, unknown>) => ({ props }) as unknown as CtlProps['c'];
  it('mosaïque : fond répété à la taille naturelle ; sinon null ; svg refusé', () => {
    const t = tiledStyle(c({ PictureTiling: true }), png);
    expect(t?.backgroundRepeat).toBe('repeat'); expect(t?.backgroundSize).toBe('auto');
    expect(tiledStyle(c({}), png)).toBeNull();
    expect(tiledStyle(c({ PictureTiling: 'true' }), png)).toBeNull();
    expect(tiledStyle(c({ PictureTiling: true }), 'data:image/svg+xml;base64,AA==')?.backgroundImage).toBe('none');
  });
});
