import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as U from './application/organization.use-cases';
import { OrganizationRepository } from './domain/organization.repository';
import { OrganizationOrmEntity } from './infrastructure/organization.orm-entity';
import { TypeOrmOrganizationRepository } from './infrastructure/typeorm-organization.repository';
import { OrganizationsController } from './presentation/organizations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationOrmEntity])],
  controllers: [OrganizationsController],
  providers: [
    { provide: OrganizationRepository, useClass: TypeOrmOrganizationRepository },
    U.CreateOrganizationUseCase,
    U.SetOrganizationActiveUseCase,
    U.UpdateOrganizationUseCase,
    U.ListOrganizationsUseCase,
  ],
  exports: [OrganizationRepository],
})
export class OrganizationsModule {}
