# dd-bot 技术选型方案

版本：1.3 · 日期：2026-09-30 · 对应：[开发方案 1.4](./development-plan.md)

本方案确定首版依赖、工程工具和实现技术，不变更已经审查过的公开 API。**TypeScript 按用户要求固定为 5.9.3。** 当前验证覆盖隔离工具链样例和既有 API 草案，尚不是完整 SDK 的运行结果。

## 1. 选型结论

采用 **Node.js 24 + TypeScript 5.9.3 + tsc + ESM + reflect-metadata/lite + ws**。模块、DI 和消息调度按本项目的有限契约实现，HTTP 与密码算法使用 Node 内置能力。生产直接依赖保持两个，测试、代码检查和覆盖率工具放入 devDependencies。

| 领域          | 首版选择                                       | 主要理由                                               |
| ------------- | ---------------------------------------------- | ------------------------------------------------------ |
| 运行时        | Node.js 24，已验证 24.21.0                     | 已有环境与 LTS 基线，内置 fetch/http/crypto            |
| 语言          | TypeScript **5.9.3 精确版本**                  | 用户指定，已有契约及元数据验证通过                     |
| 编译          | tsc，NodeNext → ESM                            | 保留传统装饰器及构造参数元数据，生成 JS 和 d.ts        |
| 装饰器        | experimentalDecorators + emitDecoratorMetadata | 支持参数装饰器与自动构造注入                           |
| 元数据        | reflect-metadata 0.2.2 的 lite 入口            | 提供所需 Reflect API，省去旧运行时集合 polyfill        |
| DI / 模块     | 自有有限容器                                   | 精确实现 imports/exports、单例、异步工厂与统一关闭约束 |
| WS            | ws 8.22.0                                      | 支持 terminate、maxPayload，已验证关键能力             |
| Webhook       | node:http                                      | 单一回调入口，便于保留原始字节和控制接纳流程           |
| REST          | 原生 fetch + AbortController/AbortSignal       | 统一取消、超时、响应字节限制及重定向策略               |
| Ed25519       | node:crypto                                    | 使用运行时维护的密码原语                               |
| 参数/配置校验 | 显式运行时校验函数                             | 接口面有限，可直接表达 QQ 新旧字段及安全边界           |
| 指令解析      | 状态扫描器 + 启动时编译的参数规则              | 前缀、引号、转义、Option、Slot、Rest；不新增解析器依赖 |
| 队列与缓存    | 自有 FIFO、Map、lease                          | 将条数、字节、去重、回复作用域合并为一次接纳决策       |
| 日志          | 注入式 Logger + 默认 JSON stderr               | 维持少依赖，并允许宿主接入其日志系统                   |
| 测试          | node:test + node:assert/strict                 | 直接测试 tsc 生成的 ESM，避免另一套转译语义            |
| 覆盖率        | c8 12.0.0                                      | V8 覆盖率与 TypeScript source map 报告                 |
| 静态检查      | ESLint 10.11.0 + typescript-eslint 8.71.0      | 重点阻止悬挂 Promise、误用 async 回调及不安全类型操作  |
| 格式化        | Prettier 3.9.9                                 | 统一 TS、JSON、Markdown 格式                           |
| 包管理        | npm 11.19.0 + package-lock.json                | 单包结构与现有环境一致，CI 使用 npm ci                 |
| 项目结构      | 单包；内部职责分区                             | 公开 API 与内部实现分开，避免提前拆包                  |

