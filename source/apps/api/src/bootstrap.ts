import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

export function validateDevelopmentConfiguration() {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '') || process.env.AUTH_MODE !== 'development') {
    throw new Error('The current demo supports only explicitly enabled development authentication: set NODE_ENV=development/test and AUTH_MODE=development. Production/Keycloak authentication is not implemented.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const origin = process.env.WEB_ORIGIN;
  if (!origin) throw new Error('WEB_ORIGIN must be an exact allowed application origin.');
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('WEB_ORIGIN must contain only scheme, hostname and optional port.');
}

export async function createApp() {
  validateDevelopmentConfiguration();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], bodyParser: false });
  app.use(json({ limit: '16kb' }));
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Correlation-ID', 'X-Workspace-User-ID', 'X-Workspace-Facility-ID'], methods: ['GET', 'POST', 'OPTIONS'] });
  app.setGlobalPrefix('api/v1');
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('LabCopilot Phase 3 API').setDescription('Synthetic patient, specimen and versioned analytical workflows. Synthetic deterministic rules and manual QC gate; no clinical approval, AI or interoperability.').setVersion('3').addCookieAuth('labcopilot_session').build());
  SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
  return app;
}

