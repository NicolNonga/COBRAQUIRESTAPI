import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Public } from './modules/auth/presentation/public.decorator';

@ApiTags('Saúde')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.ds.query('SELECT 1');
      return { status: 'ok', database: 'up', uptime: Math.round(process.uptime()) };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}
