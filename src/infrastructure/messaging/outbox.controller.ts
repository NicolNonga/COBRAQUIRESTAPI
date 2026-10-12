import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { UnitOfWork } from '@/shared/application/unit-of-work.port';
import { OutboxStatus } from './outbox-message.orm-entity';
import { CircuitBreakerRegistry } from '../resilience/circuit-breaker.registry';
import { OutboxStore } from './outbox-store';

class OutboxQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'PROCESSING', 'SENT', 'DEAD'] })
  @IsOptional() @IsIn(['PENDING', 'PROCESSING', 'SENT', 'DEAD']) status?: OutboxStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage: number = 20;
}

class RetryDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4', { each: true }) ids: string[];
}

@ApiTags('Outbox (administração)')
@ApiBearerAuth()
@RequirePermissions('outbox_manage_permission')
@Controller('outbox')
export class OutboxController {
  constructor(
    private readonly store: OutboxStore,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditTrail,
    private readonly circuits: CircuitBreakerRegistry,
  ) {}

  @Get('circuits')
  @ApiOperation({ summary: 'Estado dos circuit breakers desta instância (smtp, …)' })
  circuitsState() {
    return { data: this.circuits.snapshots() };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Contagem de mensagens por estado' })
  async stats() {
    return { data: await this.store.stats() };
  }

  @Get()
  @ApiOperation({ summary: 'Listar mensagens (payload nunca é exposto)' })
  async list(@Query() q: OutboxQuery) {
    const { data, total } = await this.store.page(q.status, q.type, q.perPage, (q.page - 1) * q.perPage);
    return { meta: { total, perPage: q.perPage, currentPage: q.page, lastPage: Math.max(1, Math.ceil(total / q.perPage)), firstPage: 1 }, data };
  }

  @Post('retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reenviar mensagens em DEAD (após corrigir a causa)' })
  retry(@Body() dto: RetryDto) {
    return this.uow.run(async () => {
      const count = await this.store.retry(dto.ids);
      await this.audit.record({ action: 'OUTBOX_RETRY', entity: 'outbox_message', payload: { ids: dto.ids, count } });
      return { message: `${count} mensagem(ns) reenfileirada(s)`, count };
    });
  }
}
