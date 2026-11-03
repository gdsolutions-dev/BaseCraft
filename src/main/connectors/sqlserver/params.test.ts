import { describe, expect, it } from 'vitest';
import { msKey, msLabel, msParams } from './params';

describe('msParams (C5 R2)', () => {
  it('params: defaults, named instance, key without the user', () => {
    const p = msParams({ host: 'SRV01', instance: 'SQLEXPRESS', database: 'Ventes', user: 'ana' });
    expect(p).toEqual({ host: 'srv01', instance: 'SQLEXPRESS', port: 1433, database: 'Ventes', user: 'ana', tls: 'verify-full', timeout: 60 });
    expect(msKey(p)).toBe('sqlserver://srv01\\sqlexpress/Ventes?tls=verify-full');
    expect(msLabel(p)).toBe('srv01\\SQLEXPRESS/Ventes');
    expect(msKey(msParams({ host: 'db', port: 14341, database: 'd', user: 'x', tls: 'require' }))).toBe('sqlserver://db:14341/d?tls=require');
    expect(msLabel(msParams({ host: 'db', database: 'd', user: 'x' }))).toBe('db:1433/d');
    for (const bad of [{ host: 'a\\b', database: 'd', user: 'u' }, { host: 'h', instance: 'x y', database: 'd', user: 'u' }, { host: 'h', database: '', user: 'u' },
      { host: 'h', database: 'd', user: 'u', tls: 'strict' }, { host: 'h', instance: 'a'.repeat(17), database: 'd', user: 'u' }, { host: 'h', port: 0, database: 'd', user: 'u' },
      { host: 'h', database: 'd'.repeat(129), user: 'u' }, null, []])
      expect(() => msParams(bad)).toThrow('bc:invalidArgument');
  });
  it('an empty instance reads as none', () => {
    const p = msParams({ host: 'h', instance: '', database: 'd', user: 'u' });
    expect('instance' in p).toBe(false);
  });
});
