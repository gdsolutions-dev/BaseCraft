import { describe, expect, it } from 'vitest';
import { pickSpellLanguage, startWinSpell } from './spellcheck';

const AVAILABLE = ['de', 'en-AU', 'en-GB', 'en-US', 'es', 'es-419', 'fr', 'pt-BR', 'pt-PT'];
it('picks the region, else the language default, else nothing', () => {
  expect(pickSpellLanguage(AVAILABLE, 'fr', 'fr-FR')).toBe('fr');
  expect(pickSpellLanguage(AVAILABLE, 'en', 'en-GB')).toBe('en-GB');
  expect(pickSpellLanguage(AVAILABLE, 'en', 'fr-FR')).toBe('en-US');
  expect(pickSpellLanguage(AVAILABLE, 'pt', 'pt-PT')).toBe('pt-PT');
  expect(pickSpellLanguage(AVAILABLE, 'pt', 'en-US')).toBe('pt-BR');
  expect(pickSpellLanguage(AVAILABLE, 'ja', 'ja-JP')).toBeNull();
});

describe.skipIf(process.platform !== 'win32')('startWinSpell', () => {
  const fake = (body: string) => startWinSpell(process.execPath, ['-e', body], 5000, 500);
  const echo = "console.log('READY fr-FR');require('readline').createInterface({input:process.stdin}).on('line',l=>{for(const w of l.split('\t'))if(w==='bad')console.log('bad\tgood\tbetter');console.log('END')})";
  it('answers the misspelled words with their suggestions, one request at a time', async () => {
    const s = fake(echo);
    expect(await s.ready).toBe(true);
    const [a, b] = await Promise.all([s.check(['ok', 'bad']), s.check(['ok'])]);
    expect(a).toEqual({ bad: ['good', 'better'] });
    expect(b).toEqual({});
    s.stop();
  });
  it('is not ready when no checker exists, or when the child never answers', async () => {
    const none = fake("console.log('READY -')");
    expect(await none.ready).toBe(false);
    expect(await none.check(['bad'])).toEqual({});
    const silent = startWinSpell(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], 300);
    expect(await silent.ready).toBe(false);
  });
  it('is no longer alive once the child ends, so the next Spelling restarts it', async () => {
    const s = fake("console.log('READY fr-FR')");
    expect(await s.ready).toBe(true);
    await expect.poll(() => s.alive()).toBe(false);
  });
});
