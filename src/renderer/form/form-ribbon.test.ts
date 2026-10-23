import { describe, expect, it } from 'vitest';
import { validateDesignDoc } from '../../shared/design/model';
import { intersects } from '../designer/geometry';
import { emptyFormDoc, toggleHeaderFooter, type FormLabels } from './form-def';
import { GALLERY_TOOLS, headerItem } from './form-ribbon';

const labels: FormLabels = { prefix: (k) => ({ label: 'Étiquette', textBox: 'Texte', image: 'Image' } as Record<string, string>)[k] ?? k, tabPage: (n) => `Page${n}` };

describe('Form Design ribbon', () => {
  it('gallery commands map to the stage-A tools', () => {
    expect(GALLERY_TOOLS.select).toBeNull(); expect(GALLERY_TOOLS.button).toBe('commandButton');
    expect(GALLERY_TOOLS.insertPageBreak).toBe('pageBreak'); expect(Object.keys(GALLERY_TOOLS)).toHaveLength(15); expect(GALLERY_TOOLS.hyperlink).toBeUndefined();
  });
  it('header items show the Form Header and go there', () => {
    const d = headerItem(emptyFormDoc(null), 'title', { title: 'Clients', labels });
    expect(d.sections[0]).toMatchObject({ kind: 'formHeader', props: { Visible: true } }); expect(d.sections[0].height).toBeGreaterThanOrEqual(567);
    expect(d.sections[0].controls[0]).toMatchObject({ kind: 'label', props: { Caption: 'Clients', FontSize: 18 } });
    expect(headerItem(emptyFormDoc(null), 'dateTime', { title: 'Clients', labels }).sections[0].controls.map((c) => c.props.ControlSource)).toEqual(['=Date()', '=Time()']);
    expect(headerItem(emptyFormDoc(null), 'logo', { title: 'X', picture: 'data:image/png;base64,AA', labels }).sections[0].controls[0])
      .toMatchObject({ kind: 'image', props: { Picture: 'data:image/png;base64,AA', SizeMode: 'zoom' } });
  });
  it('names stay unique, the title follows the logo, the section holds them, the date and time at the right edge', () => {
    let d = headerItem(emptyFormDoc(null), 'logo', { title: 'X', picture: 'data:image/png;base64,AA', labels });
    d = headerItem(d, 'title', { title: 'Clients', labels });
    d = headerItem(d, 'title', { title: 'Clients', labels });
    d = headerItem(d, 'dateTime', { title: 'Clients', labels });
    const [logo, t1, t2, date, time] = d.sections[0].controls;
    expect([logo.name, t1.name, t2.name, date.name, time.name]).toEqual(['Image1', 'Étiquette1', 'Étiquette2', 'Texte1', 'Texte2']);
    expect(t1.left).toBeGreaterThanOrEqual(logo.left + logo.width);
    expect(d.sections[0].height).toBeGreaterThanOrEqual(Math.max(...d.sections[0].controls.map((c) => c.top + c.height)));
    expect(date.left + date.width).toBe(9072); expect(time.top).toBeGreaterThan(date.top);
    expect([date.props.Format, time.props.Format]).toEqual(['longDate', 'longTime']);
    expect(validateDesignDoc(d)).toEqual([]);
  });
  it('a logo added after the title (or the date) takes the first free place: no header control overlaps another', () => {
    const pic = { title: 'X', picture: 'data:image/png;base64,AA', labels };
    let d = headerItem(emptyFormDoc(null), 'title', { title: 'Clients', labels });
    d = headerItem(d, 'dateTime', { title: 'Clients', labels });
    d = headerItem(d, 'logo', pic);
    d = headerItem(d, 'logo', pic);
    const cs = d.sections[0].controls;
    for (const a of cs) for (const b of cs) if (a !== b) expect(intersects(a, b), `${a.name} / ${b.name}`).toBe(false);
    expect(cs[0].left).toBe(0);   // le titre reste où il était
  });
  it('an header already shown is kept as it is', () => {
    const shown = toggleHeaderFooter(emptyFormDoc(null));
    const d = headerItem(shown, 'title', { title: 'Clients', labels });
    expect(d.sections[2]).toBe(shown.sections[2]); expect(d.sections[1]).toBe(shown.sections[1]);
  });
});