Node 官网当前将 24 标记为 LTS；本地运行版本也是 24.21.0。[Node 发布信息](https://nodejs.org/en/about/previous-releases)

## 2. 版本与依赖预算

以下版本均为本次核对和验证的组合，不表示每个工具的最新版本。

### 2.1 生产依赖

| 包               | 版本   | 用途                                         | 强制传递依赖 |
| ---------------- | ------ | -------------------------------------------- | ------------ |
| reflect-metadata | 0.2.2  | 元数据 API；运行时导入 reflect-metadata/lite | 无           |
| ws               | 8.22.0 | QQ WS 客户端                                 | 无           |

ws 声明 bufferutil、utf-8-validate 为可选 peer，本项目不要求安装这些原生扩展。安装时应核对锁文件，不能把“两个直接依赖”误写为“没有任何可选扩展”。

本次 npm 发布元数据中的 unpackedSize 分别为 241,158 和 151,410 字节，合计 **392,568 字节，约 383.4 KiB**。这是两个完整发布包的解包大小，包括类型和说明材料；不是 SDK 最终体积、内存占用或 gzip 大小。[reflect-metadata 发布元数据](https://registry.npmjs.org/reflect-metadata/0.2.2) · [ws 发布元数据](https://registry.npmjs.org/ws/8.22.0)

### 2.2 开发依赖

| 包                | 精确版本  |
| ----------------- | --------- |
| typescript        | **5.9.3** |
| @types/node       | 24.19.0   |
| @types/ws         | 8.18.2    |
| eslint            | 10.11.0   |
| @eslint/js        | 10.0.1    |
| typescript-eslint | 8.71.0    |
| prettier          | 3.9.9     |
| c8                | 12.0.0    |

Node 类型选择 24 系列，与支持的运行时基线一致，不直接跟随 @types/node 的 latest。开发工具允许有其自身依赖树，它们不随生产运行安装；生产部署由宿主应用执行 npm ci --omit=dev。

首次实现时 manifest 采用上述精确版本并提交锁文件。TypeScript 必须保持 `"5.9.3"`，不使用范围或 latest。升级其他依赖也应作为可审查的独立改动，运行对应回归检查后更新锁文件。

## 3. TypeScript、装饰器与编译选择

### 3.1 使用 tsc 作为唯一权威编译链

整个开发、测试和发布链路都先用 tsc 编译，再由 Node 执行 JS。构造函数自动注入依赖 `design:paramtypes`，因此只检查 TS 语法或擦除类型不够。

esbuild 官方明确指出不支持 emitDecoratorMetadata；它不作为本项目的权威编译入口。首版也不引入打包器，再次转译构建产物没有当前需求。[esbuild TypeScript 限制](https://esbuild.github.io/content-types/#typescript-caveats)

构造函数注入的类必须以值导入；接口和普通类型可以使用 import type。格式化或 import 自动修复不能把实际 DI 类改成 type-only 导入。业务 API 声明与消费者示例一起编译，另执行实际元数据测试。

### 3.2 传统装饰器与 lite 元数据

启用 experimentalDecorators、emitDecoratorMetadata，使用 reflect-metadata/lite 在装饰器模块求值之前初始化 Reflect。不要把需要该副作用的模块声明为 sideEffects=false。

lite 入口由该包官方提供，支持现代模块环境且不包含 Map/Set/WeakMap 的内部 polyfill，适合 Node 24。[reflect-metadata 用法](https://github.com/microsoft/reflect-metadata#usage)

标准新装饰器与这套参数装饰器、构造类型元数据模式不同，首版沿用已经确认的传统模式。未来迁移需要作为 API/编译契约变更处理，而不是简单删除 tsconfig 选项。

### 3.3 编译配置基线

以下是配置基线；当前已建立对应的 SDK 根工程，实际脚本与导出以根目录文件为准。

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": false,
    "sourceMap": true,
    "inlineSources": true,
    "noEmitOnError": true,
    "skipLibCheck": false,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

lib 仅包含 ES2023，Node 全局类型由 @types/node 提供，避免不必要的浏览器全局。显式 rootDir 防止产物路径漂移。相对导入写 `.js` 扩展，交给 NodeNext 解析源码；不引入需要额外运行时解析器的路径别名。

生产输出 ESM 与 d.ts；不提供双份 CJS 构建。根 exports 指向 dist/index.js 和 dist/index.d.ts，类型入口先列出 types 条件。消费者使用公开根入口，不依赖内部目录路径。

## 4. DI 与模块系统选择

| 方案                    | 收益                          | 在本项目中的代价                                   | 结论       |
| ----------------------- | ----------------------------- | -------------------------------------------------- | ---------- |
| Nest ApplicationContext | 成熟的模块、DI 与生命周期体系 | 引入更大的框架边界，还需自定义 QQ 执行链及关闭策略 | 首版不采用 |
| 通用独立 DI 容器        | 复用解析和实例缓存            | 仍需桥接本方案的模块可见性、绑定身份和资源所有权   | 首版不采用 |
| 有限自有容器            | 生命周期和模块规则由一处实现  | 需要承担正确性与测试维护成本                       | **采用**   |

这是针对既有契约的设计判断。少依赖不自动意味着代码简单或正确，容器实现必须限定范围：类/值/异步工厂、模块 imports/exports、单例、显式 token、启动检查和关闭钩子。

元数据读取与依赖图构建分离；先解析绑定和循环，再构造实例。对 ModuleGraph、ProviderBinding、实例缓存、生命周期记录分别建模，避免退化为一个无作用域的全局 Map。

方法路由也在启动时编译到 Map。构造类型只用于 DI，消息参数由 @Ctx/@Arg/@Args/@Option/@Slot/@Rest 明确绑定；数值或布尔转换必须显式配置 type，不根据参数反射自动做 JSON、数字或 DTO 转换。参数声明和帮助目录在启动时构建，消费状态按单次调用创建，Slot 匹配复杂度随未消费分词数与 Slot 数量的乘积增长；业务匹配器需保持纯函数和快速同步执行。

## 5. QQ 接入与网络实现

### 5.1 WS：选择 ws

原生 WebSocket 方案已在严格审查中调整。ws 的 terminate 与 maxPayload 满足明确的关闭和报文限制需求，相关能力已做本地验证。[ws 官方 API](https://github.com/websockets/ws/blob/master/doc/ws.md)

使用 `import WebSocket from 'ws'`；不从包内部的 index.js 绕过其 exports。固定关闭自动重定向、关闭 permessage-deflate、保留 UTF-8 校验，并显式设置 maxPayload。QQ op=1/11 心跳与 WebSocket ping/pong 分开处理。

重连状态机、generation、RESUME 游标和过载接纳策略由框架实现；ws 负责连接和帧处理，不承担业务可靠性语义。

### 5.2 Webhook：选择 node:http

首版只有一个回调入口，无需为路由、模板或 HTTP 控制器引入完整 Web 框架。node:http 让请求原始字节、读取期限、响应确认和自有连接关闭都保持明确。

提供 RequestListener 供宿主挂载，也可独立 listen。验签之前保留 raw body；如果以后挂载到已有 HTTP 框架，宿主必须提供尚未消费的请求流，或者单独编写并验证 raw-body 桥接层。

### 5.3 REST：选择原生 fetch

网络请求在 QQApi 一处管理：凭证、URL 同源校验、redirect=manual、联合 AbortSignal、响应大小、平台业务错误与 traceId。使用 fetch 不代表这些行为自动具备，仍需实现显式包装。

不引入通用自动重试插件；发送请求结果不明确时，自动重试可能产生重复副作用。凭证刷新合并、WS 重连和消息发送分别管理，不能共享一个通用“失败就重试”策略。

### 5.4 签名：选择 node:crypto

Ed25519 运算使用 crypto 的密钥、签名和验签接口。框架只实现 QQ 所需的种子转换、字节拼接和挑战校验，不自行实现曲线算法。

验收使用标准向量、固定字节样例和授权采集的真实回调。严格审查确定的无签名挑战约束不能因更换密码库而省略。

## 6. 校验、解析、队列与缓存

| 模块           | 实现技术                                           | 约束                                                    |
| -------------- | -------------------------------------------------- | ------------------------------------------------------- |
| 配置与平台数据 | 显式 guards / 校验函数，返回已验证类型或结构化失败 | 不用 `as T` 代替验证；区分输入无效和内部异常            |
| 指令参数       | 单次分词扫描、预编译参数规则                       | 显式处理引号/转义，再执行选项、位置、无序匹配与剩余收集 |
| 事件队列       | 数组 + head 索引的 FIFO，适时整理                  | 不在每次出队时对长数组 shift；同步接纳并执行容量回滚    |
| 去重           | Map，分开记录活跃与已完成状态                      | 只淘汰允许淘汰的记录；键使用结构化元组编码              |
| 回复作用域     | 独立 Map 与串行发送链                              | 不随去重 LRU 淘汰重置序号                               |
| 时间           | 单调时钟负责期限/TTL，墙上时钟负责协议时间戳       | 时钟通过内部接口注入测试                                |
| 任务所有权     | lease + OperationLedger                            | 保证资源预留与释放对称，关闭时可取消和排空              |

当前没有配置表单生成、通用 JSON Schema 或跨语言 schema 共享需求，首版不增加 schema 库。代价是需要维护字段和负向测试，审查时必须关注兼容字段、整数/字节范围及拒绝路径。

通用队列、缓存包无法直接替代“条数 + 字节 + 去重 + 回复作用域 + 确认任务”联合接纳，因此首版保留小型专用实现。计时器集中管理，避免为每个缓存条目创建一个 timer。

## 7. 日志与错误处理

保留现有 Logger 接口，默认实现输出 JSON 到 stderr，字段以 level、time、phase、appId、eventId、errorCode、traceId 为主。调试正文默认关闭，凭证、签名与平台异常内容经过脱敏和截断。

SDK 不管理日志文件轮转和集中采集；宿主可注入符合接口的日志实现。错误回调的有界队列、超时停用和 logger 抛错保护仍由框架负责。

错误使用 Error 子类和稳定 code，不使用字符串匹配平台 message 做业务分支；平台 qqCode 与框架 code 分开。cause 保留调试价值，但进入外部日志前进行处理。

## 8. 静态检查与格式化

采用 ESLint flat config、typescript-eslint 的类型感知推荐规则，并明确启用：

- no-floating-promises，设置 ignoreVoid=false，不能用 `void promise` 假装已经处理失败。
- no-misused-promises，防止把 async 函数直接传给只接受 void 回调的入口。
- TypeScript 编译器负责未使用变量、类型边界、可选属性和索引访问检查。

有意启动的后台任务必须交给框架任务管理器并处理 rejection。node:test 返回 Promise，本方案的测试使用顶层 `await test(...)` 或等待子测试；不为测试文件整体关闭 Promise 检查。

框架底层确实需要少数泛型构造签名或反射适配时，允许范围最小且带原因的规则例外；不在整个项目关闭不安全类型检查。不要启用会把 DI 类值导入改成 type-only 的无条件自动修复。

Prettier 统一 singleQuote=true、semi=true、trailingComma=all、printWidth=100、endOfLine=lf。CI 运行 check；修复命令由开发者显式执行。ESLint 专注正确性，格式问题交给 Prettier。

## 9. 测试、覆盖率与验证命令

测试源码与 SDK 源码用相同的装饰器编译选项，输出到独立的 `.test-build/`。测试 tsconfig 的 rootDir 设为项目根，包含 src 与 tests；生产 build 只包含 src。

选用 node:test 与 node:assert/strict；测试网关使用 ws。HTTP 测试使用本机临时端口。对时间和抖动使用内部可控时钟/随机源，不用真实等待测试大量重连分支。

### 9.1 推荐脚本

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.check.json --noEmit",
    "lint": "eslint src tests examples --max-warnings 0",
    "format:check": "prettier --check src tests examples docs",
    "test:compile": "tsc -p tsconfig.test.json",
    "pretest": "npm run test:compile",
    "test": "node --test \".test-build/tests/**/*.test.js\"",
    "precoverage": "npm run test:compile",
    "coverage": "c8 --all --src src --extension .ts --include \"src/**/*.ts\" --exclude-after-remap --reporter text --reporter lcov --reporter json-summary node --test \".test-build/tests/**/*.test.js\""
  }
}
```

Windows 上已验证 Node 24 能处理上述带引号的测试 glob。不要依赖 shell 帮忙展开文件名。

覆盖率必须在 source map 映射后筛选原始 TS 文件。本次烟测复现过“测试通过，但覆盖率错误显示 0%”的问题，`--exclude-after-remap` 修正后报告才包含真实执行的 TS 行。

初始覆盖率门槛建议设为行/语句/函数 90%、分支 85%，在 P1 开始有实际实现时启用；缓存、签名、接纳、关闭与 WS 恢复还必须覆盖开发草案中的具体异常用例，不能只看百分比。

### 9.2 本次验证结果

| 检查                                       | 结果                                   |
| ------------------------------------------ | -------------------------------------- |
| TypeScript 5.9.3 编译 NodeNext/ES2023 样例 | 通过                                   |
| 原 API 草案、业务示例和类型反例            | 通过                                   |
| reflect-metadata/lite 实际读取构造元数据   | 通过                                   |
| type-only 类导入造成令牌擦除的反例         | 符合预期                               |
| ws 的 ESM 包入口和 Node 24 类型组合        | 通过                                   |
| node:test                                  | 3 个工具链烟测通过                     |
| ESLint 正向样例                            | 0 错误、0 警告                         |
| 悬挂 Promise 及 void Promise 反例          | 2 处均被拒绝                           |
| Prettier                                   | 4 个样例文件通过                       |
| c8 + source map                            | 成功定位至原始 TS，样例 24/24 行被覆盖 |

样例覆盖率不代表 SDK 覆盖率。完整验证数据见 [技术选型验证记录](./technology-validation.json)，脚本与隔离依赖位于工作区 work/stack-selection。

## 10. 包管理、发布结构与 CI

单包 package.json 的核心部分采用：

```json
{
  "name": "dd-bot",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "packageManager": "npm@11.19.0",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE", "NOTICE"],
  "dependencies": {
    "reflect-metadata": "0.2.2",
    "ws": "8.22.0"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/node": "24.19.0",
    "@types/ws": "8.18.2",
    "eslint": "10.11.0",
    "@eslint/js": "10.0.1",
    "typescript-eslint": "8.71.0",
    "prettier": "3.9.9",
    "c8": "12.0.0"
  }
}
```

这是开发期模板，包名可用性和许可证由正式发行流程确认；private 保留到明确发行时。packageManager 记录版本，CI 还需显式采用该 npm 版本，该字段不是自动的全局版本管理器。

CI 目标为 Windows 与 Linux 的 Node 24：npm ci → 类型检查 → ESLint → Prettier check → 构建 → 测试与覆盖率 → npm pack 检查。必须从打包结果建立独立消费者测试，防止引用源码路径或漏发类型文件。`.github/workflows/ci.yml` 已接入 GitHub；[首次运行](https://github.com/abandon-jw3/dd-bot/actions/runs/36611267768) 的 Windows/Linux 两组 check 与 coverage 均通过，包含独立打包消费者检查。

Node >=24 是运行时要求，用户确认首版以 Windows 验收。Windows 与 Linux 的 Node 24.21.0 / npm 11.19.0 组合已通过 CI，真实 QQ 联调在 Windows 上完成；其他 Node 主版本通过测试后再记录为已验证组合。

## 11. 版本兼容与后续升级条件

用户指定的 TypeScript 5.9.3 作为确定基线；typescript-eslint 8.71.0 的 peer 范围覆盖它，也已通过本次实际检查。[typescript-eslint 版本要求](https://typescript-eslint.io/users/dependency-versions/) · [8.71.0 包元数据](https://registry.npmjs.org/typescript-eslint/8.71.0)

本次 registry 查询中 TypeScript latest 已指向 7.0.2，而 typescript-eslint 声明的 TypeScript peer 范围为 >=4.8.4 <6.1.0，因此不能将整个工具链机械更新为 latest。这是版本兼容约束，不是对 TypeScript 7 功能或性能作未经验证的判断。

升级准入按影响划分：

- 编译器或元数据包：重跑实际元数据、类型反例、声明文件消费者测试。
- ws：重跑握手、心跳、恢复、关闭超时、消息大小与协议错误用例。
- Node：重跑取消、HTTP 原始字节、Ed25519、关闭及跨平台测试。
- 检查/格式化工具：核对 peer 范围、规则变更与现有例外，避免自动修复改变 DI 导入。

当前已通过 `npm run benchmark` 建立 SDK 冷导入、创建/启动、合成指令吞吐及采样 RSS 基线，原始数据见 [性能基线](./performance-baseline.json)。负载使用模拟 HTTP，不代表 QQ 网络吞吐；依赖包大小和烟测不能用于推导实际性能。

## 12. 实施入口

工程、SDK、示例、测试入口和工作流已建立，采用本文件的固定版本组合。现有 [公开 API 契约](./public-api.d.ts) 已接入类型检查，装饰器元数据、异步行为与可控时钟已纳入正式测试。当前结果与部署待验项见 [验证记录](./validation-report.md)。

WS/Webhook 的平台兼容仍依照 [严格审查记录](./review-report.md) 中的实机门槛验收。技术选型通过不代表 QQ 协议行为已确认。
