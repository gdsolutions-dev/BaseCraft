/** E6: the focus moved A, nowhere, B: B's previous control is A. `focused` is null while no control has the focus. */
export interface Trail { now: string | null; prev: string | null }
export const nextTrail = (t: Trail, focused: string | null): Trail => focused !== null && focused !== t.now ? { now: focused, prev: t.now } : t;
