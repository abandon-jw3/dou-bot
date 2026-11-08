# 1.0.0-rc.2 候选发布

2026-11-09 01:11:52（Asia/Shanghai）已发布到 npm `next`，公开契约为 2.1。[发布记录](npm-release-1.0.0-rc.2.json)

## 按钮自动分行

`keyboard` 可以直接接收一维按钮数组。省略行宽时每行一个，指定行宽时按输入顺序分组。行宽取 1～5 的整数，行宽数组的最后一个值用于剩余各行。

```ts
import { button, keyboard, markdown } from 'dou-bot';

const btns = Array.from({ length: 9 }, (_, i) => button.callback(String(i + 1), String(i + 1)));
const menu = markdown('请选择', { keyboard: keyboard(btns, [2, 3]) }); // 2、3、3、1
const grid = keyboard(btns, 4); // 4、4、1
```

已有的二维数组写法继续按指定行发送。多账号应用现在只解析一次共享配置，入站任务统一由共享执行池调度。随仓库提供的 dou-bot 技能已补充按钮布局示例。

## 安装

在应用目录运行：

```sh
npm install --save-exact dou-bot@1.0.0-rc.2
```

## 候选验收

- Node 24.0.0 和 24.21.0 各通过全部 413 项 SDK 测试，包含独立 PostgreSQL 17.11 实例上的 13 项集成测试。
- 两版 Node 都从同一份 tarball 编译并运行独立消费者，验证两种新按钮布局及 7 项技能测试。
- 业务示例与文档站都从各自的锁文件安装同一份候选包，仓库的 `npm run check:all` 通过。文档的 API 索引包含 `keyboard` 的两个重载，47 个静态页面及 24 项桌面和移动端浏览器测试通过。
- 安装包共 182 个文件、303010 字节。SHA-256 为 `ad37b8ec1f85349beba5066381d1b3670c1e65a531a9eb1fc111d8a186f405a7`。完整性、审计及测试明细见[候选记录](npm-release-1.0.0-rc.2-candidate.json)。

从仓库根目录执行以下命令可再次预演发布：

```sh
npm publish ./framework/work/release/1.0.0-rc.2/dou-bot-1.0.0-rc.2.tgz --dry-run --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
```
