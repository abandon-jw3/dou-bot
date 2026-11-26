import { Injectable } from '../../src/index.js';
import type { CanActivate, GuardContext, GuardResult } from '../../src/index.js';
import { PermissionService } from './permission.service.js';

@Injectable()
export class QueryPermissionGuard implements CanActivate {
  constructor(private readonly permissions: PermissionService) {}
  canActivate(ctx: GuardContext): GuardResult {
    return (
      this.permissions.canQuery(ctx) || {
        allow: false,
        message: '当前用户在此会话中没有查询权限，请联系机器人维护者。',
      }
    );
  }
}
