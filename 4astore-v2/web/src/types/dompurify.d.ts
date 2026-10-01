// dompurify 2.x ships without TypeScript types; only the API we use is declared.
declare module 'dompurify' {
  interface SanitizeConfig {
    FORBID_TAGS?: string[];
    FORBID_ATTR?: string[];
    ALLOWED_TAGS?: string[];
    ALLOWED_ATTR?: string[];
    ALLOW_DATA_ATTR?: boolean;
  }
  const DOMPurify: {
    sanitize(dirty: string, config?: SanitizeConfig): string;
    addHook(entry: string, cb: (node: Element) => void): void;
  };
  export default DOMPurify;
}
