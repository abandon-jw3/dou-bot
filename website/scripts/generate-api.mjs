import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { format } from 'prettier';

const root = process.cwd();
const project = JSON.parse(await readFile('package.json', 'utf8'));
const sdk = JSON.parse(await readFile('node_modules/dou-bot/package.json', 'utf8'));
if (
  sdk.name !== 'dou-bot' ||
  sdk.version !== '0.6.0' ||
  project.devDependencies['dou-bot'] !== sdk.version
)
  throw new Error('API documentation must use the installed, pinned dou-bot@0.6.0');
const entries = [
  ['dou-bot', 'dist/index.d.ts'],
  ['dou-bot/testing', 'dist/testing/index.d.ts'],
];
const paths = entries.map(([, path]) => resolve(root, 'node_modules/dou-bot', path));
const program = ts.createProgram(paths, {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: ['node'],
  strict: true,
});
const checker = program.getTypeChecker();
let body =
  '# 类型与接口\n\n在这里查阅 dou-bot **0.6.0** 的函数签名、配置字段与返回类型。编写业务时从 `dou-bot` 导入，编写离线测试时从 `dou-bot/testing` 导入；需要了解用法时，先看 [装饰器参考](./decorators.md) 或 [完整示例](../examples/hello.md)。\n\n';
let count = 0;
for (let i = 0; i < entries.length; i++) {
  const file = program.getSourceFile(paths[i]);
  const symbol = file && checker.getSymbolAtLocation(file);
  if (!symbol) throw new Error('Cannot load published declarations');
  const exports = checker
    .getExportsOfModule(symbol)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  body += `## ${entries[i][0]}\n\n${i === 0 ? '业务开发使用的装饰器、应用、消息工具与类型。' : '在本地运行模块、投递模拟事件并检查处理结果的测试工具与类型。'}\n\n`;
  for (const exported of exports) {
    const actual =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const declaration = actual.declarations?.[0];
    if (!declaration) throw new Error(`Missing declaration: ${exported.name}`);
    body += `### ${exported.name} {#${i === 0 ? 'root' : 'testing'}-${exported.name}}\n\n`;
    if (exported.name === 'TestHarness') {
      body +=
        '提供 app、messages、acknowledgments、errors、enqueue、dispatch 和 flush。接纳结果为结构化返回值，详情见 [测试入口 API](./testing.md#testharness)。\n\n';
    } else {
      let text = declaration.getText();
      if (ts.isVariableDeclaration(declaration)) text = `export declare const ${text};`;
      body += '```ts\n' + text + '\n```\n\n';
    }
    count++;
  }
}
const options = JSON.parse(await readFile('.prettierrc.json', 'utf8'));
const formatted = await format(body, { ...options, parser: 'markdown' });
const target = 'docs/api/types.md';
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')) !== formatted)
    throw new Error('API reference is out of date; run npm run api:generate');
} else await writeFile(target, formatted);
console.log(`Published API reference verified: ${count} exports from dou-bot@${sdk.version}.`);
