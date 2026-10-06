# 用户身份与按钮操作者

准备 [快速开始](../guide/quick-start.md) 的项目后，将下面代码保存为 `src/app.module.ts`，保留 `src/main.ts`。

<<< @/../examples/identity/app.module.ts

在项目根目录执行 `npx tsc -p tsconfig.json`，再执行 `node --env-file=.env dist/main.js`。

发送 `/我是谁` 查看本条消息中的用户、群和角色。私聊没有群信息；群角色只有平台实际提供合法字段时才存在。

发送 `/身份按钮` 后点击按钮，回复中的 OpenID 对应本次点击者。按钮不会沿用先前消息的昵称或角色。需要限制操作时，继续用 Guard 和按钮原生权限；详见 [读取用户、群和角色](../guide/identity.md)。
