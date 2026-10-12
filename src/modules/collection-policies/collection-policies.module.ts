import { Module } from '@nestjs/common';
import { PolicyRepository } from './domain/policy.repository';
import { TypeOrmPolicyRepository } from './infrastructure/typeorm-policy.repository';

/** Régua master: regras puras + acesso a dados. Os casos de uso/endpoints vivem em collection-ladders. */
@Module({
  providers: [{ provide: PolicyRepository, useClass: TypeOrmPolicyRepository }],
  exports: [PolicyRepository],
})
export class CollectionPoliciesModule {}
