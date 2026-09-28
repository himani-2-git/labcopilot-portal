import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');
const sourceFile = path.join(sourceRoot, 'index.ts');
const dist = path.join(root, 'dist');
const temporary = path.join(root, '.build');

rmSync(dist, { recursive: true, force: true });
rmSync(temporary, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

function compile(outDir, options) {
  const program = ts.createProgram([sourceFile], {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    noUncheckedIndexedAccess: true,
    rootDir: sourceRoot,
    outDir,
    ...options,
  });
  const result = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
  if (diagnostics.length) {
    const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    });
    throw new Error(message);
  }
}

const esm = path.join(temporary, 'esm');
const cjs = path.join(temporary, 'cjs');
const types = path.join(temporary, 'types');
compile(esm, { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
compile(cjs, { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 });
compile(types, { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, declaration: true, emitDeclarationOnly: true });

copyFileSync(path.join(esm, 'index.js'), path.join(dist, 'index.js'));
copyFileSync(path.join(cjs, 'index.js'), path.join(dist, 'index.cjs'));
copyFileSync(path.join(types, 'index.d.ts'), path.join(dist, 'index.d.ts'));
rmSync(temporary, { recursive: true, force: true });
console.log('Built shared contracts without bundling dependencies.');
