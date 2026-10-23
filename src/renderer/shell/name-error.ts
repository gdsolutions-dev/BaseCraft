import { isReservedName, isValidObjectName } from '../../shared/field-types';

/** The i18n key of what is wrong with an object name, else null (shared by the rename, copy and paste prompts). */
export const nameErrorKey = (v: string): string | null =>
  v.trim() === '' ? 'designError.nameEmpty' : !isValidObjectName(v) ? 'designError.nameInvalid' : isReservedName(v) ? 'designError.reservedName' : null;
