import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { repositoryRoot } from './paths.mjs';

/** Check local links and current-branch GitHub links against the local checkout. */
export async function checkDocumentLinks(path, content) {
  if ((content.match(/^\s*```/gm)?.length ?? 0) % 2)
    throw new Error(`Unclosed code fence: ${path}`);
  let links = 0;
  for (const match of content.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
    const target = match[1] ?? match[2];
    if (!target) continue;
    const github = /^https:\/\/github\.com\/abandon-jw3\/dou-bot\/(?:blob|tree)\/main\/(.+)$/u.exec(
      target,
    );
    if (!github && /^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const local = decodeURIComponent((github?.[1] ?? target).split('#')[0].split('?')[0]);
    if (!local) continue;
    await access(resolve(github ? repositoryRoot : dirname(path), local)).catch(() => {
      throw new Error(`Broken document link in ${path}: ${target}`);
    });
    links++;
  }
  return links;
}
