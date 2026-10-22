import type { BasecraftApi } from '../shared/api';

/** The renderer's only way out: the preload bridge. */
export const api = (window as unknown as { basecraft: BasecraftApi }).basecraft;
