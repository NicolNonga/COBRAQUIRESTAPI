import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca a rota como pública (sem JWT). Por omissão TODAS as rotas exigem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
