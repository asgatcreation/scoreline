import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

/** Liveness probe used by Render and the uptime pinger. */
@Controller()
export class HealthController {
  @Get('healthz')
  check(): HealthStatus {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
