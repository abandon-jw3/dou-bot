import { HelpModule, Module } from 'dd-bot';
import type { Type } from 'dd-bot';
import { AccessService, EnrollmentController, WeatherGuard } from './access.js';
import { AUDIT, CLOCK, CONFIG, HTTP_FETCH } from './config.js';
import type { AppConfig, Audit } from './config.js';
import { WeatherButtons } from './weather/buttons.js';
import { WeatherController } from './weather/controller.js';
import { WeatherHttp } from './weather/http.js';
import { WeatherService } from './weather/service.js';

export function createModule(
  config: AppConfig,
  ports: { fetch?: typeof fetch; now?: () => number; audit?: Audit } = {},
): Type {
  if (
    !Number.isSafeInteger(config.requestTimeoutMs) ||
    config.requestTimeoutMs < 1 ||
    config.requestTimeoutMs > 60000 ||
    !Number.isSafeInteger(config.cacheTtlMs) ||
    config.cacheTtlMs < 0 ||
    config.cacheTtlMs > 60000 ||
    /\s/u.test(config.prefix)
  )
    throw new Error('Invalid application configuration');
  if (config.liveEnrollment && !/^试用-[a-f0-9]{8}:$/u.test(config.prefix))
    throw new Error('Live enrollment requires a random test prefix');
  const snapshot = Object.freeze({
    ...config,
    privateUsers: Object.freeze([...config.privateUsers]),
    groups: Object.freeze([...config.groups]),
  });
  @Module({
    imports: [HelpModule],
    controllers: [WeatherController, ...(config.liveEnrollment ? [EnrollmentController] : [])],
    providers: [
      { provide: CONFIG, useValue: snapshot },
      { provide: HTTP_FETCH, useValue: ports.fetch ?? fetch },
      { provide: CLOCK, useValue: ports.now ?? (() => performance.now()) },
      { provide: AUDIT, useValue: ports.audit ?? (() => {}) },
      AccessService,
      WeatherGuard,
      WeatherButtons,
      WeatherHttp,
      WeatherService,
    ],
  })
  class AppModule {}
  return AppModule;
}
