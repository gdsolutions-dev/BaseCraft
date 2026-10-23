// Types de la Feuille de propriétés (tâche 4, qui les réexporte depuis property-sheet-model.ts) : ici pour que Designer.tsx se type.
import type { DisplayContext } from '../../shared/expr/localize';

export type SheetTab = 'format' | 'data' | 'event' | 'other' | 'all';
export interface PropertySheetContext {
  display: DisplayContext;                      // langue de l'interface + région
  fields: string[];                             // champs de la source du document
  objects(kind: 'form' | 'report'): string[];   // pour SourceObject
  tables: string[]; queries: string[];          // pour RecordSource et RowSource (requêtes utilisables après A3)
}
