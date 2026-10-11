# 上下文中间件与数据注入

仓库中的源码示例和验证命令在 framework 目录执行；独立业务项目仍使用自己的项目目录。

**源码契约 1.13，尚未发布。npm 0.7.0 不包含本页 API。**

上下文中间件在每次处理器执行前准备数据。它支持异步准备和按需加载，不提供 next、短路、消息回复或业务默认值规则。数据库访问和业务字段处理由应用自行实现。

## 定义与注册

```ts
import {
  Command,
  Controller,
  ContextValue,
  createContextKey,
  Injectable,
  Module,
  UseMiddleware,
} from 'dou-bot';
import type { ContextMiddleware, MiddlewareContext } from 'dou-bot';

const ROUTE_LABEL = createContextKey<string>('route.label');

@Injectable()
class RouteLabel implements ContextMiddleware {
  prepare(ctx: MiddlewareContext): void {
    ctx.state.provide(ROUTE_LABEL, (signal) => {
      signal.throwIfAborted();
      return `${ctx.route}:${ctx.scene}`;
    });
  }
}

@Controller()
@UseMiddleware(RouteLabel)
class Commands {
  @Command('context')
  context(@ContextValue(ROUTE_LABEL) label: string): string {
    return label;
  }
}

@Module({ controllers: [Commands], providers: [RouteLabel] })
class Root {}
```

prepare 返回 void 或 Promise<void>，框架顺序等待完成。中间件可通过构造函数注入普通业务 Service；仍按模块可见性解析，默认单例，不把当前执行的数据放进实例字段。

使用 `@UseMiddleware(A, B)` 挂载控制器或方法，或在 `@Module({ middlewares: [A, B] })` 中声明。模块类本身也可以使用 UseMiddleware。顺序为模块配置 → 模块类（基类到派生类）→ 控制器类（基类到派生类）→ 方法；列表从左到右，多次装饰按源码从上到下，不自动去重。覆写方法时沿用已有路由继承规则。

模块声明只作用于自己的 controllers，不传播到 imports。应用启动时校验所有中间件的 Provider 令牌及 prepare 方法，包括没有控制器的模块；不在启动时执行 prepare。中间件仅用于 Command、OnButton、OnAttachment。类级声明不影响原始 On；在 On 或非路由方法上直接声明会报 CONFIG。

## 数据注册与消费

| API                              | 行为                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `createContextKey<T>(name)`      | 创建冻结的不透明 Key；名称仅用于诊断，同名 Key 是不同身份 |
| `ctx.state.set(KEY, value)`      | 在 prepare 内注册已完成的值，不接受 Promise/thenable      |
| `ctx.state.provide(KEY, loader)` | 在 prepare 内注册加载器，注册本身不执行 loader            |
| `await ctx.state.get(KEY)`       | 读取完整值，返回类型由 Key 决定                           |
| `@ContextValue(KEY)`             | 将完整值异步注入处理器参数                                |

Key 名称必须是非空单行字符串。保存并导出同一个 Key 供各模块复用，不要在每次读取时重新创建。Key 的类型成员仅作静态品牌标记，不是运行时字段；不要通过类型断言伪造令牌。

首次 get 启动加载，后续及并发 get 返回同一个 Promise；成功、undefined 和失败都缓存，不自动重试。不同 Key 的加载可并发开始。相同 Key 重复 set/provide 报 HANDLER_CONTRACT，不允许静默覆盖。未注册 Key 也报 HANDLER_CONTRACT；允许缺失数据时，使用 `ContextKey<T | undefined>` 并明确注册结果或加载器。

MessageContext、ButtonContext 和 GuardContext 的 state 都只有 get。MiddlewareContext 额外提供 set/provide，并包含当前场景、身份、处理器和路由信息；不提供 client、reply、send、ack 或 prompt。Guard 可按需读取同一份数据。

例如在异步处理器中手动消费：

```ts
const first = ctx.state.get(ROUTE_LABEL);
const second = ctx.state.get(ROUTE_LABEL);
// first === second，加载器最多执行一次。
const label = await first;
```

每个 prepare 完成后立即撤销它的写权限，即使后续中间件仍在运行也不能继续写入。框架冻结 Context 和存储接口，不深拷贝或深冻结业务值；需要不可变数据时，由应用返回只读值。Key 不会改变现有 User/UserId/Role 的 QQ 身份含义。

### set：注册已准备好的数据

当数据已经拿到，或需要在后续流程开始前准备好时，在中间件的 prepare 中调用 `set`：

```ts
import { createContextKey, Injectable } from 'dou-bot';
import type { ContextMiddleware, MiddlewareContext } from 'dou-bot';

interface ExecutionInfo {
  readonly route: string;
  readonly scene: 'group' | 'private';
}

export const EXECUTION_INFO = createContextKey<ExecutionInfo>('execution.info');

@Injectable()
export class ExecutionInfoMiddleware implements ContextMiddleware {
  prepare(ctx: MiddlewareContext): void {
    ctx.state.set(
      EXECUTION_INFO,
      Object.freeze({
        route: ctx.route,
        scene: ctx.scene,
      }),
    );
  }
}
```

将 ExecutionInfoMiddleware 注册为 Provider，再通过 UseMiddleware 或模块 middlewares 挂载。随后 Guard 或处理器可以读取：

```ts
const info = await ctx.state.get(EXECUTION_INFO);
// info 的类型为 ExecutionInfo，拿到的就是 set 注册的对象。
```

