import { describe, expect, it } from 'vitest';
import { mailDraft, mailtoUrl } from './mailto';

const m = (o: Partial<Parameters<typeof mailtoUrl>[0]> = {}) => ({ to: '', cc: '', bcc: '', subject: '', body: '', ...o });

describe('mailtoUrl', () => {
  it('leaves empty fields out', () => {
    expect(mailtoUrl(m())).toBe('mailto:');
    expect(mailtoUrl(m({ subject: 'Hi' }))).toBe('mailto:?subject=Hi');
    expect(mailtoUrl(m({ to: 'a@example.com', body: 'x' }))).toBe('mailto:a%40example.com?body=x');
  });
  it('trims and splits recipients on ; and , and joins them with commas', () => {
    expect(mailtoUrl(m({ to: ' a@example.com; b@example.com,c@example.com ;', cc: 'd@example.com', bcc: 'e@example.com;f@example.com' })))
      .toBe('mailto:a%40example.com,b%40example.com,c%40example.com?cc=d%40example.com&bcc=e%40example.com,f%40example.com');
  });
  it('encodes & ? # % and accents in every component', () => {
    const u = new URL(mailtoUrl(m({ to: 'a@example.com', subject: 'Q&A? #1 100% café', body: 'a&b=c' })));
    expect(u.searchParams.get('subject')).toBe('Q&A? #1 100% café');
    expect(u.searchParams.get('body')).toBe('a&b=c');
    expect(mailtoUrl(m({ subject: '&?#%é' }))).toBe('mailto:?subject=%26%3F%23%25%C3%A9');
  });
  it('writes every kind of line break as %0D%0A', () => {
    expect(mailtoUrl(m({ body: 'a\nb\r\nc\rd' }))).toBe('mailto:?body=a%0D%0Ab%0D%0Ac%0D%0Ad');
  });
  it('an address holding ?subject= cannot inject a header', () => {
    const u = new URL(mailtoUrl(m({ to: 'a@example.com?subject=Evil&bcc=x@example.com', subject: 'Real' })));
    expect([...u.searchParams.keys()]).toEqual(['subject']);
    expect(u.searchParams.get('subject')).toBe('Real');
    expect(decodeURIComponent(u.pathname)).toBe('a@example.com?subject=Evil&bcc=x@example.com');
  });
  it('cuts the body to fit, never inside a percent-escape or a character', () => {
    for (const body of ['é'.repeat(3000), 'a\n'.repeat(3000), '😀'.repeat(2000), '%'.repeat(3000)]) {
      const url = mailtoUrl(m({ to: 'a@example.com', subject: 'S', body }));
      expect(url.length).toBeLessThanOrEqual(2000);
      expect(url.length).toBeGreaterThan(1900);
      const b = url.slice(url.indexOf('body=') + 5);
      expect(() => decodeURIComponent(b)).not.toThrow();
      expect(body.startsWith(decodeURIComponent(b).replace(/\r\n/g, '\n'))).toBe(true);
    }
    expect(mailtoUrl(m({ body: 'abcdef' }), 15)).toBe('mailto:?body=ab');
  });
  it('keeps a short body whole', () => {
    expect(mailtoUrl(m({ body: 'ok' }))).toBe('mailto:?body=ok');
  });
});

describe('mailDraft', () => {
  const ok = { to: 'a@example.com', cc: '', bcc: '', subject: 'S', body: 'a\r\nb\nc\td' };
  it('accepts five strings, line breaks only in the body', () => { expect(mailDraft(ok)).toEqual(ok); });
  it('refuses a missing field, a non-string, an object', () => {
    for (const bad of [null, 'x', { ...ok, to: undefined }, { ...ok, cc: 1 }, { to: '', cc: '', bcc: '', subject: '' }]) expect(() => mailDraft(bad)).toThrow('bc:invalidArgument');
  });
  it('refuses control characters: a line break in a header field, a NUL or a DEL in the body', () => {
    for (const bad of [{ ...ok, subject: 'a\nb' }, { ...ok, to: 'a\r' }, { ...ok, bcc: '\u0000' }, { ...ok, body: 'a\u0000b' }, { ...ok, body: '\u007f' }]) {
      expect(() => mailDraft(bad)).toThrow('bc:invalidArgument');
    }
  });
  it('refuses a field above its limit and accepts it at the limit', () => {
    for (const [k, n] of [['to', 2000], ['cc', 2000], ['bcc', 2000], ['subject', 500], ['body', 10000]] as const) {
      expect(() => mailDraft({ ...ok, [k]: 'x'.repeat(n) })).not.toThrow();
      expect(() => mailDraft({ ...ok, [k]: 'x'.repeat(n + 1) })).toThrow('bc:invalidArgument');
    }
  });
});
