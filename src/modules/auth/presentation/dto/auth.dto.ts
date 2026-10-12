import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsHexadecimal, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@cobraaqui.ao' }) @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsHexadecimal() @Length(64, 64) token: string;
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'A palavra-passe deve conter letras e números' })
  newPassword: string;
}
