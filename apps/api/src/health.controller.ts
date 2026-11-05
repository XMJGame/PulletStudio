import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard';
import { DatabaseService } from './db/database.service';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}
  @Get('live')
  live() {
    return { status: 'ok', service: 'pullet-studio-api', stage: 'M1-foundation' };
  }
  @Get('ready')
  ready() {
    this.database.sqlite.prepare('SELECT 1').get();
    return { status: 'ok', database: 'sqlite' };
  }
}
