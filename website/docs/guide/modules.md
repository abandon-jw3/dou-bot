# 模块与依赖注入

- `@Module()`：注册控制器、服务和配置。
- `@Injectable()`：标记可注入的服务。
- 构造函数：接收已经注册的依赖。

<<< @/../examples/hello/greeting.service.ts

<<< @/../examples/hello/app.module.ts

## Module 的四个基础字段

| 字段        | 作用                             |
| ----------- | -------------------------------- |
| imports     | 引入其他模块导出的服务           |
| providers   | 注册服务、配置值或工厂           |
| controllers | 注册命令、按钮、附件和事件控制器 |
| exports     | 允许其他模块使用的 Provider 令牌 |

模块统一权限可配置 `guards`，见 [Guard 指南](./guards.md#模块统一配置)。

## Provider 的几种写法

以下是模块的配置片段，令牌和服务类由业务定义：

```ts
providers: [
  QueryService,
  { provide: SETTINGS, useValue: Object.freeze({ title: '我的机器人' }) },
  { provide: Storage, useClass: FileStorage },
  {
    provide: API_ENDPOINT,
    inject: [ConfigService],
    useFactory: async (config: ConfigService) => config.endpoint(),
  },
];
```

| 写法       | 用途                                   |
| ---------- | -------------------------------------- |
| 类简写     | 注册带 `@Injectable()` 的服务          |
| useValue   | 使用已有对象；资源由调用者关闭         |
| useClass   | 为令牌指定实现类                       |
| useFactory | 根据 `inject` 中的依赖创建值，支持异步 |

- Provider 默认单例，每条消息的数据放在方法局部变量中。
- 异步工厂失败会导致应用创建失败。

## 注入配置

- 接口没有运行时值，使用 `Symbol` 令牌和 `@Inject(token)`。
- `Object.freeze()` 防止对象顶层属性被改写。
- `satisfies Settings` 检查配置类型，不创建运行时实例。

## 读取已注册服务

- 模块只能注入自己的 Provider，或 `imports` 引入的导出项。
- `app.get(QueryService)` 读取根模块可见的服务。
- `app.get(QueryService, { module: FeatureModule })` 指定所属模块。
- `QQClient`、`QQApi`、`LOGGER` 已内置，无需重复注册。
- 缺失、歧义或循环依赖会在创建时报告错误。
