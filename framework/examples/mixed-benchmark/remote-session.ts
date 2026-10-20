import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { promisify } from 'node:util';
import { record } from './common.js';
import { receiveFrames, sendFrame } from './frames.js';
import { Mailbox } from './worker.js';
import type { Message } from './worker.js';

const execute = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export interface RemoteSettings {
  host?: string;
  directory: string;
  node: string;
  entry: string;
  label: string;
  token: string;
  runtimeSeconds: number;
}

/** One SSH master carries control and a loopback-only input tunnel. Downstream fixtures stay beside the SDK. */
export class RemoteSession {
  readonly sdk = new Mailbox();
  readonly fixture = new Mailbox();
  readonly control = new Mailbox();
  readonly unit: string;
  readonly output: string;
  readonly exited: Promise<void>;
  private directory?: string;
  private socket?: string;
  private child!: ChildProcess;
  private detach?: () => void;
  private finish!: () => void;
  private closing?: Promise<void>;
  private constructor(readonly settings: RemoteSettings) {
    assert.match(settings.label, /^[a-z0-9-]{1,40}$/u);
    this.unit = `dou-bot-capacity-compare-${settings.label}-${randomBytes(3).toString('hex')}.service`;
    this.output = settings.host
      ? posix.join(settings.directory, 'work/distributed', settings.label)
      : resolve('work/distributed', settings.label);
    this.exited = new Promise((resolve) => {
      this.finish = resolve;
    });
  }
  static async create(settings: RemoteSettings): Promise<RemoteSession> {
    const session = new RemoteSession(settings);
    try {
      await session.start();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
  private async ssh(args: string[]) {
    assert.ok(this.settings.host && this.socket);
    return execute(
      'ssh',
      [
        '-T',
        '-S',
        this.socket,
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        ...args,
        this.settings.host,
      ],
      { timeout: 20000, maxBuffer: 1048576 },
    );
  }
  private async command(args: string[]) {
    assert.ok(this.settings.host && this.socket);
    return execute(
      'ssh',
      [
        '-T',
        '-S',
        this.socket,
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        this.settings.host,
        args.map(quote).join(' '),
      ],
      { timeout: 20000, maxBuffer: 1048576 },
    );
  }
  private async start(): Promise<void> {
    let executable = process.execPath;
    let args = ['--expose-gc', this.settings.entry, '--host', this.settings.token, this.output];
    if (this.settings.host) {
      assert.match(this.settings.host, /^[a-zA-Z0-9_.@-]+$/u);
      assert.ok(posix.isAbsolute(this.settings.directory));
      this.directory = await mkdtemp(join(tmpdir(), 'dou-cmp-'));
      this.socket = join(this.directory, 'ssh');
      await this.ssh([
        '-MNf',
        '-o',
        'ControlPersist=30',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=10',
        '-o',
        'ServerAliveCountMax=3',
      ]);
      const command = [
        'systemd-run',
        '--quiet',
        '--wait',
        '--pipe',
        `--unit=${this.unit}`,
        '--property=MemoryMax=1024M',
        '--property=MemorySwapMax=0',
        '--property=CPUQuota=150%',
        '--property=CPUWeight=20',
        '--property=Nice=10',
        '--property=KillMode=mixed',
        '--property=IPAddressDeny=any',
        '--property=IPAddressAllow=localhost',
        `--property=RuntimeMaxSec=${this.settings.runtimeSeconds}`,
        '--property=TimeoutStopSec=20',
        `--property=WorkingDirectory=${this.settings.directory}`,
        this.settings.node,
        '--expose-gc',
        posix.join(
          this.settings.directory,
          'work/distributed-build/examples/mixed-benchmark/remote-host.js',
        ),
        '--host',
        this.settings.token,
        this.output,
      ];
      executable = 'ssh';
      args = [
        '-T',
        '-S',
        this.socket,
        '-o',
        'BatchMode=yes',
        this.settings.host,
        command.map(quote).join(' '),
      ];
    }
    this.child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    const fail = (error: Error) => {
      this.sdk.fail(error);
      this.fixture.fail(error);
      this.control.fail(error);
    };
    this.child.on('error', fail);
    this.child.stdin!.on('error', fail);
    this.detach = receiveFrames(
      this.child.stdout!,
      (frame) => {
        assert.ok(record(frame.message));
        const mailbox =
          frame.role === 'sdk'
            ? this.sdk
            : frame.role === 'fixture'
              ? this.fixture
              : frame.role === 'control'
                ? this.control
                : undefined;
        assert.ok(mailbox, 'Unknown remote control channel');
        if (frame.message.type === 'worker-exit')
          mailbox.fail(
            new Error(`Remote ${String(frame.role)} exited ${String(frame.message.code)}`),
          );
        else mailbox.deliver(frame.message);
      },
      fail,
    );
    this.child.once('close', (code, signal) => {
      fail(new Error(`Remote host exited ${code ?? signal}`));
      this.finish();
    });
    // A multiplexing SSH master may still hold the child's stdout descriptor after exit.
    // Waiting for pipe EOF during failure cleanup can otherwise outlive the remote job.
    this.child.once('exit', () => this.finish());
  }
  send(role: 'sdk' | 'fixture' | 'control', message: Message): void {
    if (this.child.stdin?.writable) sendFrame(this.child.stdin, { role, message });
  }
  async forward(origin: string): Promise<string> {
    const url = new URL(origin);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.protocol, 'http:');
    assert.ok(Number(url.port) > 0);
    if (!this.settings.host) return origin;
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    await this.ssh([
      '-O',
      'forward',
      '-o',
      'ExitOnForwardFailure=yes',
      '-L',
      `127.0.0.1:${address.port}:127.0.0.1:${url.port}`,
    ]);
    return `http://127.0.0.1:${address.port}`;
  }
  async report(name: 'sdk' | 'fixture', notice: Message, target: string): Promise<unknown> {
    const source = this.settings.host
      ? posix.join(this.output, `${name}.json`)
      : resolve(this.output, `${name}.json`);
    assert.equal(notice.reportPath, source);
    if (this.settings.host) {
      await execute(
        'scp',
        [
          '-q',
          '-o',
          'BatchMode=yes',
          '-o',
          `ControlPath=${this.socket!}`,
          `${this.settings.host}:${source}`,
          target,
        ],
        { timeout: 30000, maxBuffer: 1048576 },
      );
    } else assert.equal(resolve(source), resolve(target));
    return JSON.parse(await readFile(target, 'utf8')) as unknown;
  }
  get exitCode(): number | null {
    return this.child?.exitCode ?? null;
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      if (this.child) {
        this.send('control', { type: 'stop' });
        this.child.stdin?.end();
        const wait = async (milliseconds: number) => {
          let timer: NodeJS.Timeout | undefined;
          try {
            return await Promise.race([
              this.exited.then(() => true),
              new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), milliseconds);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };
        if (!(await wait(5000))) {
          if (this.settings.host && this.socket)
            await this.command(['systemctl', 'stop', this.unit]).catch(() => {});
          if (!(await wait(5000))) {
            this.child.kill('SIGKILL');
            await wait(5000);
          }
        }
        this.detach?.();
        this.child.stdin?.destroy();
        this.child.stdout?.destroy();
      }
      if (this.settings.host && this.socket) {
        await this.command(['systemctl', 'stop', this.unit]).catch(() => {});
        await this.ssh(['-O', 'exit']).catch(() => {});
      }
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
    })();
    return this.closing;
  }
}
