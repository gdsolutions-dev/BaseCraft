// État de référence « Factures par client » (pur) : la source Factures (75 lignes mélangées) et sa définition, regroupée sur
// Client avec en-tête, pied et totaux. Utilisé par les tests du moteur, l'amorçage e2e et la recette de déterminisme.
import type { SqlValue } from '../../coerce';
import type { ControlDef, DesignDoc, SectionDef } from '../../design/model';
import { defaultProps, type FieldType } from '../../field-types';
import type { SourceField } from '../../record-source';

const field = (name: string, type: FieldType, size?: number): SourceField =>
  ({ name, type, props: { ...defaultProps(type), ...(size === undefined ? {} : { size }) } });

export const FACTURES_FIELDS: SourceField[] = [
  field('N°', 'autoNumber'), field('Client', 'shortText', 50), field('Date', 'dateTime'), field('Libellé', 'shortText', 100), field('Montant', 'currency'),
];

// Dupont 60 × 0,10 ; Martin 10 × 1 999,99 ; Durand 12,35, 7,65, 0,01, 100,00 et 0,99
const LINES: [string, number][] = [
  ...Array.from({ length: 60 }, (): [string, number] => ['Dupont', 0.1]),
  ...Array.from({ length: 10 }, (): [string, number] => ['Martin', 1999.99]),
  ...[12.35, 7.65, 0.01, 100, 0.99].map((m): [string, number] => ['Durand', m]),
];
const pad = (n: number) => String(n).padStart(2, '0');
/** 75 rows, mixed: line i of LINES is source row (i × 29) mod 75 (29 and 75 are coprime). N° and Date follow the source order. */
export const FACTURES_ROWS: SqlValue[][] = (() => {
  const rows: SqlValue[][] = [];
  LINES.forEach(([client, montant], i) => { rows[(i * 29) % 75] = [client, montant]; });
  return rows.map(([client, montant], k) => [k + 1, client!, `2026-${pad(1 + Math.floor(k / 28))}-${pad(1 + (k % 28))} 00:00:00`, `Article ${k + 1}`, montant!]);
})();

const FONT = { FontName: 'Liberation Sans', FontSize: 10, BorderStyle: 'transparent' };
const box = (kind: 'label' | 'textBox', name: string, left: number, top: number, width: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left, top, width, height: 340, props: { ...FONT, ...props } });
const section = (kind: SectionDef['kind'], height: number, controls: ControlDef[], props: Record<string, unknown> = {}, groupLevel?: number): SectionDef =>
  ({ kind, height, props, controls, ...(groupLevel === undefined ? {} : { groupLevel }) });

// colonnes : Date 0–1701, Libellé 1814–6916, Montant 7030–9298
export const FACTURES_REPORT: DesignDoc = {
  formatVersion: '1.0',
  recordSource: { kind: 'table', name: 'Factures' },
  props: {
    Width: 10772,
    pageSetup: { orientation: 'portrait', margins: { top: 567, right: 567, bottom: 567, left: 567 } },
    grouping: [{ expression: 'Client', order: 'asc', header: true, footer: true, keepTogether: 'no' }],
  },
  sections: [
    section('reportHeader', 1134, [box('label', 'Titre', 0, 283, 4535, { Caption: 'Factures' })]),
    section('pageHeader', 567, [box('label', 'Etiquette_Date', 0, 113, 1701, { Caption: 'Date' }),
      box('label', 'Etiquette_Libelle', 1814, 113, 5102, { Caption: 'Libellé' }), box('label', 'Etiquette_Montant', 7030, 113, 2268, { Caption: 'Montant', TextAlign: 'right' })]),
    section('groupHeader', 454, [box('textBox', 'Client', 0, 57, 4535, { ControlSource: 'Client' })], { RepeatSection: true }, 0),
    section('detail', 340, [box('textBox', 'Date', 0, 0, 1701, { ControlSource: 'Date', Format: 'shortDate' }),
      box('textBox', 'Libelle', 1814, 0, 5102, { ControlSource: 'Libellé' }), box('textBox', 'Montant', 7030, 0, 2268, { ControlSource: 'Montant', Format: 'currency' })]),
    section('groupFooter', 454, [box('textBox', 'Total_Client', 1814, 57, 5102, { ControlSource: '="Total " & [Client]' }),
      box('textBox', 'Somme_Client', 7030, 57, 2268, { ControlSource: '=Sum([Montant])', Format: 'currency' })], {}, 0),
    section('pageFooter', 567, [box('textBox', 'Numero_Page', 3118, 113, 4535, { ControlSource: '="Page " & [Page] & " sur " & [Pages]', TextAlign: 'center' })]),
    section('reportFooter', 567, [box('textBox', 'Nombre_Factures', 1814, 113, 5102, { ControlSource: '=Count(*)' }),
      box('textBox', 'Somme_Totale', 7030, 113, 2268, { ControlSource: '=Sum([Montant])', Format: 'currency' })]),
  ],
};
