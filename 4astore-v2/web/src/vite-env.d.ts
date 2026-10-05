/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  // Optional social-login credentials; default to '' when unset (build-safe).
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_FACEBOOK_APP_ID?: string;
  readonly VITE_INSTAGRAM_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
