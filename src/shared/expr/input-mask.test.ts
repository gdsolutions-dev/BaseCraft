import { describe, expect, it } from 'vitest';
import { applyMask, checkMasked, MaskSyntaxError, maskFills, parseMask, renderMask, skipToLiteral } from './input-mask';

describe('input mask (brief)', () => {
  it('phone mask', () => {
    const m = parseMask('00\\ 00\\ 00\\ 00\\ 00;0;_');
    expect(applyMask(m, '0612')).toEqual({ display: '06 12 __ __ __', complete: false });
    expect(checkMasked(m, '06 12 34 56 78')).toEqual({ ok: true, stored: '06 12 34 56 78' });
    expect(checkMasked(m, '06 12 34')).toEqual({ ok: false });
  });
  it('literals not stored', () => expect(checkMasked(parseMask('00/00/0000'), '21/10/2026')).toEqual({ ok: true, stored: '21102026' }));
  it('case and letters', () => expect(checkMasked(parseMask('>LL0'), 'ab1')).toEqual({ ok: true, stored: 'AB1' }));
});

describe('input mask (extra)', () => {
  it('parses slots, sections and quoted literals', () => {
    const m = parseMask('"FR-"<L>L9;0;*');
    expect(m.storeLiterals).toBe(true);
    expect(m.placeholder).toBe('*');
    expect(m.slots).toEqual([
      { kind: 'literal', ch: 'F' }, { kind: 'literal', ch: 'R' }, { kind: 'literal', ch: '-' },
      { kind: 'input', accept: 'letter', required: true, caseRule: 'lower' },
      { kind: 'input', accept: 'letter', required: true, caseRule: 'upper' },
      { kind: 'input', accept: 'digit', required: false, caseRule: 'upper' },
    ]);
    expect(parseMask('0').storeLiterals).toBe(false);
    expect(parseMask('0;1').storeLiterals).toBe(false);
    expect(parseMask('0').placeholder).toBe('_');
    expect(parseMask('0;;').placeholder).toBe('_');
    expect(parseMask('0\\;0').slots).toHaveLength(3); // escaped ; is a literal, not a section
    expect(parseMask('(999)').slots[0]).toEqual({ kind: 'literal', ch: '(' }); // any other character is a literal
    expect(parseMask('<>L').slots[0]).toEqual({ kind: 'input', accept: 'letter', required: true, caseRule: 'none' });
  });
  it.each([['"ab', 'maskUnclosedQuote'], ['00\\', 'maskTrailingBackslash'], ['--', 'maskNoInput'], ['', 'maskNoInput'], ['0;2', 'maskBadSection'], ['0;0;ab', 'maskBadSection']])(
    'refuses %j (%s)', (text, code) => {
      expect(() => parseMask(text)).toThrow(MaskSyntaxError);
      try { parseMask(text); } catch (e) { expect((e as MaskSyntaxError).code).toBe(code); }
    });
  it('accept classes', () => {
    expect(checkMasked(parseMask('#'), '+').ok).toBe(true);
    expect(checkMasked(parseMask('0'), 'a').ok).toBe(false);
    expect(checkMasked(parseMask('L'), 'é')).toEqual({ ok: true, stored: 'é' });
    expect(checkMasked(parseMask('L'), '1').ok).toBe(false);
    expect(checkMasked(parseMask('A'), '5').ok).toBe(true);
    expect(checkMasked(parseMask('A'), '-').ok).toBe(false);
    expect(checkMasked(parseMask('&'), '-').ok).toBe(true);
  });
  it('optional slots may stay empty; required ones may not', () => {
    expect(checkMasked(parseMask('(999) 000;0'), '() 123')).toEqual({ ok: true, stored: '(   ) 123' }); // empty optional: a space (A2-R11)
    expect(checkMasked(parseMask('(999) 000;0'), '(___) 123')).toEqual({ ok: true, stored: '(   ) 123' });
    expect(checkMasked(parseMask('0009'), '123')).toEqual({ ok: true, stored: '123 ' });
    expect(checkMasked(parseMask('0009'), '12')).toEqual({ ok: false });
    expect(checkMasked(parseMask('00'), '123')).toEqual({ ok: false }); // left over
  });
  it('accepts the value with or without its literals (stored without, or legacy)', () => {
    const m = parseMask('00/00/0000');
    expect(checkMasked(m, '21102026')).toEqual({ ok: true, stored: '21102026' });
    expect(checkMasked(parseMask('00/00/0000;0'), '21102026')).toEqual({ ok: true, stored: '21/10/2026' });
  });
  it('applyMask fills slots positionally and drops what does not fit', () => {
    const m = parseMask('>LL-00');
    expect(applyMask(m, 'ab1x2')).toEqual({ display: 'AB-12', complete: true });
    expect(applyMask(m, '')).toEqual({ display: '__-__', complete: false });
    expect(applyMask(parseMask('00/00/0000'), '21/10')).toEqual({ display: '21/10/____', complete: false });
  });
  it('maskFills gives each input slot its character, as far as the value fits (editor prefill)', () => {
    const m = parseMask('00\\ 00\\ 00\\ 00\\ 00;0;_');
    expect(maskFills(m, '06 12 34 56 78').join('')).toBe('0612345678');
    expect(maskFills(m, '06 12 __ __ __')).toEqual(['0', '6', '1', '2', '', '', '', '', '', '']);
    expect(maskFills(m, '0612abc34').join('')).toBe('061234');
    expect(maskFills(parseMask('>LL'), 'abc')).toEqual(['A', 'B']);
    expect(maskFills(parseMask('(999) 000'), '() 123')).toEqual(['', '', '', '1', '2', '3']);
    expect(renderMask(parseMask('(999) 000'), ['', '', '', '1', '2', '3'])).toBe('(___) 123');
  });
});

