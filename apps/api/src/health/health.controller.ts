import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReadinessService } from './readiness.service';

/**
 * Bump this string whenever you need to confirm a specific build is live on
 * Render. /api/build-info echoes it back, so a changed value proves the new
 * commit is actually running (independent of RENDER_GIT_COMMIT).
 */
const BUILD_MARKER = 'build-info+bootstrap-status-diagnostic-2026-06-25';

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

  /**
   * Temporary deploy-verification probe. Reports WHICH build/commit is running
   * and the presence (never the value) of the bootstrap env vars, so we can tell
   * whether Render is serving the latest main and whether the bootstrap inputs
   * are configured. Lives on the always-registered HealthController, so it is a
   * reliable canary: if this route is live but /api/admin/bootstrap-demo-status
   * is not, the problem is AdminModule registration, not the deploy. Remove once
   * the bootstrap login issue is resolved.
   */
  @Get('build-info')
  buildInfo() {
    return {
      buildMarker: BUILD_MARKER,
      // Render injects these automatically for git-deployed services.
      gitCommit: process.env.RENDER_GIT_COMMIT ?? null,
      gitBranch: process.env.RENDER_GIT_BRANCH ?? null,
      serviceName: process.env.RENDER_SERVICE_NAME ?? null,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      env: {
        bootstrapTokenPresent: Boolean(process.env.BOOTSTRAP_TOKEN),
        bootstrapDemo: process.env.BOOTSTRAP_DEMO ?? null,
        demoPasswordPresent: Boolean(process.env.DEMO_PASSWORD),
        passwordPepperPresent: Boolean(process.env.PASSWORD_PEPPER),
      },
      // The bootstrap controller's registration is confirmed by the existence of
      // the route below — hit it to verify AdminModule loaded.
      bootstrapStatusRoute: '/api/admin/bootstrap-demo-status',
      time: new Date().toISOString(),
    };
  }
}
