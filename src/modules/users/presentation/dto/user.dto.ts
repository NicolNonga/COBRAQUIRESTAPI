import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fullName?: string | null;
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiPropertyOptional({ example: '+244923000000' }) @IsOptional() @Matches(/^\+?[0-9 ]{6,20}$/) phone_number?: string;
  @ApiProperty() @IsInt() @Min(1) roleId: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) categorie_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) organizationId?: number;
  @ApiPropertyOptional({ description: 'Gestor do agente (se o perfil não for de gestor)' })
  @IsOptional() @IsInt() @Min(1) managerId?: number;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fullName?: string | null;
  @ApiProperty() @IsEmail() email: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?[0-9 ]{6,20}$/) phone_number?: string;
  @ApiProperty() @IsInt() @Min(1) roleId: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) categorie_id?: number;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() currentPassword: string;
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'A palavra-passe deve conter letras e números' })
  newPassword: string;
}
