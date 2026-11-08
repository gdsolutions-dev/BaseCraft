import { describe, expect, it } from 'vitest';
import { objectPosition, pictureCss, readPictureSpec, type PictureAlignment, type PictureSizeMode } from './picture-css';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const spec = (o: Partial<{ sizeMode: PictureSizeMode; alignment: PictureAlignment; tiling: boolean }> = {}) => ({ src: PNG, sizeMode: 'clip' as const, alignment: 'center' as const, tiling: false, ...o });

describe('pictureCss', () => {
  it.each([['clip', 'auto'], ['stretch', '100% 100%'], ['zoom', 'contain'], ['stretchH', '100% auto'], ['stretchV', 'auto 100%']] as const)('taille %s', (m, css) => {
    expect(pictureCss(spec({ sizeMode: m })).backgroundSize).toBe(css);
  });
  it.each([['topLeft', 'left top'], ['topRight', 'right top'], ['center', 'center'], ['formCenter', 'center'], ['bottomLeft', 'left bottom'], ['bottomRight', 'right bottom']] as const)('alignement %s', (a, css) => {
    expect(pictureCss(spec({ alignment: a })).backgroundPosition).toBe(css);
  });
  it('sans mosaïque : no-repeat et l\'image entre guillemets', () => {
    const c = pictureCss(spec({ sizeMode: 'zoom' }));
    expect(c.backgroundRepeat).toBe('no-repeat');
    expect(c.backgroundImage).toBe(`url("${PNG}")`);
  });
  it('la mosaïque force repeat et la taille auto', () => {
    const c = pictureCss(spec({ tiling: true, sizeMode: 'stretch' }));
    expect([c.backgroundRepeat, c.backgroundSize]).toEqual(['repeat', 'auto']);
  });
  it('une source hostile n\'atteint jamais le CSS', () => {
    const c = pictureCss({ ...spec(), src: 'data:image/png;base64,AAA");background:url(x' });
    expect(c.backgroundImage).toBe('none');
  });
});

describe('readPictureSpec', () => {
  it('une valeur d\'énumération inconnue donne les défauts', () => {
    expect(readPictureSpec({ Picture: PNG, PictureSizeMode: 'weird', PictureAlignment: 'nope' }, {})).toEqual(spec());
  });
  it('lit la mosaïque et l\'image partagée', () => {
    expect(readPictureSpec({ PictureType: 'shared', Picture: 'Motif', PictureTiling: true }, { Motif: PNG })).toEqual(spec({ tiling: true }));
  });
  it('un chemin lié, une image absente ou une URL SVG : rien', () => {
    expect(readPictureSpec({ PictureType: 'linked', Picture: 'C:\a.png' }, {})).toBeUndefined();
    expect(readPictureSpec({ PictureType: 'shared', Picture: 'Absent' }, {})).toBeUndefined();
    expect(readPictureSpec({ Picture: 'data:image/svg+xml;base64,PHN2Zz4=' }, {})).toBeUndefined();
  });
  it('un ancien PNG stocké en data:image/jpeg garde son fond', () => {
    expect(readPictureSpec({ Picture: 'data:image/jpeg;base64,iVBORw0KGgo=' }, {})).toBeDefined();
  });
});

describe('objectPosition', () => {
  it.each([['topLeft', 'left top'], ['topRight', 'right top'], ['center', 'center'], ['formCenter', 'center'], ['bottomLeft', 'left bottom'], ['bottomRight', 'right bottom']] as const)('%s', (a, css) => {
    expect(objectPosition(a)).toBe(css);
  });
});
