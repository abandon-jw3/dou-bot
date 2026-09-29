# dd-bot-example

使用 [dd-bot](https://github.com/abandon-jw3/dd-bot) SDK 的独立 QQ 机器人示例，业务为真实城市天气查询。平台只覆盖 QQ 官方群聊与私聊；本项目不导入框架源码。

Node.js 24.21.0+，TypeScript 固定 5.9.3。SDK 0.3.0 安装包随私有仓库放在 vendor 中，npm ci 可独立恢复依赖；来源提交与 SHA-256 见 [SDK 说明](vendor/README.md)。

## 快速验证

```sh
npm ci --ignore-scripts
npm run check
npm run weather:live -- 北京
```

check 使用离线响应测试，不读取 QQ 凭证，也不依赖天气服务可用性。weather:live 通过同一个业务服务访问真实 Open-Meteo 接口，但不连接 QQ；默认打印北京当前模型数据和三天预报。

## 连接 QQ

将 .env.example 复制为 .env，填写本地配置：

- QQ_APP_ID / QQ_APP_SECRET：QQ 官方机器人凭证。
- QQ_TRANSPORT：ws 或 webhook，默认 ws。
- COMMAND_PREFIX：默认空字符串，可设为 / 或 !。
- ALLOWED_PRIVATE_USERS：允许的私聊 user_openid，逗号分隔。
- ALLOWED_GROUPS：允许的 group_openid，逗号分隔；允许该群的成员查询。
- PORT：Webhook 本地监听端口，默认 3000。

白名单默认全部关闭，使用 QQ 事件中的 OpenID，不使用日常 QQ 号推测身份。群聊 member_openid 与私聊 user_openid 不混用。凭证、身份配置和本地日志均不进入 Git。

```sh
npm run build
npm start
```

WS 建连前请确保同一机器人的其他实例已停止。Webhook 使用 /qq 路径，需要由部署环境提供 HTTPS 入口。程序处理 SIGINT/SIGTERM 并等待框架关闭。启动脚本使用 Node 的 --use-env-proxy，按当前 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 环境配置处理 HTTP 请求；未配置时直接访问。

## 命令

```text
查询 北京 天气
查询 天气 北京
查询 明天 天气 上海 通勤 --detail
查 北京市 天气 后天 --unit=f
help 查询
```

- City 装饰器封装 Slot，识别北京、上海、深圳、广州、杭州、成都、武汉、西安及带“市”的别名。
- 城市、天气类型、今天/明天/后天可以交换顺序；日期默认今天。
- --detail / -d 展示湿度与风速，--unit=c/f / -u c/f 选择温度单位。
- Rest 收集未被 Slot 消费的词，作为备注展示；最多 6 个词、120 字符，不将备注误解为天气筛选条件。
- 同一会话内每用户的查询间隔为 30 秒，命令别名共享冷却。
- 点击“刷新天气”会绕过天气缓存重新请求；同一模型更新时间内，天气数值可能保持不变。按钮只允许原查询者在原会话使用，10 分钟失效；刷新间隔为 10 秒。

普通查询使用最多 60 秒的缓存，跨北京时间日期不复用。城市定位最多缓存 8 项，天气最多 16 项（8 城市 × 2 单位），按钮状态最多 256 项；关闭时清空。上游错误只回复简短提示，绝不以模拟天气代替失败结果。

## 实机验证入口

```sh
npm run live
```

此入口读取本地 QQ 凭证，建立一个最长 10 分钟的 WS 测试连接。启动后输出本轮随机前缀，依次在私聊和测试群发送“启用”和“查询”，再点击刷新按钮。每种场景只临时绑定一名用户及其会话，不修改正式白名单。两处查询和刷新均成功后自动关闭；也可创建 ready 输出中指定的 stop 文件关闭。

数据来自真实天气服务。work/live 中仅记录场景、请求结果和天气字段，不记录 OpenID、凭证或消息原文。CLI 与 QQ 结果中的“当前”是天气模型估算，不是气象站现场观测。运行结果见 [验证记录](docs/validation.md)。

## 工程结构

| 文件                                               | 职责                                          |
| -------------------------------------------------- | --------------------------------------------- |
| [app.ts](src/app.ts)                               | 模块、DI、配置及测试端口组装                  |
| [city.ts](src/city.ts)                             | 可复用 City 装饰器和城市别名                  |
| [access.ts](src/access.ts)                         | 白名单 Guard 与临时实机授权                   |
| [weather/controller.ts](src/weather/controller.ts) | Slot、Rest、Option、Guard、冷却和按钮业务入口 |
| [weather/service.ts](src/weather/service.ts)       | 城市定位、真实天气、响应校验和缓存            |
| [weather/http.ts](src/weather/http.ts)             | 超时、取消、响应大小及域名约束                |
| [weather/buttons.ts](src/weather/buttons.ts)       | 有效期、容量及原用户/会话绑定                 |
| [weather/view.ts](src/weather/view.ts)             | QQ Markdown 天气卡片                          |

## 数据来源与使用范围

天气由 [Open-Meteo Forecast API](https://open-meteo.com/en/docs) 提供，城市定位使用 [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) 和 GeoNames 数据。结果中保留数据来源、北京时间和缓存状态。

示例使用无需 API Key 的公共非商业端点。公开或商业部署前应按 [服务商方案与限制](https://open-meteo.com/en/pricing) 选择相应服务；本示例不会自动购买服务或配置商业密钥。

本项目及 SDK 目前为 private；SDK 的 NOTICE 保留在安装包中，项目发行许可由所有者决定。
