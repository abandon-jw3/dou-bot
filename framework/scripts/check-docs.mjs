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
}
console.log(`Documents checked: ${documents.length} Markdown files and ${links} local links.`);
