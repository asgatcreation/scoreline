import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { DemoService } from './demo/demo.service.js';
import { FootballQueryService } from './football/football-query.service.js';
import { FootballController } from './football/football.controller.js';
import { HealthController } from './health/health.controller.js';
import { ChangeBus } from './ingest/change-bus.js';
import { IngestService } from './ingest/ingest.service.js';
import { SyncService } from './ingest/sync.service.js';
import { PrismaUsageStore } from './ingest/usage-store.js';
import { LiveGateway } from './realtime/live.gateway.js';
import { StatusController } from './status/status.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, FootballController, StatusController],
  providers: [
    ChangeBus,
    DemoService,
    SyncService,
    PrismaUsageStore,
    IngestService,
    FootballQueryService,
    LiveGateway,
  ],
})
export class AppModule {}
