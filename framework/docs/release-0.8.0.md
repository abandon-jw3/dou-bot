# 0.8.0 发行准备

**状态：已完成本地候选验收，尚未上传 npm。** 当前公开版本仍为 0.7.0，latest / next 分别为 0.7.0 / 0.6.0。

- 目标：`dou-bot@0.8.0`，MIT，public，npm latest；next 保持不变。
- 源码基线：`68502e6`，公开契约 **1.14**。
- Node.js：`>=24.0.0 <25`；TypeScript：**5.9.3**。
- 生产依赖仍为 reflect-metadata 0.2.2、ws 8.22.0。
- 候选完整性和验收状态见 [候选记录](npm-release-0.8.0-candidate.json)。

## 新功能

| 功能                     | 用途                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Slot.normalize           | 将“双梦”等别名转为统一参数；[用法](command-parameters.md#slot-归一化)                |
| 上下文中间件             | 执行前同步/异步 prepare，set 注册值，provide 按需加载；[用法](context-middleware.md) |
| ctx.state / ContextValue | 用有类型的 Key 在 Guard 和处理器读取本次执行的数据                                   |
| 容量监测                 | 读取缓存占用、接纳拒绝原因、排队及处理时间；[用法](capacity.md)                      |

## 修复与优化

- 固定请求选项中的取消信号，避免调用方修改选项后丢失取消能力。
- 拒绝按钮权限中的稀疏用户列表。
- 修复截止时间与 Promise 交付竞态，以及同步关闭异常跳过收尾的问题。
- 减少高频路径的分配、图片复制、附件重复筛选和全缓存扫描。
- 仓库整理为 framework、example、website；SDK 导入仍为 dou-bot 和 dou-bot/testing。
- 用户指南与技能按功能分点编写。

## 从 0.7.0 升级

发布后在自己的项目执行：

```sh
npm install --save-exact dou-bot@0.8.0
```

- 已有命令、附件、身份参数、Guard、按钮和 prompt 用法保持。
- 自行构造 MessageContext、ButtonContext、GuardContext 测试对象时，补充 state reader。
- 自行构造 ApplicationSnapshot 时，补充 capacity、rejections、timing。
- 错误阶段的穷尽判断增加 middleware、context；错误码增加 CONTEXT_TIMEOUT。
- Slot.normalize 仅同步转换字符串，异步查询放在业务服务或中间件中。
- 中间件在 Guard 之前执行；权限判断继续使用 Guard。

## 本地验收

在 framework 目录执行，完整结果记入候选记录：

```sh
npm run check
npm run coverage
npm run test:compat
npm run test:compat:0.7
npm run soak -- 30000
npm run benchmark:capacity -- virtual 7200000 release-080
```

- SDK 在 Node 24.0.0、24.21.0 分别检查。
- 根目录执行 `npm run check:all`，网站另执行 `npm run docs:test:browser`。
- 用同一候选 tgz 验证独立业务示例和文档示例的升级兼容性。
- 本轮只做离线及本地协议检查，不启动真实 QQ，也不重复 65 分钟计时测试。
- 历史负载和实机记录保留原始版本；公网 QQ Webhook、多日真实运行仍未完成。

## 验收结果

| 检查                       | 结果                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| SDK：Node 24.0.0 / 24.21.0 | 各 293 项测试；148 个导出、108 组类型契约检查                        |
| 当前候选包                 | 两版 Node 检查的 tgz 字节一致，122 个文件                            |
| 历史 npm 消费者            | 0.6.0、0.7.0 均通过                                                  |
| 整仓检查                   | SDK、业务示例、文档站通过                                            |
| 候选升级：独立示例         | 36 项业务测试、7 项开发进程测试通过                                  |
| 候选升级：独立文档站       | 18 项示例测试、16 项浏览器测试和构建通过                             |
| 覆盖率                     | 行/语句 98.93%，函数 98.27%，分支 91.21%                             |
| 生产依赖审计               | 0 项告警                                                             |
| 30 秒模拟持续运行          | 30,045ms，非预期错误 0，关闭后资源归零                               |
| 两小时虚拟容量             | 154,800 次调用、6,192 次重复投递；155 次注入失败正确记录，容量拒绝 0 |
| npm 发布预览               | dry-run 通过，完整性与候选一致，未上传                               |

- 包：`framework/work/release/0.8.0/dou-bot-0.8.0.tgz`（仓库根目录下）。
- SHA-256：`e2c657a18b5efcd97f8b7d59a77fbf789c8b661a0f9ff716202a751730e489b2`。
- 远端 CI 仍对应 [3907476](https://github.com/abandon-jw3/dou-bot/actions/runs/37514743897)，不覆盖本地 4 个提交及本次候选改动。
- 本机 `npm whoami` 返回 ENEEDAUTH，正式上传前需要登录。
- npm 代理请求曾超时；本轮临时对 registry.npmjs.org 使用直连后，安装、审计和发布预览通过。

## 上传与后续同步

1. 确认发行源码提交及其远端 CI，标签应指向发行提交。
2. 核对候选 SHA-256 / SHA-512 和输入指纹，上传已验收的同一份 tgz。
3. 正式发布时完成 npm 账号验证，不在聊天或仓库保存凭证。
4. 匿名下载 0.8.0，比较候选字节，运行 `npm run test:published`；此命令包含 0.8.0 新 API 消费者。
5. 将 example、website 的精确依赖和锁文件更新为 registry 0.8.0，同步 vendor 元数据、指南、API 索引及技能。
6. 在示例、网站和技能中补充新功能演示，完成检查后再部署。

当前 example、website 和技能仍面向已发布 0.7.0；候选升级验证在隔离副本中进行，不改成源码链接或提前声明 npm 0.8.0 已可安装。

完成源码提交、CI 和账号准备并明确执行发布后，在 framework 目录上传同一候选：

```sh
npm publish ./work/release/0.8.0/dou-bot-0.8.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org/
```
