import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LocationRisk } from '../../shared/api';
export type { LocationRisk };

export interface RiskProbe {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  mounts?: string;
  windowsDriveType?: (drive: string) => number | null;
}

const SYNC_SEGMENTS = new Set(['dropbox', 'google drive', 'my drive', 'mon drive', 'shared drives', 'drives partagés', 'icloud drive', 'iclouddrive']);
const LINUX_NET = new Set(['cifs', 'smb3', 'smbfs', 'nfs', 'nfs4', 'fuse.sshfs', 'davfs']);
const MAC_NET = new Set(['smbfs', 'nfs', 'afpfs', 'webdav']);

export function detectLocationRisk(filePath: string, probe: RiskProbe): LocationRisk {
  const win = probe.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const fold = win || probe.platform === 'darwin';
  // Normalise : `..` résolus, séparateurs finaux retirés, casse ignorée là où le système de fichiers l'ignore.
  const norm = (s: string): string => {
    const n = p.normalize(s).replace(/[\\/]+$/, '');
    return fold ? n.toLowerCase() : n;
  };
  const under = (child: string, dir: string): boolean => child === dir || child.startsWith(dir + p.sep);

  let raw = filePath;
  if (win) {
    if (/^\\\\\?\\UNC\\/i.test(raw)) return 'network';
    if (/^\\\\[?.]\\/.test(raw)) raw = raw.slice(4); // chemins de périphérique : locaux
    else if (raw.startsWith('\\\\')) return 'network';
  }
  const n = norm(raw);

  const roots = [probe.env.OneDrive, probe.env.OneDriveCommercial, probe.env.OneDriveConsumer]
    .filter((d): d is string => !!d)
    .map(norm);
  const cloud = [p.join(probe.homedir, 'Library', 'CloudStorage'), p.join(probe.homedir, 'Library', 'Mobile Documents')].map(norm);
  if ([...roots, ...cloud].some((d) => under(n, d)) || n.split(/[\\/]/).some((s) => SYNC_SEGMENTS.has(s.normalize('NFC').toLowerCase()))) {
    return 'synced';
  }

  if (win) {
    const drive = /^[A-Za-z]:/.exec(raw)?.[0].toUpperCase();
    if (drive && probe.windowsDriveType?.(drive) === 4) return 'network';
  } else if (probe.mounts) {
    const lines = probe.mounts.split('\n');
    let best = { len: -1, net: false };
    for (const line of lines) {
      let mount: string | undefined;
      let fstype: string | undefined;
      let net = false;
      if (probe.platform === 'linux') {
        const f = line.trim().split(/\s+/);
        if (f.length < 3) continue;
        mount = f[1].replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
        fstype = f[2];
        net = LINUX_NET.has(fstype);
      } else {
        const m = /^.+? on (.+) \(([^,)]+)/.exec(line);
        if (!m) continue;
        mount = m[1];
        fstype = m[2];
        net = MAC_NET.has(fstype);
      }
      const dir = norm(mount);
      if (under(n, dir) && dir.length > best.len) best = { len: dir.length, net };
    }
    if (best.net) return 'network';
  }
  return 'local';
}

export function systemProbe(): RiskProbe {
  const probe: RiskProbe = { platform: process.platform, env: process.env, homedir: os.homedir() };
  if (process.platform === 'linux') {
    try {
      probe.mounts = readFileSync('/proc/mounts', 'utf8');
    } catch {
      /* mounts reste indéfini */
    }
  } else if (process.platform === 'darwin') {
    try {
      probe.mounts = execFileSync('/sbin/mount', { encoding: 'utf8' });
    } catch {
      /* mounts reste indéfini */
    }
  } else if (process.platform === 'win32') {
    const cache = new Map<string, number | null>();
    probe.windowsDriveType = (drive) => {
      if (!/^[A-Za-z]:$/.test(drive)) return null; // pas d'injection dans la commande
      if (cache.has(drive)) return cache.get(drive) ?? null;
      let type: number | null;
      try {
        const out = execFileSync(
          'powershell',
          ['-NoProfile', '-Command', `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").DriveType`],
          { encoding: 'utf8', timeout: 3000, windowsHide: true },
        );
        type = Number(out.trim());
        if (out.trim() === '' || Number.isNaN(type)) type = null;
      } catch {
        type = null;
      }
      cache.set(drive, type);
      return type;
    };
  }
  return probe;
}
