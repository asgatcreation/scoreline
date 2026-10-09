import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { DemoService } from '../demo/demo.service.js';
import { IngestService } from '../ingest/ingest.service.js';

/**
 * Public, read-only view of how the data pipeline is doing: provider
 * budgets, last ingest runs and database health. No secrets in here.
 */
@Controller('v1/status')
export class StatusController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
    private readonly demo: DemoService,
  ) {}

  @Get()
  async status() {
    const database = await this.prisma.isHealthy();
    const lastRuns = database
      ? await this.prisma.ingestRun.findMany({
          orderBy: { startedAt: 'desc' },
          take: 10,
          select: {
            job: true,
            provider: true,
            startedAt: true,
            ok: true,
            requests: true,
            changes: true,
            error: true,
          },
        })
      : [];
    return {
      database: database ? 'ok' : 'unreachable',
      liveProvider: this.ingest.liveProvider,
      demo: this.demo.enabled,
      quotas: this.ingest.quotas(),
      lastRuns: lastRuns.map((r) => ({ ...r, error: r.error ? 'failed' : null })),
    };
  }
}