describe('input mask (fix round 1)', () => {
  /** Stored by the write layer, shown (through the mask), prefilled in the editor, committed again: the same value. */
  const roundTrip = (maskText: string, typed: string, stored: string, shown: string) => {
    const m = parseMask(maskText);
    expect(checkMasked(m, typed)).toEqual({ ok: true, stored });
    expect(checkMasked({ ...m, storeLiterals: true }, stored)).toEqual({ ok: true, stored: shown });
    const edited = renderMask(m, maskFills(m, stored));
    expect(checkMasked(m, edited)).toEqual({ ok: true, stored });
  };
  it('A2-R11: an empty optional slot is stored as a space, so positions survive without literals', () => {
    roundTrip('99-00', '1-23', '1 23', '1 -23');
    roundTrip('99-00', '1_-23', '1 23', '1 -23');
    roundTrip('00\ 00\ 00\ 00\ 00;0;_', '06 12 34 56 78', '06 12 34 56 78', '06 12 34 56 78');
    roundTrip('00\ 00\ 00\ 00\ 00', '0612345678', '0612345678', '06 12 34 56 78');
    expect(checkMasked(parseMask('99-00'), '1 23')).toEqual({ ok: true, stored: '1 23' });
  });
  it('an optional slot takes a space (9 is digit or space); a required one does not', () => {
    expect(checkMasked(parseMask('999'), '1 2')).toEqual({ ok: true, stored: '1 2' });
    expect(checkMasked(parseMask('?L'), ' a')).toEqual({ ok: true, stored: ' a' });
    expect(checkMasked(parseMask('000'), '1 2')).toEqual({ ok: false });
  });
  it('ß with > stays one character (never SS)', () => {
    expect(checkMasked(parseMask('>LL'), 'ßa')).toEqual({ ok: true, stored: 'ßA' });
    expect(applyMask(parseMask('>LL'), 'ß').display).toBe('ß_');
  });
  it('typing the literal of a later position skips the optional slots before it', () => {
    const m = parseMask('99-00');
    expect(skipToLiteral(m, 1, '-')).toBe(2); // after « 1 », « - » goes to the first 0
    expect(skipToLiteral(m, 0, '-')).toBe(2);
    expect(skipToLiteral(m, 2, '-')).toBeNull(); // already past it
    expect(skipToLiteral(parseMask('00-00'), 1, '-')).toBeNull(); // a required slot is not skipped
    expect(skipToLiteral(m, 1, '/')).toBeNull();
  });
});
