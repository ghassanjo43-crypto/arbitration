import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Temporary, UNCONDITIONAL diagnostic for the demo bootstrap.
 *
 * Unlike BootstrapController (which 404s when BOOTSTRAP_TOKEN is unset, to hide
 * its existence), this route is always registered and never gated, so a 200 here
 * positively proves that AdminModule and its admin/* routes are live in the
 * deployed build. It performs NO writes and resets NOTHING — it only reports the
 * presence (never the value) of the bootstrap env vars. Remove once the demo
 * login/bootstrap issue is resolved.
 *
 *   GET /api/admin/bootstrap-demo-status
 */
@Controller('admin/bootstrap-demo-status')
export class BootstrapStatusController {
  @SkipThrottle()
  @Get()
  status() {
    return {
      routeActive: true,
      tokenEnvPresent: Boolean(process.env.BOOTSTRAP_TOKEN),
      demoPasswordPresent: Boolean(process.env.DEMO_PASSWORD),
      bootstrapDemoFlag: process.env.BOOTSTRAP_DEMO ?? null,
      time: new Date().toISOString(),
    };
  }
}
