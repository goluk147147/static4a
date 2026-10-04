// Custom ESM resolve/load hooks for running the local-first store tests under
// Node's built-in test runner with type-stripping. It does two jobs with ZERO
// extra dependencies:
//   1. Redirect the React-Native / Expo modules the source files import
//      (`@react-native-async-storage/async-storage`, `../api` → src/api, and any
//      `@tanstack/react-query` runtime import) to in-memory mock modules that run
//      in plain Node. The AsyncStorage mock is backed by a Map exposed on
//      globalThis.__mockStore so tests can reset/inspect it; the api mock is
//      exposed on globalThis.__mockApi so tests can control responses and count calls.
//   2. Make the extensionless `../api` import resolve to the mock (the real file is
//      api.ts, which Node's strict ESM resolver won't auto-extend).
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

const SRC = resolvePath(import.meta.dirname, '..');
const API_FILE = pathToFileURL(resolvePath(SRC, 'api.ts')).href;
const API_NOEXT = pathToFileURL(resolvePath(SRC, 'api')).href;

const ASYNC_STORAGE = '@react-native-async-storage/async-storage';
const REACT_QUERY = '@tanstack/react-query';

const MOCK_ASYNC_STORAGE = 'mock:async-storage';
const MOCK_API = 'mock:api';
const MOCK_REACT_QUERY = 'mock:react-query';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === ASYNC_STORAGE) return { url: MOCK_ASYNC_STORAGE, shortCircuit: true };
  if (specifier === REACT_QUERY) return { url: MOCK_REACT_QUERY, shortCircuit: true };

  // The source files import the api via a relative `../api` (extensionless).
  // Catch it both as the raw specifier and as the already-resolved file URL.
  if (specifier === API_FILE || specifier === API_NOEXT) {
    return { url: MOCK_API, shortCircuit: true };
  }
  if (/(^|\/)api$/.test(specifier) || specifier.endsWith('/api')) {
    // relative `../api` from src/store → resolve the importer-relative path
    try {
      const resolved = new URL(specifier, context.parentURL).href;
      if (resolved === API_NOEXT || resolved === API_FILE) {
        return { url: MOCK_API, shortCircuit: true };
      }
    } catch {
      /* not a URL-resolvable specifier — fall through */
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === MOCK_ASYNC_STORAGE) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        const store = (globalThis.__mockStore ||= new Map());
        const AsyncStorage = {
          getItem: async (k) => (store.has(k) ? store.get(k) : null),
          setItem: async (k, v) => { store.set(k, String(v)); },
          removeItem: async (k) => { store.delete(k); },
          clear: async () => { store.clear(); },
        };
        export default AsyncStorage;
      `,
    };
  }
  if (url === MOCK_API) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        // Controllable fake. Tests set globalThis.__mockApi.getImpl / postImpl and
        // read globalThis.__mockApi.calls to assert ZERO network on local paths.
        const state = (globalThis.__mockApi ||= {
          calls: { get: 0, post: 0, getPaths: [], postPaths: [], postBodies: [] },
          getImpl: async () => ({}),
          postImpl: async () => ({}),
        });
        export const api = {
          get: async (path, params) => {
            state.calls.get++;
            state.calls.getPaths.push(path);
            return state.getImpl(path, params);
          },
          post: async (path, body) => {
            state.calls.post++;
            state.calls.postPaths.push(path);
            state.calls.postBodies.push(body);
            return state.postImpl(path, body);
          },
        };
        export class ApiError extends Error {
          constructor(message, status) { super(message); this.status = status; }
        }
        export default api;
      `,
    };
  }
  if (url === MOCK_REACT_QUERY) {
    // Only reached if a source file does a RUNTIME import of react-query. The
    // local-first modules use `import type` (erased), so this should stay unused;
    // provided for safety so nothing explodes if that ever changes.
    return {
      format: 'module',
      shortCircuit: true,
      source: `export const QueryClient = class {}; export default {};`,
    };
  }
  return nextLoad(url, context);
}
