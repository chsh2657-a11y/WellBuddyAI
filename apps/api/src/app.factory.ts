import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/env.js';

export const API_PREFIX = 'api';

/** HTTP 서버·테스트·OpenAPI 내보내기가 같은 설정으로 앱을 만들도록 한 곳에 모은다. */
export async function createApp(
  options: { config?: AppConfig; logger?: false } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(options.config), {
    logger: options.logger ?? ['log', 'warn', 'error'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  app.set('trust proxy', 'loopback');
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('WellBuddy ERP API')
    .setDescription('자동화 회계 ERP API. 웹은 쿠키(wb_at), 모바일 앱은 Bearer 토큰으로 인증한다.')
    .setVersion('0.1.0')
    .addCookieAuth('wb_at')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
