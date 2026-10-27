import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadAppConfig } from './shared/config/app-config';
import { setupApiDocs } from './shared/presentation/docs/api-docs';

async function bootstrap(): Promise<void> {
  // Fail fast with a readable (secret-free) message on invalid env.
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule);

  // Every REST endpoint lives under /api/v1 (spec §15).
  app.setGlobalPrefix('api/v1');

  if (config.NODE_ENV !== 'production') {
    setupApiDocs(app);
  }

  app.enableShutdownHooks();
  await app.listen(3000);
}

void bootstrap();
