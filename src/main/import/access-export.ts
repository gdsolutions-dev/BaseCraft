// Runs resources/access-export.ps1 (Microsoft Access, Windows) and reads the folder it writes (batch E2).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { dirname, join, resolve, sep, win32 } from 'node:path'
import type { AccessExport, ExportFailure, ExportManifest, ExportObject, ExportTable } from '../../shared/access-export'
import { sameName } from '../../shared/field-types'

// System executables by absolute path: a bare name is also searched in the current folder, where one could be planted.
const system32 = (...rest: string[]): string => win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', ...rest)
export const regPath = (): string => system32('reg.exe')
export const powershellPath = (): string => system32('WindowsPowerShell', 'v1.0', 'powershell.exe')

let access: boolean | undefined
/** Windows with Access.Application registered. Cached. */
export function hasAccess(): boolean {
  access ??= process.platform === 'win32' && spawnSync(regPath(), ['query', 'HKCR\\Access.Application'], { stdio: 'ignore' }).status === 0
  return access
}

/**
 * Runs the script on `source` into the empty folder `out`, which must be a new folder inside a parent folder the
 * caller owns (`<parent>\out`): the script keeps a temporary copy in `<parent>\src-<32 hex>`, and on a timeout this function
 * deletes the directories of exactly that name (the script cannot, being killed); nothing else is touched.
 * `password`: through stdin only, never an argument or a file. `tick`: one call per exported object. Nothing the
 * script prints is logged. `signal`: aborting it ends the run as the watchdog does (same processes, same cleanup, 'timeout').
 * `command` is for tests only (stands in for PowerShell); production callers never pass it.
 */
/** PowerShell arguments of the script run. No password here: it goes through stdin only. */
export const exportArgs = (script: string, source: string, out: string): string[] =>
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Source', source, '-Out', out]

export function runAccessExport(d: {
  script: string; source: string; out: string; password?: string
  tick?: (done: number, total: number) => void; timeoutMs?: number; signal?: AbortSignal
  command?: { file: string; args: string[] }
}): Promise<{ ok: true } | { ok: false; reason: Extract<ExportFailure, 'noAccess' | 'cannotOpen' | 'timeout' | 'failed'> }> {
  const cmd = d.command ?? {
    file: powershellPath(),
    args: exportArgs(d.script, d.source, d.out),
  }
  return new Promise((done) => {
    const child = spawn(cmd.file, cmd.args, { windowsHide: true })
    let accessPid = 0
    let timedOut = false
    let buf = ''
    let timer: NodeJS.Timeout
    let onPid: (() => void) | undefined
    let waitPid: NodeJS.Timeout | undefined
    const killAll = (): void => {
      clearTimeout(waitPid)
      // Only the process the script announced, then the script itself.
      if (accessPid > 0 && accessPid !== process.pid && accessPid !== process.ppid) try { process.kill(accessPid) } catch { /* already gone */ }
      child.kill()
    }
    const endRun = (): void => {
      if (timedOut) return
      timedOut = true
      clearTimeout(timer)
      if (accessPid > 0) return killAll()
      // No pid announced yet: Access may be about to start, so wait for the line (10 s at most) before ending anything.
      onPid = killAll
      waitPid = setTimeout(killAll, 10_000)
    }
    const arm = (): void => {
      if (timedOut) return
      clearTimeout(timer)
      timer = setTimeout(endRun, d.timeoutMs ?? 120_000)
    }
    arm()
    if (d.signal?.aborted) endRun()
    else d.signal?.addEventListener('abort', endRun, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      arm()
      buf += chunk.toString('utf8')
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const pid = /^pid (\d+)$/.exec(line)
        if (pid) { accessPid = Number(pid[1]); onPid?.() }
        const step = /^step (\d+) (\d+)$/.exec(line)
        if (step && Number(step[2]) > 0) d.tick?.(Number(step[1]), Number(step[2]))
      }
    })
    child.stderr.on('data', () => arm()) // read so the pipe never fills; never kept or logged
    child.on('error', () => { clearTimeout(timer); done({ ok: false, reason: 'failed' }) })
    child.stdin.on('error', () => { /* the script ended before reading */ })
    child.stdin.end((d.password ?? '') + '\n')
    child.on('close', (code) => {
      clearTimeout(timer)
      clearTimeout(waitPid)
      d.signal?.removeEventListener('abort', endRun)
      if (timedOut) {
        const parent = dirname(resolve(d.out))
        try {
          for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
            if (e.isDirectory() && /^src-[0-9a-f]{32}$/.test(e.name)) fs.rmSync(join(parent, e.name), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
          }
        } catch { /* best effort */ }
        return done({ ok: false, reason: 'timeout' })
      }
      done(code === 0 ? { ok: true } : { ok: false, reason: code === 2 ? 'noAccess' : code === 3 ? 'cannotOpen' : 'failed' })
    })
  })
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (o: Rec, k: string): boolean => typeof o[k] === 'string'
const num = (o: Rec, k: string): boolean => typeof o[k] === 'number'
const bool = (o: Rec, k: string): boolean => typeof o[k] === 'boolean'
const opt = (o: Rec, k: string, t: string): boolean => o[k] === undefined || typeof o[k] === t
const list = (v: unknown, ok: (e: Rec) => boolean): boolean => Array.isArray(v) && v.every((e) => isRec(e) && ok(e))

