import { describe, expect, it } from 'vitest';
import { run } from './main';

describe('cli entry', () => {
  it('prints the version and exits 0', async () => {
    const out: string[] = [];
    expect(await run(['--version'], { out: (s) => out.push(s), err: () => {} })).toBe(0);
    expect(out.join('')).toMatch(/^basecraft-cli \d+\.\d+\.\d+/);
  });
  it('exits 2 on no arguments', async () => {
    expect(await run([], { out: () => {}, err: () => {} })).toBe(2);
  });
});

describe('unexpected errors', () => {
  it('new in a missing directory prints a message, not a stack', async () => {
    const os = await import('node:os'), path = await import('node:path');
    const err: string[] = [];
    expect(await run(['new', path.join(os.tmpdir(), 'bccli-nodir', 'x.basecraft')], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toMatch(/\S/);
    expect(err.join('')).not.toMatch(/\n\s+at /);
  });
});

describe('new on an existing file', () => {
  it('says the file already exists', async () => {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 'x.basecraft');
    const err: string[] = [];
    await run(['new', p], { out: () => {}, err: () => {} });
    expect(await run(['new', p], { out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('')).toBe(`${p} already exists\n`);
  });
});

describe('resources', () => {
  it('lists what resource.add added, and commands lists resource.add', async () => {
    const fs = await import('node:fs'), { tmp } = await import('./test-tmp');
    const p = tmp(), img = p.replace('x.basecraft', 'logo.png'), spec = p.replace('x.basecraft', 's.json');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(img, png); fs.writeFileSync(spec, JSON.stringify([{ op: 'resource.add', file: img }]));
    const io = { out: () => {}, err: () => {} };
    expect(await run(['new', p], io)).toBe(0);
    expect(await run(['script', spec, p], io)).toBe(0);
    const out: string[] = [];
    expect(await run(['resources', p], { out: (s) => out.push(s), err: () => {} })).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual([{ name: 'logo', type: 'png', bytes: png.length }]);
    const cmds: string[] = [];
    await run(['commands'], { out: (s) => cmds.push(s), err: () => {} });
    expect(cmds.join('')).toContain('resource.add');
  });
  it('exits 2 on a missing file or extension', async () => {
    expect(await run(['resources', 'nope.basecraft'], { out: () => {}, err: () => {} })).toBe(2);
    expect(await run(['resources', 'nope.txt'], { out: () => {}, err: () => {} })).toBe(2);
  });
});

describe('attachments', () => {
  it('lists the files of an Attachment field and extracts them', async () => {
    const fs = await import('node:fs'), path = await import('node:path'), { tmp } = await import('./test-tmp');
    const { DatabaseSync } = await import('node:sqlite'), { registerFunctions } = await import('../main/db/file-format'), { addAttachments } = await import('../main/db/attachments');
    const p = tmp(), spec = p.replace('x.basecraft', 's.json'), out = p.replace('x.basecraft', 'extracted');
    fs.writeFileSync(spec, JSON.stringify([
      { op: 'table.create', name: 'Clients', fields: [{ name: 'Nom', type: 'shortText' }, { name: 'Pieces', type: 'attachment' }] },
      { op: 'rows.insert', table: 'Clients', rows: [{ Nom: 'A' }, { Nom: 'B' }] },
    ]));
    const io = { out: () => {}, err: () => {} };
    expect(await run(['new', p], io)).toBe(0);
    expect(await run(['script', spec, p], io)).toBe(0);
    const db = new DatabaseSync(p); registerFunctions(db);
    addAttachments(db, 'Clients', 'Pieces', 2, [{ name: 'a.txt', data: Uint8Array.from([65, 66]) }, { name: 'b.bin', data: Uint8Array.from([1]) }]);
    db.close();
    const json = async (...a: string[]) => { const o: string[] = []; const code = await run(['attachments', p, ...a], { out: (s) => o.push(s), err: () => {} }); return { code, v: o.length ? JSON.parse(o.join('')) : null }; };
    expect((await json('clients', 'pieces')).v).toEqual([{ rowid: 2, files: [{ id: 1, name: 'a.txt', type: 'txt', bytes: 2 }, { id: 2, name: 'b.bin', type: 'bin', bytes: 1 }] }]);
    expect((await json('Clients', 'Pieces', '1')).v).toEqual([]);
    expect((await json('Clients', 'Pieces', '2', '--extract', out)).code).toBe(0);
    expect([...fs.readFileSync(path.join(out, 'a.txt'))]).toEqual([65, 66]);
    expect(fs.readdirSync(out).sort()).toEqual(['a.txt', 'b.bin']);
    const errs: string[] = [];
    expect(await run(['attachments', p, 'Clients', 'Pieces', '2', '--extract', out], { out: () => {}, err: (s) => errs.push(s) })).toBe(1);   // never over a file
    expect(await run(['attachments', p, 'Clients', 'Nom'], { out: () => {}, err: (s) => errs.push(s) })).toBe(1);
    expect(errs.join('')).toContain('not an Attachment field');
    expect(await run(['attachments', p, 'Clients'], { out: () => {}, err: () => {} })).toBe(2);
    expect(await run(['attachments', p, 'Clients', 'Pieces', 'x'], { out: () => {}, err: () => {} })).toBe(2);
  });
});
