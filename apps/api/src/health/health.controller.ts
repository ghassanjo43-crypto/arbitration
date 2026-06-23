import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReadinessService } from './readiness.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  /**
   * Liveness — the process is up and serving. Intentionally checks NO external
   * dependencies, so a transient provider blip does not cause the platform to be
   * restarted by the orchestrator. This is the Render `healthCheckPath`.
   */
  @Get('health')
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() };
  }

  /**
   * Readiness — the service is actually usable: DB, migrations, storage, video,
   * email config and screening. Returns 503 when not ready so uptime monitoring
   * (not the orchestrator's restart loop) can alert.
   */
  @Get('readiness')
  async readinessCheck(@Res() res: Response) {
    const result = await this.readiness.check();
    res.status(result.status === 'ready' ? 200 : 503).json(result);
  }
}
