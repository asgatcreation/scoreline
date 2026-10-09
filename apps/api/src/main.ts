import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { apiPort, corsOrigins } from './config.js';
import { ScorelineIoAdapter } from './realtime/io-adapter.js';

async function bootstrap() {
  // Load apps/api/.env in local development. Variables already set in the
  // environment (e.g. on Render) are never overwritten.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigins(), methods: ['GET', 'POST', 'DELETE'] });
  app.useWebSocketAdapter(new ScorelineIoAdapter(app));
  app.enableShutdownHooks();

  const port = apiPort();
  // Render needs 0.0.0.0; locally listen on IPv4 and IPv6 so "localhost" always works.
  if (process.env.NODE_ENV === 'production') await app.listen(port, '0.0.0.0');
  else await app.listen(port);
  Logger.log(`Scoreline API listening on port ${port}`, 'Bootstrap');
}
await bootstrap();
