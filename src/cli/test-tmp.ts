import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A fresh path for a .basecraft file inside a new temp directory. */
export const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 'x.basecraft');
