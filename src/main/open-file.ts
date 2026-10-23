import { FILE_EXTENSION } from './db/file-format';

/** The first argument that is a base file (flags and macOS -psn_* are never one). */
export function fileArg(argv: string[]): string | null {
  return argv.slice(1).find((a) => !a.startsWith('-') && a.toLowerCase().endsWith(FILE_EXTENSION)) ?? null;
}

/** One database = one window (spec 4.1): open here when no base is open, else start a new BaseCraft process. */
export async function handleOpenFile(
  path: string,
  deps: { hasBase(): boolean; open(p: string): Promise<void>; spawn(p: string): void },
): Promise<void> {
  if (deps.hasBase()) deps.spawn(path);
  else await deps.open(path);
}

/** Files received at startup (argv first, then those macOS queued before ready): the first opens here, the rest spawn. */
export async function openAll(paths: string[], deps: Parameters<typeof handleOpenFile>[1]): Promise<void> {
  await Promise.all(paths.map((p) => handleOpenFile(p, deps))); // each call starts synchronously, in order
}
