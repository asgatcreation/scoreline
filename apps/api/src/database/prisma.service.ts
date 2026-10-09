import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { normaliseSslMode } from './database-url.js';

/**
 * The one Prisma client for the app. Connects lazily on first query, so the
 * API can boot (and answer /healthz) while a sleeping Neon database wakes.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.');
    }
    const adapter = new PrismaPg({
      connectionString: normaliseSslMode(config.databaseUrl),
      // Free Neon computes take a few seconds to wake up.
      connectionTimeoutMillis: 20_000,
      max: 5,
    });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /** True when the database answers a trivial query. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
