import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import ts from 'typescript';

const root = process.cwd(),
  docs = resolve(root, 'docs');
async function walk(path) {
  const result = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const target = resolve(path, item.name);
    if (item.isDirectory()) result.push(...(await walk(target)));
    else result.push(target);
  }
  return result;
}
const pages = (await walk(docs)).filter((path) => path.endsWith('.md'));
const required = [
  'Module',
  'Injectable',
  'Inject',
  'Controller',
  'Command',
  'On',
  'OnButton',
  'OnAttachment',
  'Attachments',
  'Images',
  'User',
  'UserId',
  'Group',
  'GroupId',
  'Role',
  'Ctx',
  'Arg',
  'Args',
  'Option',
  'Slot',
  'Rest',
  'UseGuards',
  'GroupOnly',
  'PrivateOnly',
  'UsersOnly',
  'GroupRoles',
  'GroupManagersOnly',
  'Cooldown',
];
const reference = await readFile(resolve(docs, 'api/decorators.md'), 'utf8');
for (const name of required)
  if (!reference.includes(`## ${name} {#${name.toLowerCase()}}`))
    throw new Error(`Missing decorator documentation: ${name}`);
let links = 0,
  includes = 0;
for (const path of pages) {
  const text = await readFile(path, 'utf8');
  if (/https:\/\/github\.com\/abandon-jw3\/(?:dd-bot|dd-bot-example)(?:[\/#)]|$)/u.test(text))
    throw new Error(`Private repository link: ${relative(root, path)}`);
  if (/TODO|待补充|待编写|COMING SOON/u.test(text)) throw new Error(`Unfinished content: ${path}`);
  for (const match of text.matchAll(/^<<<\s+@\/([^\s#]+)(?:#[^\s]+)?/gm)) {
    const target = resolve(docs, match[1]);
    const within = relative(root, target);
    if (within.startsWith('..') || isAbsolute(within))
      throw new Error('Snippet leaves the documentation project');
    await access(target);
    includes++;
  }
  for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const href = match[1].split('#')[0].split('?')[0];
    if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    const target = resolve(
      href.startsWith('/') ? docs : dirname(path),
      href.startsWith('/') ? href.slice(1) : href,
    );
    await access(target).catch(() => {
      throw new Error(`Broken Markdown link: ${path} -> ${href}`);
    });
    links++;
  }
}
const navigation = await readFile('docs/.vitepress/navigation.ts', 'utf8');
for (const match of navigation.matchAll(/['"]?link['"]?\s*:\s*['"](\/[^'"]+)['"]/g))
  await access(resolve(docs, match[1].slice(1) + '.md'));
for (const file of (await walk(resolve(root, 'examples'))).filter((path) => path.endsWith('.ts'))) {
  const text = await readFile(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const spec = node.moduleSpecifier.text;
    if (
      (spec.startsWith('dou-bot/') && spec !== 'dou-bot/testing') ||
      spec.startsWith('dd-bot') ||
      spec.includes('/dd-bot/')
    )
      throw new Error(`Non-public SDK import: ${file}`);
  }
}
console.log(
  `Content verified: ${pages.length} pages, ${required.length} decorators, ${links} links, ${includes} source includes.`,
);
