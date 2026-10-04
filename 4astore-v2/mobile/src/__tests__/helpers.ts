// Shared helpers for the local-first store tests.
//
// The in-memory mocks for '@react-native-async-storage/async-storage' and '../api'
// live in loader.mjs and expose their state on globalThis.__mockStore and
// globalThis.__mockApi. These helpers reset and inspect that state between tests.

interface MockApiCalls {
  get: number;
  post: number;
  getPaths: string[];
  postPaths: string[];
  postBodies: unknown[];
}
interface MockApi {
  calls: MockApiCalls;
  getImpl: (path: string, params?: unknown) => Promise<unknown>;
  postImpl: (path: string, body?: unknown) => Promise<unknown>;
}

function store(): Map<string, string> {
  const g = globalThis as unknown as { __mockStore?: Map<string, string> };
  g.__mockStore ||= new Map();
  return g.__mockStore;
}

function mockApi(): MockApi {
  const g = globalThis as unknown as { __mockApi?: MockApi };
  if (!g.__mockApi) {
    g.__mockApi = {
      calls: { get: 0, post: 0, getPaths: [], postPaths: [], postBodies: [] },
      getImpl: async () => ({}),
      postImpl: async () => ({}),
    };
  }
  return g.__mockApi;
}

/** Reset AsyncStorage + the api mock to a clean slate. Call in beforeEach. */
export function resetMocks(): void {
  store().clear();
  const m = mockApi();
  m.calls.get = 0;
  m.calls.post = 0;
  m.calls.getPaths = [];
  m.calls.postPaths = [];
  m.calls.postBodies = [];
  m.getImpl = async () => ({});
  m.postImpl = async () => ({});
}

/** Call counts recorded by the api mock. */
export function apiCalls(): MockApiCalls {
  return mockApi().calls;
}

/** Make api.get return the given value for this test. */
export function setGet(fn: (path: string, params?: unknown) => Promise<unknown>): void {
  mockApi().getImpl = fn;
}

/** Make api.post return the given value for this test. */
export function setPost(fn: (path: string, body?: unknown) => Promise<unknown>): void {
  mockApi().postImpl = fn;
}

/** Directly seed a raw string under a storage key (used to simulate corrupt JSON). */
export function seedRaw(key: string, raw: string): void {
  store().set(key, raw);
}

/** Read a raw string straight out of the mock storage. */
export function readRaw(key: string): string | undefined {
  return store().get(key);
}
