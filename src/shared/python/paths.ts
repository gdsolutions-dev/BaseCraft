/** The app's own origin in production (main/app-protocol.ts); the Python files are always fetched from it, also in dev. */
export const APP_SCHEME = 'bc-app';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const PYTHON_BASE_URL = `${APP_ORIGIN}/python/`;
