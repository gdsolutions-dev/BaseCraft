import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import it from './it.json';
import ja from './ja.json';
import ko from './ko.json';
import nl from './nl.json';
import pl from './pl.json';
import pt from './pt.json';
import zh from './zh.json';
import type { UiLanguage } from './index';

/** Typed by the English catalog; catalog.test.ts keeps the others in step (plural suffixes follow each language). */
export const catalogs = { fr, en, es, de, it, pt, nl, pl, ja, zh, ko } as unknown as Record<UiLanguage, typeof en>;
