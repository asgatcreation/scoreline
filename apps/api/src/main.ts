import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { apiPort, corsOrigins } from './config.js';

async function bootstrap() {
  // Load apps/api/.env in local development. Variables already set in the
  // environment (e.g. on Render) are never overwritten.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigins(), methods: ['GET', 'POST', 'DELETE'] });
  app.enableShutdownHooks();

  const port = apiPort();
  await app.listen(port, '0.0.0.0');
  Logger.log(`Scoreline API listening on port ${port}`, 'Bootstrap');
}
await bootstrap();
