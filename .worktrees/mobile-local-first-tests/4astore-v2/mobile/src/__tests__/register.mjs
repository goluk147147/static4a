// Registers the custom resolve/load hooks (loader.mjs) for the test run.
// Used via: node --import ./src/__tests__/register.mjs --test ...
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./loader.mjs', pathToFileURL(import.meta.dirname + '/').href);
