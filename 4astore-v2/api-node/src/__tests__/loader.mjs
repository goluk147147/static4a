// Minimal ESM load hook so Node's built-in test runner can execute the TypeScript
// test + source files WITHOUT a bundler or ts-node runtime. It transpiles any
// local .ts/.tsx file on the fly with the already-installed `typescript`
// compiler (devDependency) to CommonJS-interop ESM. ZERO new dependencies.
//
// Node 20 cannot strip TS types natively, so we compile here. Pure-logic tests
// that import only type-light modules (e.g. routes/catalogSelect.ts, whose only
// non-type import is erased) run in plain Node with no DB and no Express.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export async function load(url, context, nextLoad) {
  if (url.startsWith('file://') && /\.tsx?$/.test(url)) {
    const path = fileURLToPath(url);
    const source = await readFile(path, 'utf8');
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        isolatedModules: true,
        verbatimModuleSyntax: false,
      },
      fileName: path,
    });
    return { format: 'module', shortCircuit: true, source: out.outputText };
  }
  return nextLoad(url, context);
}

export async function resolve(specifier, context, nextResolve) {
  // Allow extensionless relative imports between our .ts files (../routes/catalogSelect).
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {
      /* fall through to default resolution */
    }
  }
  return nextResolve(specifier, context);
}
