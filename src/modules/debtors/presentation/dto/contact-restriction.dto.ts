import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { RESTRICTION_SOURCES, RestrictionSource } from '@/shared/application/contact-restrictions.port';

export class AddRestrictionDto {
  @ApiProperty({ enum: ['EMAIL', 'SMS', 'ALL'] }) @IsIn(['EMAIL', 'SMS', 'ALL']) channel: 'EMAIL' | 'SMS' | 'ALL';
  @ApiProperty({ enum: RESTRICTION_SOURCES }) @IsIn([...RESTRICTION_SOURCES]) source: RestrictionSource;
  @ApiProperty({ description: 'Como e quando o devedor pediu (fica como prova)' }) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class LiftRestrictionDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}
