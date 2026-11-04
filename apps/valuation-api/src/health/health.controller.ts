import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator.js';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
