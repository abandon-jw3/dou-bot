import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
for (const enabled of [false, true]) {
  await test(`a retained diagnostics reader does not retain a closed application (enabled=${enabled})`, async () => {
    const source = `
      import {setImmediate as tick} from 'node:timers/promises';
      import {Module} from ${JSON.stringify(new URL('../src/index.js', import.meta.url).href)};
      import {Application} from ${JSON.stringify(new URL('../src/core/application.js', import.meta.url).href)};
      import {MemoryPersistence} from ${JSON.stringify(new URL('../src/testing/memory-persistence.js', import.meta.url).href)};
      class Root {} Module({})(Root);
      async function create() {
        let app;
        app = await Application.create(Root, {
          database: {host:'127.0.0.1',user:'offline',password:'',database:'offline'},
          bots: [{appId:'fixture',secret:'fixture'}],
          diagnostics: {enabled:${enabled},onSpans(){void app;}},
        }, {
          persistence:new MemoryPersistence(),
          transport:()=>({start:()=>Promise.resolve(),stop:()=>Promise.resolve()}),
        });
        await app.close();
        return {reader:app.diagnostics,reference:new WeakRef(app)};
      }
      const {reader,reference} = await create();
      let collected=false;
      for(let index=0;index<30;index++) {
        await tick();global.gc();
        if(reference.deref()===undefined){collected=true;break;}
      }
      console.log(JSON.stringify({collected,closed:reader.snapshot().closed}));
    `;
    const { stdout } = await execute(
      process.execPath,
      ['--expose-gc', '--input-type=module', '-e', source],
      { timeout: 10000, maxBuffer: 65536 },
    );
    assert.deepEqual(JSON.parse(stdout) as unknown, { collected: true, closed: true });
  });
}
