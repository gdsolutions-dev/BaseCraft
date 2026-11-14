import type { BasecraftApi } from '../../shared/api';
import type { DepObject, DepWorld } from './dependencies';

/** The tables and the stored definitions of every non-module object; a definition that fails to load is null. */
export async function loadDepWorld(api: Pick<BasecraftApi, 'tables' | 'objects'>): Promise<DepWorld> {
  const [tables, list] = await Promise.all([api.tables.list(), api.objects.list()]);
  const objects: DepObject[] = await Promise.all(list.filter((o) => o.kind !== 'module').map(async (o) =>
    ({ kind: o.kind as DepObject['kind'], name: o.name, definition: await api.objects.get(o.kind, o.name).then((x) => x.definition, () => null) })));
  return { tables: tables.map((x) => x.name), objects };
}
