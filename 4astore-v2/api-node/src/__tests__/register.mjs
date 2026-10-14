// Registers the on-the-fly TypeScript load/resolve hooks (loader.mjs) for the
// api-node test run. Used via:
//   node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./loader.mjs', pathToFileURL(import.meta.dirname + '/').href);