也可以在处理器参数上直接注入：

```ts
@Command('context')
context(@ContextValue(EXECUTION_INFO) info: ExecutionInfo): string {
  return `${info.route}:${info.scene}`;
}
```

set 自身同步返回 void，无需 await；get 统一返回 Promise，因此读取时仍需 await。set 的含义是注册本次执行的数据，不是更新操作：同一个 Key 不能重复 set，也不能同时 set 和 provide。允许保存 `0`、`false`、空字符串，以及 Key 类型允许的 undefined。

### 异步 prepare：先等待，再 set

如果准备数据需要异步操作，先 await 获取结果，再注册值。下面的 `loadLabel` 代表应用自己的异步函数，返回 Promise<string>，不是 SDK 内置 API：

```ts
async prepare(ctx: MiddlewareContext): Promise<void> {
  const label = await loadLabel(ctx.route, ctx.signal);
  ctx.state.set(ROUTE_LABEL, label);
}
```

框架会等待整个 prepare 完成，再执行后续中间件和 Guard。不要直接写 `ctx.state.set(ROUTE_LABEL, loadLabel(...))`：set 不接受 Promise/thenable。也不要启动异步操作后提前返回，等回调到达时 prepare 的写权限已经失效。

### 选择 set 还是 provide

| 场景                 | 使用方式                               | 实际执行时间                          |
| -------------------- | -------------------------------------- | ------------------------------------- |
| 已有可用数据         | `set(KEY, value)`                      | prepare 中直接注册                    |
| 必须提前准备异步数据 | `set(KEY, await load(...))`            | 每次执行 prepare 时加载，完成后才继续 |
| 只有需要时才加载     | `provide(KEY, signal => load(signal))` | 首次 get 或 ContextValue 消费时加载   |

注册后，两者都通过 get 或 ContextValue 消费。set/provide 只存在于中间件的可写 state；处理器里通过 `@Ctx()` 获取的 MessageContext 或 ButtonContext，以及 GuardContext，都只提供 get。

## 执行顺序与生命周期

执行顺序：匹配处理器 → 中间件准备 → Guard → 原有文字解析及 normalize、附件校验、身份注入 → ContextValue 按参数位置顺序读取 → 冷却 → 处理器。

ContextValue 不消费文字、不启用严格文字模式，也不出现在帮助中。它仅支持命令、按钮和附件处理器，不能用于构造参数或原始 On；同一参数仍只能声明一个来源。多个参数读取相同 Key 共用加载结果。

数据按一次处理器执行隔离。不同用户、不同调用以及同条消息匹配的多个附件处理器，均拥有独立存储。多个附件处理器保持顺序执行，一个失败不阻止其余处理器。prompt 属于原流程，返回消息的 state 与原 Context 相同，不重新运行中间件。独立的新消息重新创建存储。

只注册而未读取的加载器永不执行。首次实际加载计入 execution.maxContextOperations，缓存读取和已完成值不重复计数。未等待的加载仍受跟踪，处理器返回后先禁止新读取，再按既有收尾机制等待已启动操作；执行结束释放存储引用。迟到读取或写入报 INVALID_STATE。

加载器应使用它收到的 signal。prepare 的 ctx.signal 只在本次准备期间有效，不能把它捕获到延迟加载器中继续使用。框架会在操作结束、超时或应用关闭时取消对应信号；信号已接入 QQ 客户端的关闭排空管理。数据库驱动或其他异步服务也需要配合取消，框架无法硬终止任意 JavaScript。

## 超时、资源与错误

```ts
const options = {
  context: {
    prepareTimeoutMs: 10000,
    loadTimeoutMs: 10000,
    maxEntries: 64,
  },
};
```

以上为默认值。三个选项均为 1～2147483647 的整数。prepareTimeoutMs 分别限制每个 prepare，loadTimeoutMs 从每个加载器的首次读取开始计时。maxEntries 限制每次执行的注册 Key 数量；越界报 RESOURCE_LIMIT。框架不构建加载器依赖图，循环等待由超时终止。

超时报 CONTEXT_TIMEOUT；准备错误阶段为 middleware，读取错误阶段为 context。同一次加载失败只上报一次，继续沿用已有错误脱敏；即使业务 catch 了受管读取失败，也不会取消其 onError 记录。非法注册、错误的 prepare 返回值等报 HANDLER_CONTRACT，声明错误报 CONFIG 或 DEPENDENCY。

中间件不能返回 false、消息或其他结果控制后续流程。准备或参数注入失败会停止当前处理，不占冷却，也不因 invalidInput=reply 自动回显；处理器开始后读取失败不退还已经占用的冷却。按钮确认行为保持不变。

## 源码验证与升级

在框架源码仓库运行 `npm run example:context` 查看通用离线演示。它不读取凭证、不连接数据库或真实 QQ。该功能没有增加运行依赖，也没有提供业务用户装饰器、DefaultFrom 或业务缓存策略。

本次为公开上下文接口增加 state，并扩展 ErrorPhase 和 FrameworkErrorCode 的联合类型。自行构造 Context 测试对象时需要提供 reader；错误阶段的穷尽判断需要补充 middleware/context，错误码判断需要补充 CONTEXT_TIMEOUT。业务示例、网站和配套技能继续使用已发布 0.7.0，发行包含该 API 的版本后再同步升级。
