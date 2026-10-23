// Écriture d'un fichier d'export : dans `<fichier>.bc-tmp`, renommé sur le fichier une fois complet ; en cas d'échec le
// temporaire est supprimé et un fichier existant reste intact.
import { rename, rm } from 'node:fs/promises';

export const writeFailed = (e: unknown): Error => {
  console.error(e);
  return new Error('bc:writeFailed');
};

/** `write` fills the temporary file (it must have closed it). Its errors pass through; a rename error is bc:writeFailed. */
export async function viaTemp<T>(path: string, write: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = `${path}.bc-tmp`;
  try {
    const result = await write(tmp);
    try { await rename(tmp, path); } catch (e) { throw writeFailed(e); }
    return result;
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {}); // a directory in its place (not ours) stays: rm refuses it without recursive
    throw e;
  }
}
