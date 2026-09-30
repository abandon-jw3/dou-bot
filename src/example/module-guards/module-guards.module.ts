import { Module } from 'dd-bot';
import { ModuleInfoController, ModuleManagementController } from './module-guards.controller.js';
import {
  ControllerManagersGuard,
  MethodOwnerGuard,
  ModuleGroupGuard,
} from './module-guards.guard.js';

// guards 只作用于本模块直接注册的控制器，不会传播给父模块或 imports 中的模块。
// “所属模块”由 controllers 注册决定，与代码存放在哪个目录无关。
@Module({
  controllers: [ModuleInfoController, ModuleManagementController],
  providers: [ModuleGroupGuard, ControllerManagersGuard, MethodOwnerGuard],
  guards: [ModuleGroupGuard],
})
export class ModuleGuardsExampleModule {}

// 另一种等效声明是从 dd-bot 导入 UseGuards，把 @UseGuards(ModuleGroupGuard)
// 写在这个模块类上，同时移除 guards 字段；Provider 注册仍然需要保留。
// 两种写法同时使用时会依次执行，不会自动去重，通常选择一种即可。
