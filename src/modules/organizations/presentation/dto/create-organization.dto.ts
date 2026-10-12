import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ example: '+244923000000' }) @Matches(/^\+?[0-9 ]{6,20}$/) phone_number: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) address: string;
  @ApiProperty({ type: 'string', format: 'binary', required: false }) file?: unknown;
}
