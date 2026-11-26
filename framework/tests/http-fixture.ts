import type { Type } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestOptions } from '../src/testing/index.js';
import { SingleTestApplication } from '../src/testing/single-bot.js';

/** HTTP unit tests intentionally bypass application admission to isolate token/payload contracts. */
export async function createHttpFixture(root: Type, options?: TestOptions) {
  const h = await createTestApplication(root, options);
  const app = h.app as SingleTestApplication;
  return {
    ...h,
    app: {
      client: app.runtime.rawClient,
      close: () => app.close(),
      start: () => app.start(),
    },
  };
}
