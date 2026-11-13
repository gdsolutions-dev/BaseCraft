import { expect, it } from 'vitest';
import { parseFlatXml } from './xml-read';

const ACCESS = `﻿<?xml version="1.0" encoding="UTF-8"?>
<dataroot xmlns:od="urn:schemas-microsoft-com:officedata" generated="2026-11-12T10:00:00">
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"><xsd:element name="Clients"/></xsd:schema>
<Clients>
<N_x00B0_>1</N_x00B0_>
<Nom>Dupont &amp; fils</Nom>
<Quand>2026-01-15T08:09:10</Quand>
</Clients>
<Clients>
<N_x00B0_>2</N_x00B0_>
<Ville><![CDATA[Lyon <1>]]></Ville>
<Nom/>
</Clients>
<Other><X>1</X></Other>
</dataroot>`;

it('reads Access data XML: names unescaped, columns united, dates normalised, other elements skipped', () => {
  const x = parseFlatXml(ACCESS);
  expect(x.row).toBe('Clients');
  expect(x.columns).toEqual(['N°', 'Nom', 'Quand', 'Ville']);
  expect(x.rows).toEqual([['1', 'Dupont & fils', '2026-01-15 08:09:10', ''], ['2', '', '', 'Lyon <1>']]);
});
it('refuses a DTD, entity declarations, nesting inside a field, text between records and non-XML', () => {
  const dtd = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d><r><a>&x;</a></r></d>';
  for (const bad of [dtd, '<d><r><a><b>1</b></a></r></d>', '<d>stray<r><a>1</a></r></d>', 'not xml', '<d></d>', '<d><r><a>1</a></r>'])
    expect(() => parseFlatXml(bad), bad).toThrow('bc:xmlUnsupported');
});
it('unknown entities stay as written (nothing is resolved)', () => {
  expect(parseFlatXml('<d><r><a>&x; &#65; &#x42;</a></r></d>').rows).toEqual([['&x; A B']]);
});
