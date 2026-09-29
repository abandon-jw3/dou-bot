import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { root } from './paths.mjs';

const documents = [
  'README.md',
  ...(await readdir(resolve(root, 'docs')))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
];
let links = 0;
for (const name of documents) {
  const path = resolve(root, name);
  const content = await readFile(path, 'utf8');
  if ((content.match(/^\s*```/gm)?.length ?? 0) % 2)
    throw new Error(`Unclosed code fence: ${name}`);
  for (const match of content.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
    const target = match[1] ?? match[2];
    if (!target || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const local = decodeURIComponent(target.split('#')[0].split('?')[0]);
    if (!local) continue;
    await access(resolve(dirname(path), local)).catch(() => {
      throw new Error(`Broken document link in ${name}: ${target}`);
    });
    links++;
  }
  if (name === 'docs/development-plan.md') {
    const sections = [...content.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]));
    if (sections.length !== 20 || sections.some((value, index) => value !== index + 1))
      throw new Error('The development plan must retain its 20 numbered sections');
  }
}
console.log(`Documents checked: ${documents.length} Markdown files and ${links} local links.`);
