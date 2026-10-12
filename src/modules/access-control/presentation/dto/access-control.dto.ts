import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'Gestor de Carteira' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isManager?: boolean;
}

export class UpdateRoleDto extends CreateRoleDto {}

export class RolePermissionDto {
  @ApiProperty() @IsInt() @Min(1) role_id: number;
  @ApiProperty() @IsInt() @Min(1) permission_id: number;
}
