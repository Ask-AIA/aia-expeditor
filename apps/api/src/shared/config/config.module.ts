import { Global, Module } from '@nestjs/common';
import type { AppConfig } from './app-config';
import { APP_CONFIG, loadAppConfig } from './app-config';

/**
 * Global config module: validates the environment once at boot and
 * exposes the typed `AppConfig` under the `APP_CONFIG` token.
 * The app refuses to start when validation fails.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadAppConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
