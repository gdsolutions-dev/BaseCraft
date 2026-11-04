import { createBaseFile, FILE_EXTENSION } from '../main/db/file-format';
import { CliUsageError } from './errors';

export function assertBaseExtension(path: string): void {
  if (!path.toLowerCase().endsWith(FILE_EXTENSION)) throw new CliUsageError(`the file must end in ${FILE_EXTENSION}: ${path}`);
}

export function newBase(path: string, appVersion: string): void {
  assertBaseExtension(path);
  createBaseFile(path, appVersion);
}
