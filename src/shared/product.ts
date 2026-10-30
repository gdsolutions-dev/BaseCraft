// Which build this is (B5): the full BaseCraft, or BaseCraft Runtime (electron-vite build --mode runtime: the same sources,
// the designers removed). A build-time constant: electron.vite.config.ts and vitest.config.ts define it.
declare const __BC_RUNTIME__: boolean;

export const RUNTIME: boolean = __BC_RUNTIME__;
/** The product's name before i18n loads (the window's first title). */
export const PRODUCT_NAME = RUNTIME ? 'BaseCraft Runtime' : 'BaseCraft';
/** The i18n key of the product's name, for what the user reads (window title, Backstage, dialogs). */
export const PRODUCT_TITLE_KEY = RUNTIME ? 'app.titleRuntime' : 'app.title';
