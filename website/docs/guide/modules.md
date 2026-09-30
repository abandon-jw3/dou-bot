# 模块与依赖注入

模块描述对象如何组合，依赖注入负责构造和共享这些对象。下方示例先注册配置值，再把服务注入控制器。

<<< @/../examples/hello/greeting.service.ts

<<< @/../examples/hello/app.module.ts

## Module 的四个基础字段

| 字段        | 作用                                 |
| ----------- | ------------------------------------ |
| imports     | 导入其他模块，获取其导出的 Provider  |
| providers   | 注册当前模块的服务、配置值和工厂     |
| controllers | 注册当前模块的命令、按钮与事件控制器 |
| exports     | 允许导入方使用的 Provider 令牌       |

`guards` 是额外的模块级调用检查，详见 [Guard](./guards.md)。导出一个 Guard 只使其可注入，不会自动保护导入方。

## Provider 的几种写法

以下为配置片段，令牌和服务类由你的业务定义：

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

- 类简写等同于用该类作为令牌注册类 Provider；类应有 `@Injectable()`。
- useValue 使用你已经创建的值；资源所有权仍属于调用者。
- useClass 将令牌绑定到一个实现类。
- useFactory 可异步返回结果，依赖由 inject 数组显式声明。工厂失败会让创建应用失败。

Provider 默认单例。每条消息的数据应放在处理器的局部变量中，避免不同用户互相覆盖。

## Symbol、Object.freeze 与 satisfies

Symbol 提供唯一的运行时令牌。接口在编译后被擦除，所以接口配置需要 `@Inject(token)`。

`Object.freeze` 限制对象顶层属性被修改；它不是深度冻结。`satisfies Settings` 是 TypeScript 的静态检查，确认值符合接口，不会在运行时创建 Settings 实例。

## 模块可见性与 app.get

只有本模块注册或通过 imports/exports 引入的依赖可以被注入。缺失、歧义和循环依赖会在创建阶段报错。

根模块可见的服务使用 `app.get(QueryService)`；有明确需求时使用 `app.get(QueryService, { module: FeatureModule })`。不要为了绕过可见性再手动 new 一个本应单例的服务。

`QQClient`、`QQApi`、`LOGGER` 是内置可注入令牌，不能用普通 Provider 覆盖。
