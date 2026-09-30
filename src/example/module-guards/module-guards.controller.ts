import { Command, Controller, UseGuards } from 'dd-bot';
import { ControllerManagersGuard, MethodOwnerGuard } from './module-guards.guard.js';

@Controller()
export class ModuleInfoController {
  // 没有写 UseGuards，也会执行所属模块配置的 ModuleGroupGuard。
  @Command('example-module-info', { description: '模块级 Guard：群内所有成员可查看' })
  info(): string {
    return '模块级检查通过：当前群成员可以查看模块信息。';
  }
}

// 类级 UseGuards 继续有效；只影响此控制器，不会修改同模块另一个控制器。
@Controller()
@UseGuards(ControllerManagersGuard)
export class ModuleManagementController {
  // 执行顺序：ModuleGroupGuard → ControllerManagersGuard → settings。
  @Command('example-module-settings', { description: '模块与类级 Guard：群主或管理员' })
  settings(): string {
    return '模块和类级检查通过：可以查看管理设置。';
  }

  // 执行顺序：模块 → 类 → 方法；任何一级拒绝都会停止后续检查与业务。
  // 方法规则是追加检查，不能绕过或覆盖模块、类级规则。
  @Command('example-module-owner', { description: '模块、类、方法三级 Guard：仅群主' })
  @UseGuards(MethodOwnerGuard)
  owner(): string {
    return '模块、类和方法级检查全部通过。';
  }
}
