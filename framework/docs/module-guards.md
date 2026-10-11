# 模块、类和方法级 Guard

- 模块级：保护本模块直接注册的控制器。
- 类级：保护当前控制器。
- 方法级：限制单个命令、按钮或附件处理器。
- 任一级拒绝都会停止当前处理，不占用冷却。

## 模块统一配置

以下类由业务定义，Guard 需在本模块注册或经 imports/exports 引入：

```ts
@Module({
  controllers: [QueryController, SettingsController],
  providers: [FeatureGuard, ControllerGuard, MethodGuard],
  guards: [FeatureGuard],
})
export class FeatureModule {}
```

- FeatureGuard 保护两个控制器的 Command、OnButton 和 OnAttachment。
- 只保护本模块直接注册的控制器，不传播到导入模块。
- `guards` 放 Provider 令牌，不放 Guard 实例或 `GroupOnly()` 等装饰器。
- 模块类也可用 `@UseGuards(FeatureGuard)` 或 `@GroupOnly()` 声明规则。

## 类级和方法级

```ts
@Controller()
@UseGuards(ControllerGuard)
export class SettingsController {
  @Command('修改设置')
  @UseGuards(MethodGuard)
  change(): string {
    return '已通过模块、类和方法级检查。';
  }
}
```

执行顺序：**模块 guards → 模块类 → 控制器类 → 方法**。

- 列表从左到右，叠加装饰器从上到下；类继承时基类在先。
- 规则累加，方法不能放宽模块或类限制；重复声明会重复执行。
- 覆写方法需重新声明路由，方法级规则使用新声明。
- 原始 On 不受这条链保护，也不能直接声明 Guard 或 Cooldown。
- 帮助列表不按 Guard 隐藏命令；HelpModule 有独立的模块范围。

## 模块类装饰器写法

也可把规则放在模块类上；相关类从 dou-bot 导入或由业务定义：

```ts
@Module({ controllers: [QueryController], providers: [FeatureGuard] })
@UseGuards(FeatureGuard)
export class FeatureModule {}
```

- Module 与 UseGuards 的书写先后不改变作用范围。
- 模块配置不通过类继承复制，具体模块需声明自己的 Module。
- 类级 Guard 可以继承，令牌仍需在具体模块可见。

## 配置与使用限制

- Guard 需实现 canActivate，且在所属模块可见；应用创建时校验。
- guards 数组复制为配置快照，运行后改原数组不会更新权限。
- 内置角色限制支持命令和附件处理器，不支持按钮；按钮使用原生 permission。
- prompt 回答不重新执行 Guard，敏感操作需复核业务权限。
- 一个附件处理器被拒绝不影响其他匹配处理器。

[自定义 Guard 与冷却](execution-controls.md) · [内置访问限制](access-control.md) · [可运行示例](https://github.com/abandon-jw3/dou-bot/tree/main/example/src/example/module-guards)
