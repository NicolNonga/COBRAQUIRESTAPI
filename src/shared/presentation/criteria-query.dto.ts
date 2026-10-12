import { applyDecorators, BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional, ApiQuery } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Sort } from '@/shared/domain/criteria';

/** Base de todas as queries de listagem: paginação + pesquisa livre + ordenação. */
export class ListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  perPage: number = 10;

  @ApiPropertyOptional({ description: 'Pesquisa livre (ignora maiúsculas e acentos)' })
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Ordenação: campo:asc|desc, separados por vírgula. Ex.: dueDate:asc,amount:desc' })
  @IsOptional() @IsString() @MaxLength(200)
  sort?: string;
}

/** `"a:asc,b:desc"` → Sort[] validado contra a whitelist do recurso (400 se inválido). */
export const parseSort = <F extends string>(raw: string | undefined, allowed: readonly F[]): Sort<F>[] | undefined => {
  if (!raw) return undefined;
  return raw.split(',').map((part) => {
    const [field, dir = 'asc'] = part.trim().split(':');
    if (!allowed.includes(field as F)) throw new BadRequestException(`Ordenação não permitida por '${field}'. Use: ${allowed.join(', ')}`);
    const d = dir.toLowerCase();
    if (d !== 'asc' && d !== 'desc') throw new BadRequestException(`Direcção inválida '${dir}' (asc|desc)`);
    return { field: field as F, direction: d === 'asc' ? 'ASC' : 'DESC' };
  });
};

/** query string → boolean ('true'/'1' → true, 'false'/'0' → false, resto → undefined) */
export const toBool = () =>
  Transform(({ value }) => (value === 'true' || value === '1' || value === true ? true : value === 'false' || value === '0' || value === false ? false : undefined));

/** "1,2,3" ou ?x=1&x=2 → number[] */
export const toIntArray = () =>
  Transform(({ value }) => (value === undefined ? undefined : (Array.isArray(value) ? value : String(value).split(',')).map((v) => Number(v))));

/**
 * Documenta no Swagger os campos de ordenação permitidos para o endpoint
 * (substitui a descrição genérica do parâmetro `sort` herdado de ListQueryDto).
 */
export const ApiSort = (allowed: readonly string[], example?: string) =>
  applyDecorators(
    ApiQuery({
      name: 'sort',
      required: false,
      type: String,
      description: `Ordenação \`campo:asc|desc\`, vários separados por vírgula. Campos permitidos: **${allowed.join(', ')}**`,
      example: example ?? `${allowed[0]}:desc`,
    }),
  );
