import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { root } from './paths.mjs';

const configuration = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
if (configuration.error) throw new Error('Cannot read the API check compiler configuration');
const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
const sourceProgram = ts.createProgram(parsed.fileNames, parsed.options);
const checker = sourceProgram.getTypeChecker();
const entries = [
  ['root', 'src/index.ts', 'docs/public-api.d.ts'],
  ['testing', 'src/testing/index.ts', 'docs/testing-api.d.ts'],
];
const checks = [];
let types = 0;
let exports = 0;
for (const [entry, actualPath, contractPath] of entries) {
  const symbols = (path) => {
    const file = sourceProgram.getSourceFile(resolve(root, path));
    const module = file && checker.getSymbolAtLocation(file);
    if (!module) throw new Error(`Cannot load API entry: ${path}`);
    return new Map(
      checker
        .getExportsOfModule(module)
        .map((symbol) => [
          symbol.name,
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
        ]),
    );
  };
  const actual = symbols(actualPath);
  const contract = symbols(contractPath);
  const missing = [...contract.keys()].filter((name) => !actual.has(name));
  const extra = [...actual.keys()].filter((name) => !contract.has(name));
  if (missing.length || extra.length)
    throw new Error(`${entry} export mismatch: missing [${missing}], undeclared [${extra}]`);
  exports += actual.size;
  checks.push(
    `import type * as Actual_${entry} from '../../${actualPath.replace(/\.ts$/, '.js')}';`,
    `import type * as Contract_${entry} from '../../${contractPath.replace(/\.d\.ts$/, '.js')}';`,
  );
  for (const [name, symbol] of contract) {
    if (!(symbol.flags & ts.SymbolFlags.Type)) continue;
    const declaration = symbol.declarations?.find(
      (node) =>
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node),
    );
    const parameters = declaration?.typeParameters ?? [];
    const generic = parameters.length
      ? `<${parameters.map((node) => node.getText()).join(', ')}>`
      : '';
    const arguments_ = parameters.length
      ? `<${parameters.map((node) => node.name.text).join(', ')}>`
      : '';
    const a = `Actual_${entry}.${name}${arguments_}`;
    const b = `Contract_${entry}.${name}${arguments_}`;
    // Bind the same generic parameter on both sides; comparing unbound T symbols is incorrect.
    checks.push(
      `export function ${entry}_${name}_forward${generic}(value: ${a}): ${b} { return value; }`,
      `export function ${entry}_${name}_reverse${generic}(value: ${b}): ${a} { return value; }`,
    );
    types++;
  }
}
const directory = resolve(root, 'work/api-contract-check');
await mkdir(directory, { recursive: true });
const generated = resolve(directory, 'types.ts');
await writeFile(generated, checks.join('\n') + '\n');
const program = ts.createProgram([...parsed.fileNames, generated], parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
console.log(
  `Public API contracts verified: ${exports} exports, ${types} bidirectional type checks, root and testing entries.`,
);
