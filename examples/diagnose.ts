import { BotFactory, FrameworkError, Module, QQApiError } from '../src/index.js';

@Module({})
class ProbeModule {}

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('Set QQ_APP_ID and QQ_APP_SECRET locally.');
const mode = process.argv[2] ?? 'auth';
if (mode !== 'auth' && mode !== 'ws') throw new Error('Diagnostic mode must be auth or ws.');
const errors: {
  code: string;
  message?: string;
  qqCode?: number | string;
  httpStatus?: number;
  phase?: string;
}[] = [];
const report = (error: unknown, phase?: string) => {
  errors.push({
    code: error instanceof FrameworkError ? error.code : 'ERROR',
    ...((phase && error instanceof Error) || error instanceof FrameworkError
      ? { message: error.message.split(secret).join('[redacted]') }
      : {}),
    ...(error instanceof QQApiError && error.qqCode !== undefined ? { qqCode: error.qqCode } : {}),
    ...(error instanceof QQApiError && error.httpStatus !== undefined
      ? { httpStatus: error.httpStatus }
      : {}),
    ...(phase ? { phase } : {}),
  });
};
const app = await BotFactory.create(ProbeModule, {
  appId,
  secret,
  // No message handlers. A caller can choose the QQ intent mask for this probe.
  transport: {
    type: 'ws',
    intents: Number(process.argv[3] ?? (1 << 25) | (1 << 26)),
    connectTimeoutMs: 15000,
    closeTimeoutMs: 500,
    retry: { initialAttempts: 1 },
  },
  execution: { shutdownTimeoutMs: 5000 },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  onError: (error, context) => report(error, context.phase),
});
const result: {
  mode: string;
  gateway: boolean;
  gatewayHost?: string;
  wsReady: boolean;
  errors: typeof errors;
} = { mode, gateway: false, wsReady: false, errors };
try {
  if (mode === 'ws') {
    await app.start();
    result.wsReady = true;
    result.gateway = true;
  } else {
    const gateway = await app.client.api.getGateway();
    result.gateway = true;
    result.gatewayHost = new URL(gateway.url).host;
  }
} catch (error) {
  report(error);
  process.exitCode = 1;
} finally {
  await app.close().catch((error: unknown) => {
    report(error, 'shutdown');
    process.exitCode = 1;
  });
  console.log(JSON.stringify(result));
}
