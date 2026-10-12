import { ParseIntPipe } from '@nestjs/common';

/** Pipe para ids numéricos em parâmetros de rota (400 se inválido). */
export const IdPipe = new ParseIntPipe({ errorHttpStatusCode: 400 });
