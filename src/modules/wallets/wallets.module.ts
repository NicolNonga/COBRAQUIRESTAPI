import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import * as U from './application/wallet.use-cases';
import { WalletRepository } from './domain/wallet.repository';
import { TypeOrmWalletRepository } from './infrastructure/typeorm-wallet.repository';
import { UserWalletOrmEntity } from './infrastructure/user-wallet.orm-entity';
import { WalletsController } from './presentation/wallets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserWalletOrmEntity]), UsersModule],
  controllers: [WalletsController],
  providers: [
    { provide: WalletRepository, useClass: TypeOrmWalletRepository },
    U.AddDebtorToWalletUseCase,
    U.RemoveDebtorsFromWalletUseCase,
    U.TransferDebtorsUseCase,
    U.ListWalletDebtorsUseCase,
  ],
})
export class WalletsModule {}
