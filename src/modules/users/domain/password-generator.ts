import { randomInt } from 'node:crypto';

const CHARSET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Gerador criptograficamente seguro (o original usava Math.random, previsível). */
export const generatePassword = (length = 12): string =>
  Array.from({ length }, () => CHARSET[randomInt(CHARSET.length)]).join('');
