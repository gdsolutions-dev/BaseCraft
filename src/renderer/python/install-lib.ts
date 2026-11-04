import type { PyodideInterface } from 'pyodide'

const globbed = import.meta.glob('../../python/basecraft/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Bare file name -> source. */
export const LIB_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(globbed).map(([path, src]) => [path.split('/').pop() as string, src])
)

export function installBasecraftLib(pyodide: PyodideInterface, files: Record<string, string>): void {
  const dir = '/home/pyodide/basecraft'
  pyodide.FS.mkdirTree(dir)
  for (const [name, src] of Object.entries(files)) pyodide.FS.writeFile(`${dir}/${name}`, src)
  pyodide.runPython('import sys\nif "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")\nimport basecraft\nbasecraft.install()')
}
