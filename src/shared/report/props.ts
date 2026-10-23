// Lecture des propriétés d'un état (contrat 1.4, C5) : seul module qui sait comment le catalogue stocke une valeur.
// Valeur absente, de mauvais type, hors min/max ou d'une propriété qui ne s'applique pas à la cible -> défaut d'état
// du catalogue, defaultFor(d, cible, 'report') : la feuille de propriétés et l'impression sont toujours d'accord.
import { isColorValue, resolveColor, type ColorValue } from '../design/colors';
import { defaultFor, PROPERTY_CATALOG, type PropertyDescriptor, type PropertyTarget } from '../design/properties';

const valid = (d: PropertyDescriptor, v: unknown): boolean => {
  switch (d.editor) {
    case 'bool': return typeof v === 'boolean';
    case 'enum': return typeof v === 'string' && d.options!.includes(v);
    case 'color': return isColorValue(v);
    case 'twips': return Number.isSafeInteger(v) && (v as number) >= 0;
    case 'number': return typeof v === 'number' && Number.isFinite(v) && v >= (d.min ?? -Infinity) && v <= (d.max ?? Infinity);
    case 'font': return typeof v === 'string' && v.trim() !== '';
    default: return typeof v === 'string';
  }
};

/** `props[name]` when valid for its descriptor and target, else the report default; a name absent from the catalog: raw ?? fallback. */
export function readProp(props: Record<string, unknown>, name: string, target: PropertyTarget, fallback?: unknown): unknown {
  const d = PROPERTY_CATALOG.find((x) => x.name === name);
  if (!d) return props[name] ?? fallback;
  const v = props[name];
  return d.appliesTo.includes(target) && valid(d, v) ? v : defaultFor(d, target, 'report');
}

/** A color property as printed: `#rrggbb`, a theme token resolved in the light theme (reports always print light). */
export function readColor(props: Record<string, unknown>, name: string, target: PropertyTarget): string {
  const d = PROPERTY_CATALOG.find((x) => x.name === name)!;
  return resolveColor(readProp(props, name, target), 'light', defaultFor(d, target, 'report') as ColorValue);
}
