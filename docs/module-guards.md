# 模块、类和方法级 Guard

dou-bot **0.6.0 / 契约 1.7** 支持三个层级的 Guard。执行顺序为 **模块 → 控制器类 → 方法 → 参数绑定 → 冷却 → 业务处理器**。任意一级拒绝都会停止后续检查，不占用冷却。

## 模块统一配置

假设 FeatureGuard、ControllerGuard、MethodGuard 和两个控制器已经定义：

```ts
@Module({
  controllers: [QueryController, SettingsController],
  providers: [FeatureGuard, ControllerGuard, MethodGuard],
  guards: [FeatureGuard],
})
export class FeatureModule {}
```

FeatureGuard 会作用于两个控制器中的所有 Command 和 OnButton，无需在每个控制器上重复声明。`guards` 接受类、字符串或 Symbol 类型的 Provider 令牌；Guard 本身仍需在本模块 providers 中注册，或通过 imports/exports 取得。数组为空表示该配置项不追加规则。

模块只保护直接列在自己 controllers 中的类。imports 引入的模块有自己的规则，父模块、兄弟模块也不会受到影响；归属由模块注册决定，不由目录结构或 TypeScript 的 import 决定。导出一个 Guard Provider 只让令牌可见，不会自动给导入方施加规则。

## 类级和方法级继续使用

```ts
@Controller()
@UseGuards(ControllerGuard)
export class SettingsController {
  @Command('查看设置')
  list(): string {
    return '已通过模块和类级检查。';
  }

  @Command('修改设置')
  @UseGuards(MethodGuard)
  change(): string {
    return '已通过模块、类和方法级检查。';
  }
}
```

规则是累加的，方法声明不能绕过或覆盖模块、类级规则。相同令牌在不同层级重复声明时会按声明次数执行，不自动去重；将某条规则提升到模块后，通常应移除原先重复的类级声明。

## 模块类装饰器写法

也可以在模块类上使用 UseGuards：

```ts
@Module({
  controllers: [QueryController, SettingsController],
  providers: [FeatureGuard, ControllerGuard, MethodGuard],
})
@UseGuards(FeatureGuard)
export class FeatureModule {}
```

Module 与 UseGuards 的书写先后不影响作用范围。`@GroupOnly()`、`@PrivateOnly()`、`@UsersOnly(...)` 等内置规则也可以写在模块类上，无需额外 Provider；不要把 `GroupOnly()` 这样的装饰器放入 guards 数组。

两种模块声明同时存在时，精确顺序为：

1. Module 配置中的 guards，按数组顺序。
2. 模块类的 Guard 装饰器，基类先于派生类，同一位置从上到下。
3. 控制器类的 Guard 装饰器，同样按继承和声明顺序。
4. 有效方法的 Guard 装饰器，按声明顺序。

模块配置的 imports/providers/controllers/exports/guards 本身不会通过 JS 类继承复制；具体模块仍需自己的 Module 声明。Guard 类装饰器沿用类继承规则，继承来的令牌也必须在具体模块中可见。覆写控制器方法继续沿用已有规则：方法级 Guard 使用覆写后的声明，未重新声明路由的覆写方法不注册。

## 启动校验与边界

- guards 必须是合法令牌数组，不能放 Guard 实例、装饰器、空字符串或稀疏项；配置复制并冻结，后续修改原数组不改变权限。
- 缺失、不可见、歧义或指向 Controller 的 Guard 令牌，在实例构造之前拒绝。即使模块暂无控制器，也会校验模块 Guard 的声明与依赖。
- Provider 或异步工厂结果必须实现 canActivate；否则在 create 返回前失败，并按原有生命周期回收已创建资源。
- 内置场景及角色限制合并后检查冲突；模块要求群聊而类/方法要求私聊，或角色交集为空，会报 CONFIG。
- 原始 On 观察器独立执行，不受模块或类级 Guard 限制；不能在 On 方法上直接添加 Guard。prompt 已消费的回答仍不重新路由、重跑 Guard 或扣除冷却。
- GroupRoles/GroupManagersOnly 只用于命令。若模块级角色装饰器作用到 OnButton，启动会拒绝；可以把角色规则放在专门的命令控制器上，按钮点击使用原生 permission。
- HelpModule 是独立模块，根模块 Guard 不会自动保护其帮助命令；帮助列表不会按业务 Guard 隐藏命令。

以下源码链接需要仓库访问权限。可运行且带中文注释的组合示例见 [独立示例项目](https://github.com/abandon-jw3/dd-bot-example/tree/main/src/example/module-guards)，框架行为测试见 [module-guards.test.ts](https://github.com/abandon-jw3/dd-bot/blob/main/tests/module-guards.test.ts)。
