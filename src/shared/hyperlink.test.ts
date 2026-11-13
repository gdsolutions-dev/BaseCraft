import { describe, expect, it } from 'vitest';
import { safeUrl } from './hyperlink';

describe('safeUrl', () => {
  it('accepts http, https and mailto links', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('  HTTP://Example.com  ')).toBe('http://example.com/');
    expect(safeUrl('mailto:ana@example.com')).toBe('mailto:ana@example.com');
  });
  it('refuses every other scheme, and what is not a URL', () => {
    for (const bad of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'smb://host/share', 'ms-msdt:/id x',
      'C:\\Windows\\notepad.exe', '\\\\host\\share', 'www.example.com', 'example.com', '', '   ', 'https://', 'https://user:pw@example.com', 'https://a.com/\nx',
      'https://a.com/' + 'x'.repeat(2100)]) expect(safeUrl(bad), bad).toBeNull();
    for (const bad of [null, undefined, 3, {}, ['https://a.com']]) expect(safeUrl(bad)).toBeNull();
  });
});
