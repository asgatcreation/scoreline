import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, PrismaService],
  exports: [APP_CONFIG, PrismaService],
})
export class DatabaseModule {}
