import { HelpModule, Module } from '../../src/index.js';
import type { Type } from '../../src/index.js';
import { PermissionService, QUERY_ACCESS } from './permission.service.js';
import type { QueryAccess } from './permission.service.js';
import { QueryPermissionGuard } from './query-permission.guard.js';
import { QueryController } from './query.controller.js';
import { QueryService } from './query.service.js';

export const demoAccess: QueryAccess = {
  privateUsers: ['demo-private'],
  groups: [{ groupId: 'demo-group', userIds: ['demo-member'] }],
};

/** Use the event's actual QQ OpenIDs when configuring a real bot. */
export function createBusinessModule(access: QueryAccess): Type {
  @Module({
    imports: [HelpModule],
    providers: [
      { provide: QUERY_ACCESS, useValue: access },
      PermissionService,
      QueryPermissionGuard,
      QueryService,
    ],
    controllers: [QueryController],
  })
  class BusinessModule {}
  return BusinessModule;
}
