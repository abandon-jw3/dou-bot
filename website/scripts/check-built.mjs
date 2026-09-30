import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';

const root = resolve('docs/.vitepress/dist');
const base = '/dou-bot/';
async function htmlFiles(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) result.push(...(await htmlFiles(path)));
    else if (path.endsWith('.html')) result.push(path);
  }
  return result;
}
const files = await htmlFiles(root),
  cache = new Map();
const decode = (text) =>
  text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
let checked = 0;
for (const file of files) {
  const html = await readFile(file, 'utf8');
  cache.set(file, html);
  const current = 'https://docs.invalid' + base + relative(root, file).replaceAll('\\', '/');
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = decode(match[1]);
    if (
      !href ||
      href.startsWith('data:') ||
      href.startsWith('mailto:') ||
      href.startsWith('javascript:')
    )
      continue;
    const url = new URL(href, current);
    if (url.origin !== 'https://docs.invalid') continue;
    if (!url.pathname.startsWith(base)) throw new Error(`Link escapes Pages base: ${href}`);
    const local = decodeURIComponent(url.pathname.slice(base.length));
    const target = resolve(root, local + (url.pathname.endsWith('/') ? 'index.html' : ''));
    await access(target).catch(() => {
      throw new Error(`Missing built target: ${relative(root, file)} -> ${href}`);
    });
    if (url.hash && target.endsWith('.html')) {
      const content = cache.get(target) ?? (await readFile(target, 'utf8'));
      cache.set(target, content);
      const anchor = decodeURIComponent(url.hash.slice(1));
      if (!content.includes(`id="${anchor}"`))
        throw new Error(`Missing anchor: ${relative(root, file)} -> ${href}`);
    }
    checked++;
  }
}
console.log(
  `Static site verified: ${files.length} HTML pages, ${checked} local links/assets, Pages base and anchors intact.`,
);
