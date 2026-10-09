import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { UsageStore } from '../providers/provider-http.js';
import type { ProviderName } from '../providers/types.js';

/** Saves each provider's daily request count in ProviderUsage. */
@Injectable()
export class PrismaUsageStore implements UsageStore {
  constructor(private readonly prisma: PrismaService) {}

  async load(provider: ProviderName, day: string): Promise<number> {
    const row = await this.prisma.providerUsage.findUnique({
      where: { provider_day: { provider, day: new Date(`${day}T00:00:00Z`) } },
    });
    return row?.requests ?? 0;
  }

  async increment(provider: ProviderName, day: string, error?: string): Promise<void> {
    const date = new Date(`${day}T00:00:00Z`);
    const errorFields = error
      ? { errors: { increment: 1 }, lastError: error.slice(0, 500), lastErrorAt: new Date() }
      : {};
    await this.prisma.providerUsage.upsert({
      where: { provider_day: { provider, day: date } },
      create: {
        provider,
        day: date,
        requests: 1,
        errors: error ? 1 : 0,
        lastError: error?.slice(0, 500),
        lastErrorAt: error ? new Date() : undefined,
      },
      update: { requests: { increment: 1 }, ...errorFields },
    });
  }
}
