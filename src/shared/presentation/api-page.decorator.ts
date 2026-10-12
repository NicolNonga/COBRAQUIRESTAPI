import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PageMetaDto } from './pagination.dto';

/** Documenta no Swagger uma resposta paginada `{ meta, data: T[] }`. */
export const ApiPaginatedResponse = <T extends Type<unknown>>(model: T) =>
  applyDecorators(
    ApiExtraModels(PageMetaDto, model),
    ApiOkResponse({
      schema: {
        properties: {
          meta: { $ref: getSchemaPath(PageMetaDto) },
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
        },
      },
    }),
  );
