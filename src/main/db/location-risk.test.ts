import { describe, expect, it } from 'vitest';
import { detectLocationRisk, systemProbe } from './location-risk';

const win = { platform: 'win32' as const, env: {}, homedir: 'C:\\Users\\a' };

describe('detectLocationRisk', () => {
  it('windows', () => {
    expect(detectLocationRisk('\\\\nas\\partage\\b.basecraft', win)).toBe('network');
    expect(detectLocationRisk('\\\\?\\C:\\x\\b.basecraft', win)).toBe('local');
    expect(detectLocationRisk('Z:\\b.basecraft', { ...win, windowsDriveType: (d) => (d === 'Z:' ? 4 : 3) })).toBe('network');
    expect(detectLocationRisk('C:\\Users\\a\\OneDrive - ACME\\b.basecraft', { ...win, env: { OneDriveCommercial: 'C:\\Users\\a\\OneDrive - ACME' } })).toBe('synced');
    expect(detectLocationRisk('C:\\Users\\a\\Dropbox\\x\\b.basecraft', win)).toBe('synced');
    // Google Drive for desktop mounts its own fixed drive, with French folder names too (any case, NFC or NFD).
    for (const p of ['G:\\Mon Drive\\x.basecraft', 'G:\\Drives partagés\\Équipe\\x.basecraft', 'G:\\Shared drives\\T\\x.basecraft', 'G:\\DRIVES PARTAGE\u0301S\\x.basecraft']) {
      expect(detectLocationRisk(p, { ...win, windowsDriveType: () => 3 })).toBe('synced');
    }
    expect(detectLocationRisk('C:\\Users\\a\\Documents\\b.basecraft', win)).toBe('local');
  });
  it('windows : cas limites', () => {
    expect(detectLocationRisk('\\\\?\\UNC\\nas\\p\\b.basecraft', win)).toBe('network');
    expect(detectLocationRisk('\\\\.\\C:\\b.basecraft', win)).toBe('local');
    const env = { OneDrive: 'C:\\Users\\a\\OneDrive' };
    expect(detectLocationRisk('C:\\Users\\a\\OneDriveX\\b.basecraft', { ...win, env })).toBe('local');
    expect(detectLocationRisk('c:\\users\\A\\onedrive\\b.basecraft', { ...win, env })).toBe('synced');
    expect(detectLocationRisk('C:\\Users\\a\\..\\a\\OneDrive\\b.basecraft', { ...win, env })).toBe('synced');
    expect(detectLocationRisk('Z:\\b.basecraft', { ...win, windowsDriveType: () => null })).toBe('local');
  });
  it('linux', () => {
    const linux = { platform: 'linux' as const, env: {}, homedir: '/home/a', mounts: '//nas/p /mnt/nas cifs rw 0 0\n/dev/sda1 / ext4 rw 0 0' };
    expect(detectLocationRisk('/mnt/nas/b.basecraft', linux)).toBe('network');
    expect(detectLocationRisk('/home/a/b.basecraft', linux)).toBe('local');
  });
  it('linux : échappement octal et point de montage le plus long', () => {
    const mounts = '//nas/p /mnt/my\\040share nfs rw 0 0\n/dev/sda1 / ext4 rw 0 0\n/dev/sdb1 /mnt/my\\040share/local ext4 rw 0 0';
    const linux = { platform: 'linux' as const, env: {}, homedir: '/home/a', mounts };
    expect(detectLocationRisk('/mnt/my share/b.basecraft', linux)).toBe('network');
    expect(detectLocationRisk('/mnt/my share/local/b.basecraft', linux)).toBe('local');
  });
  it('macos', () => {
    const mac = { platform: 'darwin' as const, env: {}, homedir: '/Users/a', mounts: '//a@nas/p on /Volumes/p (smbfs, nodev)\n/dev/disk3s1 on / (apfs, local)' };
    expect(detectLocationRisk('/Volumes/p/b.basecraft', mac)).toBe('network');
    expect(detectLocationRisk('/Users/a/Library/CloudStorage/GoogleDrive-x/b.basecraft', mac)).toBe('synced');
    expect(detectLocationRisk('/Users/a/b.basecraft', mac)).toBe('local');
  });
});

describe('systemProbe', () => {
  it('renvoie la plateforme courante', () => {
    expect(systemProbe().platform).toBe(process.platform);
  });
});
