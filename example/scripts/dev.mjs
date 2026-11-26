import { fork, spawn } from 'node:child_process';
import { watch, watchFile, unwatchFile } from 'node:fs';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const STOP = { type: 'dou-bot:dev-stop' };

// Full builds are isolated from the running process, including its late dynamic imports.
export async function startDev({
  root = projectRoot,
  debounceMs = 200,
  shutdownTimeoutMs = 12000,
  log = console.log,
  error = console.error,
} = {}) {
  const work = resolve(root, 'work');
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(join(work, 'dev-'));
  let closed = false;
  let revision = 0;
  let changedAt = 0;
  let requested = false;
  let worker;
  let closing;
  let compiler;
  let running;
  let fallback;
  let timer;
  let wake;
  const watchers = [];

  const remove = (path) =>
    path && rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const pause = (milliseconds) =>
    new Promise((resolveWait) => {
      wake = () => {
        clearTimeout(timer);
        timer = undefined;
        wake = undefined;
        resolveWait();
      };
      timer = setTimeout(wake, milliseconds);
    });
  async function quiet() {
    while (!closed && performance.now() - changedAt < debounceMs)
      await pause(debounceMs - (performance.now() - changedAt));
  }
  function observe(process_, build) {
    const state = {
      process: process_,
      build,
      exited: false,
      stopping: undefined,
      done: undefined,
      ready: false,
    };
    state.done = new Promise((resolveExit) => {
      let settled = false;
      const finish = (code, signal) => {
        if (settled) return;
        settled = true;
        state.exited = true;
        resolveExit({ code, signal });
      };
      process_.once('error', (cause) => {
        error(`[dev] ${cause.message}`);
        finish(1);
      });
      process_.once('exit', finish);
    });
    return state;
  }
  function launch(build) {
    const process_ = fork(join(build, 'main.js'), [], {
      cwd: root,
      execPath: process.execPath,
      execArgv: ['--env-file-if-exists=.env', '--enable-source-maps'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    const state = observe(process_, build);
    process_.on('message', (message) => {
      if (message?.type !== 'dou-bot:dev-ready') return;
      state.ready = true;
      if (state.stopping && process_.connected) process_.send(STOP, () => {});
    });
    running = state;
    log('[dev] 启动机器人。');
    state.done.then(({ code, signal }) => {
      if (!closed && !state.stopping)
        error(`[dev] 机器人已退出（${signal ?? code}），保存文件后重试。`);
    });
  }
  function stop(state) {
    if (!state || state.exited) return Promise.resolve();
    if (state.stopping) return state.stopping;
    // Cooperative IPC works on Windows too; OS SIGTERM there cannot await app.close().
    state.stopping = (async () => {
      const timeout = setTimeout(() => {
        error('[dev] 关闭超时，强制结束旧进程。');
        state.process.kill('SIGKILL');
      }, shutdownTimeoutMs);
      try {
        if (state.ready && state.process.connected) state.process.send(STOP, () => {});
        await state.done;
      } finally {
        clearTimeout(timeout);
      }
    })();
    return state.stopping;
  }
  async function compile() {
    const build = await mkdtemp(join(directory, 'build-'));
    log('[dev] 编译源码……');
    const process_ = spawn(
      process.execPath,
      [
        resolve(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.build.json',
        '--outDir',
        build,
        '--noEmit',
        'false',
        '--noEmitOnError',
        'true',
      ],
      { cwd: root, stdio: 'inherit' },
    );
    const state = observe(process_, build);
    compiler = state;
    if (closed) process_.kill();
    const result = await state.done;
    if (compiler === state) compiler = undefined;
    if (result.code !== 0) {
      await remove(build);
      return;
    }
    try {
      await access(join(build, 'main.js'));
    } catch {
      error('[dev] 构建未生成 main.js，请检查 tsconfig.build.json。');
      await remove(build);
      return;
    }
    return build;
  }
  async function reconcile() {
    while (requested && !closed) {
      await quiet();
      if (closed) break;
      requested = false;
      const current = revision;
      const build = await compile();
      if (closed) {
        await remove(build);
        break;
      }
      if (current !== revision) {
        await remove(build);
        requested = true;
        continue;
      }
      if (!build) {
        error(
          (running && !running.exited) || fallback
            ? '[dev] 编译失败，继续保留上次成功版本。'
            : '[dev] 编译失败，等待修复后启动。',
        );
        // A new edit can arrive while the previous process is already shutting down.
        if (fallback && (!running || running.exited)) {
          launch(fallback);
          fallback = undefined;
        }
        continue;
      }
      const previous = running?.build ?? fallback;
      await stop(running);
      if (closed) {
        await remove(build);
        break;
      }
      if (current !== revision) {
        fallback = previous;
        running = undefined;
        await remove(build);
        requested = true;
        continue;
      }
      launch(build);
      fallback = undefined;
      if (previous !== build) await remove(previous);
    }
  }
  function requestBuild() {
    if (closed) return;
    revision++;
    changedAt = performance.now();
    requested = true;
    wake?.();
    if (!worker) {
      worker = reconcile()
        .catch((cause) => {
          error(`[dev] ${cause.message}`);
          process.exitCode = 1;
          // Do not await the worker from its own rejection handler.
          queueMicrotask(() => close().catch((error_) => error(error_.message)));
        })
        .finally(() => {
          worker = undefined;
        });
    }
  }
  function close() {
    if (closing) return closing;
    closed = true;
    for (const watcher of watchers) watcher.close();
    wake?.();
    if (compiler && !compiler.exited) compiler.process.kill();
    closing = (async () => {
      await stop(running);
      await worker;
      await stop(running);
      await remove(directory);
      log('[dev] 开发监听和机器人已关闭。');
    })();
    return closing;
  }
  try {
    const sources = watch(resolve(root, 'src'), { recursive: true }, requestBuild);
    sources.on('error', (cause) => {
      error(`[dev] 文件监听失败：${cause.message}`);
      process.exitCode = 1;
      close().catch((error_) => error(error_.message));
    });
    watchers.push(sources);
    for (const name of [
      '.env',
      'tsconfig.json',
      'tsconfig.build.json',
      'package.json',
      'package-lock.json',
    ]) {
      const path = resolve(root, name);
      watchFile(path, { interval: 250 }, requestBuild);
      watchers.push({ close: () => unwatchFile(path, requestBuild) });
    }
    log('[dev] 监听 src、配置和 .env；编译成功后重启，Ctrl+C 退出。');
    requestBuild();
    return { close };
  } catch (cause) {
    await close();
    throw cause;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  startDev()
    .then((runner) => {
      const close = () =>
        runner.close().catch((cause) => {
          console.error(cause);
          process.exitCode = 1;
        });
      process.on('SIGINT', close);
      process.on('SIGTERM', close);
    })
    .catch((cause) => {
      console.error(cause);
      process.exitCode = 1;
    });
}