const OBJECT_TYPES = ['query', 'form', 'report', 'macro', 'module']
const okObject = (o: Rec): boolean => OBJECT_TYPES.includes(o.type as string) && str(o, 'name') && str(o, 'file') &&
  opt(o, 'queryType', 'number') && opt(o, 'connect', 'string') && opt(o, 'returnsRecords', 'boolean')
const okField = (f: Rec): boolean => str(f, 'name') && num(f, 'type') && num(f, 'size') && num(f, 'attributes') && bool(f, 'required') &&
  bool(f, 'allowZeroLength') && str(f, 'defaultValue') && str(f, 'validationRule') && str(f, 'validationText') &&
  isRec(f.props) && Object.values(f.props).every((v) => ['string', 'number', 'boolean'].includes(typeof v))
const okIndex = (i: Rec): boolean => str(i, 'name') && bool(i, 'primary') && bool(i, 'unique') && bool(i, 'foreign') &&
  list(i.fields, (c) => str(c, 'name') && bool(c, 'desc'))
const okTable = (t: Rec): boolean => str(t, 'name') && str(t, 'validationRule') && str(t, 'validationText') && str(t, 'description') &&
  list(t.fields, okField) && list(t.indexes, okIndex)

const MAX_JSON = 10 * 1024 * 1024

// The real path of the regular file `file` (relative to `dir`), or undefined unless it stays inside the real `dir`
// (no drive, no leading slash, no `..`, no link or junction leading out, no directory or device).
function safeFile(dir: string, file: string): string | undefined {
  if (!file || /^[a-zA-Z]:|^[\\/]/.test(file) || file.split(/[\\/]/).includes('..')) return undefined
  try {
    const root = fs.realpathSync(dir)
    const real = fs.realpathSync(resolve(root, file))
    return real.startsWith(root.endsWith(sep) ? root : root + sep) && fs.statSync(real).isFile() ? real : undefined
  } catch { return undefined }
}

function readJson(dir: string, name: string): unknown {
  const real = safeFile(dir, name)
  if (!real || fs.statSync(real).size > MAX_JSON) throw new Error('bad')
  return JSON.parse(fs.readFileSync(real, 'utf8'))
}

/** Reads and checks an export folder. `source`: the Access file's name; a manifest of another name is 'otherSource'. */
export function readAccessExport(dir: string, source: string):
  { ok: true; export: AccessExport } | { ok: false; reason: Extract<ExportFailure, 'badFolder' | 'otherSource'> } {
  const bad = { ok: false, reason: 'badFolder' } as const
  let m: unknown, s: unknown
  try {
    m = readJson(dir, 'manifest.json')
    s = readJson(dir, 'structure.json')
  } catch { return bad }
  if (!isRec(m) || !isRec(s) || m.format !== 1 || !str(m, 'accessVersion') || !str(m, 'source')) return bad
  if (!list(m.objects, okObject) || !list(m.errors, (e) => str(e, 'type') && str(e, 'name') && str(e, 'message')) || !list(s.tables, okTable)) return bad
  const manifest = m as unknown as ExportManifest
  if (!manifest.objects.every((o: ExportObject) => safeFile(dir, o.file) !== undefined)) return bad
  if (!sameName(manifest.source, source)) return { ok: false, reason: 'otherSource' }
  return { ok: true, export: { manifest, tables: s.tables as unknown as ExportTable[] } }
}
