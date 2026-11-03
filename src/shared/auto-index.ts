// AutoIndex on Import/Create (O3 R4): the list of name beginnings/endings whose fields get an index. Pure.
import { foldName } from './field-types';
import type { UiLanguage } from './i18n';
import type { ImportField } from './import-text';

export const AUTO_INDEX_DEFAULT: Record<UiLanguage, string> = {
  fr: 'N°;clé;code;num', en: 'ID;key;code;num', de: 'ID;Schlüssel;Code;Nr', es: 'Id;clave;código;núm', it: 'ID;chiave;codice;num',
  ja: 'ID;キー;コード;番号', ko: 'ID;키;코드;번호', nl: 'ID;sleutel;code;num', pl: 'ID;klucz;kod;num', pt: 'ID;chave;código;núm', zh: 'ID;键;代码;编号',
};

/** The name begins or ends with an entry of the `;` list (trimmed, empty ones ignored); case ignored, accents significant. */
export function autoIndexed(name: string, list: string): boolean {
  const n = foldName(name);
  return list.split(';').map((e) => foldName(e.trim())).some((e) => e !== '' && (n.startsWith(e) || n.endsWith(e)));
}

/** Indexed « Non » becomes « Oui - Avec doublons » where the name matches; set values stay. */
export const withAutoIndex = (fields: ImportField[], list: string): ImportField[] =>
  fields.map((f) => (f.indexed === 'no' && autoIndexed(f.name, list) ? { ...f, indexed: 'yesDuplicates' } : f));
