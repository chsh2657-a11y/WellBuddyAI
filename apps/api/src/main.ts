import { Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { API_PREFIX, buildOpenApiDocument, createApp } from './app.factory.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';

const app = await createApp();
const config = app.get<AppConfig>(APP_CONFIG);

if (config.env !== 'production') {
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApiDocument(app), {
    jsonDocumentUrl: `${API_PREFIX}/openapi.json`,
  });
}

await app.listen(config.port);
Logger.log(`API 서버 실행: http://localhost:${config.port}/${API_PREFIX}`, 'Bootstrap');
