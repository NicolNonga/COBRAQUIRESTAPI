import { Global, Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditTrail } from '@/shared/application/audit-trail.port';
import { TypeOrmAuditTrail } from './typeorm-audit-trail';

@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [{ provide: AuditTrail, useClass: TypeOrmAuditTrail }],
  exports: [AuditTrail],
})
export class AuditModule {}
