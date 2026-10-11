import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from './paths.mjs';
import { checkDocumentLinks } from './document-links.mjs';

async function skillDocuments(directory) {
  const names = [];
  for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${item.name}`;
    if (item.isDirectory()) names.push(...(await skillDocuments(name)));
    else if (item.isFile() && item.name.endsWith('.md')) names.push(name);
  }
  return names;
}

const documents = [
  'README.md',
  ...(await readdir(resolve(root, 'docs')))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
  ...(await skillDocuments('skills')),
];
let links = 0;
for (const name of documents) {
  const path = resolve(root, name);
  const content = await readFile(path, 'utf8');
  links += await checkDocumentLinks(path, content);
  if (name === 'docs/development-plan.md') {
    const sections = [...content.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]));
    if (sections.length !== 20 || sections.some((value, index) => value !== index + 1))
      throw new Error('The development plan must retain its 20 numbered sections');
  }
}
console.log(`Documents checked: ${documents.length} Markdown files and ${links} local links.`);
