import { describe, expect, it } from 'vitest';
import { texts } from '../renderer/datasheet/datasheet-cells';
import { coerce } from './coerce';
import { defaultProps, type FieldDef } from './field-types';
import { localeInfo } from './locale-format';
import { decodeEntities, richToPlain, sanitizeRich } from './rich-text';

describe('sanitizeRich', () => {
  it('keeps the subset the editor writes', () => {
    const html = '<div>a <b>bold</b> <i>it</i> <u>un</u></div><ul><li>one</li><li>two</li></ul><ol><li>x</li></ol>'
      + '<div dir="rtl">r</div><font color="#ff0000">red</font><span style="background-color: rgb(255, 255, 0);">hl</span>'
      + '<blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;">in</blockquote>';
    expect(sanitizeRich(html)).toBe('<div>a <b>bold</b> <i>it</i> <u>un</u></div><ul><li>one</li><li>two</li></ul><ol><li>x</li></ol>'
      + '<div dir="rtl">r</div><font color="#ff0000">red</font><span style="background-color:rgb(255, 255, 0)">hl</span>'
      + '<blockquote style="margin-left:40px">in</blockquote>');
  });
  it('drops scripts with their code, comments and other embedded documents', () => {
    expect(sanitizeRich('a<script>alert(1)</script>b')).toBe('ab');
    expect(sanitizeRich('a<SCRIPT src=x></SCRIPT >b')).toBe('ab');
    expect(sanitizeRich('a<script>alert(1)')).toBe('a');   // never closed: the rest is code
    expect(sanitizeRich('a<!-- <b>x</b> -->b<!doctype html><?xml ?>')).toBe('ab');
    expect(sanitizeRich('<iframe src="javascript:alert(1)">t</iframe><object data=x>o</object><style>*{}</style>z')).toBe('z');
  });
  it('drops event handlers, URLs and unknown tags (their text stays)', () => {
    expect(sanitizeRich('<img src=x onerror=alert(1)>t')).toBe('t');
    expect(sanitizeRich('<a href="javascript:alert(1)">link</a>')).toBe('link');
    expect(sanitizeRich('<b onclick="alert(1)" onmouseover=alert(2)>x</b>')).toBe('<b>x</b>');
    expect(sanitizeRich('<div onclick="alert(1)" class="c" id="i" style="color:red" data-x=1>x</div>')).toBe('<div style="color:red">x</div>');
    expect(sanitizeRich('<svg onload=alert(1)><circle/></svg>x')).toBe('x');
    expect(sanitizeRich('<custom-tag>a</custom-tag><blink>b</blink>')).toBe('ab');
  });
  it('keeps only the allowed style declarations and values', () => {
    expect(sanitizeRich('<span style="color:red;position:fixed;top:0;background:url(javascript:alert(1))">x</span>')).toBe('<span style="color:red">x</span>');
    expect(sanitizeRich('<span style="color:expression(alert(1))">x</span>')).toBe('<span>x</span>');
    expect(sanitizeRich('<span style="background-color:url(x)">x</span>')).toBe('<span>x</span>');
    expect(sanitizeRich('<div style="text-align:center;margin-left:2em;font-size:99px">x</div>')).toBe('<div style="text-align:center;margin-left:2em">x</div>');
    expect(sanitizeRich('<span style="color:red&#59;position:fixed">x</span>')).toBe('<span style="color:red">x</span>');   // the entity is decoded before checking
    expect(sanitizeRich('<font color="red;x" size=7>x</font>')).toBe('<font>x</font>');
    expect(sanitizeRich('<b style="color:red;font-size:99px">x</b>')).toBe('<b style="color:red">x</b>');
    expect(sanitizeRich('<br style="color:red" onclick=x>')).toBe('<br>');
    expect(sanitizeRich('<div dir="evil">x</div>')).toBe('<div>x</div>');
  });
  it('escapes the text and the attribute values: nothing breaks out', () => {
    expect(sanitizeRich('1 < 2 && 3 > 2')).toBe('1 &lt; 2 &amp;&amp; 3 &gt; 2');
    expect(sanitizeRich('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeRich('&#60;script&#62;')).toBe('&lt;script&gt;');
    expect(sanitizeRich('<div title="a>b" onclick=x>t</div>')).toBe('<div>t</div>');
    expect(sanitizeRich('<div <script>alert(1)</script>>t</div>')).not.toContain('<script');
    expect(sanitizeRich('<div style="color:red" style="x">t</div>')).toBe('<div style="color:red">t</div>');
  });
  it('balances the tags', () => {
    expect(sanitizeRich('<b><i>x</b>y')).toBe('<b><i>x</i></b>y');
    expect(sanitizeRich('x</div></b>y')).toBe('xy');
    expect(sanitizeRich('<ul><li>a<li>b')).toBe('<ul><li>a<li>b</li></li></ul>');
    expect(sanitizeRich('<br/>a<br>b</br>')).toBe('<br>a<br>b');
  });
  it('is idempotent and safe on the empty and the odd', () => {
    const once = sanitizeRich('<div style="margin: 0 0 0 40px" onclick=x><b>a</b> &amp; &nbsp;<script>x</script></div>');
    expect(sanitizeRich(once)).toBe(once);
    expect(sanitizeRich('')).toBe('');
    expect(sanitizeRich('a\u0000b\u0007c')).toBe('abc');
    expect(sanitizeRich('<')).toBe('&lt;');
    expect(sanitizeRich('<div')).toBe('&lt;div');
  });
});

describe('richToPlain', () => {
  it('strips the tags, decodes the entities, one line per block', () => {
    expect(richToPlain('<div>a &amp; b</div><div><b>c</b>&lt;d&gt;</div>')).toBe('a & b\nc<d>');
    expect(richToPlain('a<br>b')).toBe('a\nb');
    expect(richToPlain('<div>a</div>\n<div>b</div>')).toBe('a\nb');
  });
  it('marks the list items', () => {
    expect(richToPlain('<ul><li>one</li><li>two</li></ul><ol><li>x</li><li>y</li></ol>')).toBe('• one\n• two\n1. x\n2. y');
  });
  it('shows no script and no markup of a hostile value', () => {
    expect(richToPlain('<img src=x onerror=alert(1)>hi<script>alert(1)</script>')).toBe('hi');
    expect(richToPlain('')).toBe('');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities, refusing invalid code points', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&#39;&#x41;&nbsp;')).toBe('&<>"\'A ');
    expect(decodeEntities('&#0;&#1114112;&#xD800;')).toBe('���');
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
  });
});

describe('writes and display of a Rich Text field', () => {
  const rich: FieldDef = { name: 'N', props: { ...defaultProps('longText'), textFormat: 'rich' } };
  const plain: FieldDef = { name: 'N', props: defaultProps('longText') };
  const loc = localeInfo('en-US');
  it('coerce sanitizes a Rich Text write, and only that', () => {
    expect(coerce(rich, '<b onclick=x>a</b><script>x</script>', loc)).toEqual({ ok: true, value: '<b>a</b>' });
    expect(coerce(plain, '<b>a</b>', loc)).toEqual({ ok: true, value: '<b>a</b>' });
  });
  it('the datasheet shows the text of the value and edits its HTML', () => {
    expect(texts(rich, '<div>a &amp; <b>b</b></div><div>c</div>', { locale: 'en-US' })).toEqual(['a & b c', '<div>a &amp; <b>b</b></div><div>c</div>']);
    expect(texts(plain, '<b>a</b>', { locale: 'en-US' })).toEqual(['<b>a</b>', '<b>a</b>']);
  });
});
