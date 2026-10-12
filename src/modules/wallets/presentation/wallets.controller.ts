import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/infrastructure/idempotency/idempotent.decorator';
import { IdPipe } from '@/shared/presentation/id-param.dto';
import * as U from '../application/wallet.use-cases';
import { AddToWalletDto, RemoveFromWalletDto, TransferDebtorsDto } from './dto/wallet.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

@ApiTags('Carteiras')
@ApiBearerAuth()
@Controller('user_wallet')
export class WalletsController {
  constructor(
    private readonly add: U.AddDebtorToWalletUseCase,
    private readonly removeDebtors: U.RemoveDebtorsFromWalletUseCase,
    private readonly transfer: U.TransferDebtorsUseCase,
    private readonly list: U.ListWalletDebtorsUseCase,
  ) {}

  @Post()
  @RequirePermissions(P.WALLET_MANAGE)
  async store(@Body() dto: AddToWalletDto) {
    await this.add.execute(dto.userId, dto.debtorId);
    return { message: 'Devedor adicionado à carteira' };
  }

  @Get('user/:userId')
  @RequirePermissions(P.WALLET_VIEW)
  async ofUser(@Param('userId', IdPipe) userId: number) {
    return { data: await this.list.execute(userId) };
  }

  @Post('remove/debtors')
  @HttpCode(200)
  @RequirePermissions(P.WALLET_MANAGE)
  async remove(@Body() dto: RemoveFromWalletDto) {
    const n = await this.removeDebtors.execute(dto.debtorsId.map((d) => d.debtor_id));
    return { message: 'Devedor removido da carteira', count: n };
  }

  @Post('transfere/debtors')
  @HttpCode(200)
  @Idempotent({ required: false })
  @RequirePermissions(P.WALLET_MANAGE)
  async transferDebtors(@Body() dto: TransferDebtorsDto) {
    const n = await this.transfer.execute(dto.userId, dto.debtors.map((d) => d.debtorId));
    return { message: 'Devedor transferido', count: n };
  }
}
