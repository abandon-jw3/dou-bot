import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

export async function fingerprint() {
  const digest = async (files: string[]) => {
    const hash = createHash('sha256');
    for (const file of files.sort()) hash.update(file).update(await readFile(file));
    return hash.digest('hex');
  };
  const sdk = (await readdir('src', { recursive: true }))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `src/${file.replaceAll('\\', '/')}`);
  const harness = (await readdir('examples/mixed-benchmark'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `examples/mixed-benchmark/${file}`);
  return {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    sdkSha256: await digest(sdk),
    harnessSha256: await digest(
      harness.concat('examples/benchmark-distributed.ts', 'examples/soak-support.ts'),
    ),
  };
}
