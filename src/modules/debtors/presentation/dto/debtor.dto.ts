import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/** multipart/form-data: números e booleanos chegam como string → @Type/@Transform */
export class DebtorDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(30) nif: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @Matches(/^\+?[0-9 ]{6,20}$/) phone_number: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) address: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) social_reason?: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) organizationId: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) typeDebtor_id: number;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() is_company?: boolean;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) contact_person_name: string;
  @ApiProperty() @IsEmail() contact_person_email: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) contact_person_contact: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) contact_person_position: string;
  @ApiProperty({ type: 'string', format: 'binary', required: false }) file?: unknown;
}
