import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

export class AddToWalletDto {
  @ApiProperty() @IsInt() @Min(1) userId: number;
  @ApiProperty() @IsInt() @Min(1) debtorId: number;
}

class DebtorRefSnake {
  @ApiProperty() @IsInt() @Min(1) debtor_id: number;
}
export class RemoveFromWalletDto {
  @ApiProperty({ type: [DebtorRefSnake] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => DebtorRefSnake)
  debtorsId: DebtorRefSnake[];
}

class DebtorRefCamel {
  @ApiProperty() @IsInt() @Min(1) debtorId: number;
}
export class TransferDebtorsDto {
  @ApiProperty() @IsInt() @Min(1) userId: number;
  @ApiProperty({ type: [DebtorRefCamel] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => DebtorRefCamel)
  debtors: DebtorRefCamel[];
}
