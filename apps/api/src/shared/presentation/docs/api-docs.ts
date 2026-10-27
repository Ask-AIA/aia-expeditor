import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Serve the OpenAPI document and Swagger UI at `/docs` (plus `/docs-json`).
 * Mounted as plain middleware, so the global `api/v1` route prefix does
 * not move it. Enabled outside production only; called from `main.ts`
 * and reused by the `/docs` integration test.
 */
export function setupApiDocs(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('AIA Expeditor API').setVersion('0.0.0').build(),
  );
  SwaggerModule.setup('docs', app, document);
}
