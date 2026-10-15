import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { VisibleResource } from '@/shared/application/visibility.port';

export const VISIBLE_TO_KEY = 'visible_to';
export type IdExtractor = (req: Request) => unknown[];
export interface VisibleToMeta {
  resource: VisibleResource;
  ids: IdExtractor;
}

/**
 * O pedido só segue se o utilizador puder ver os registos indicados (agente: os seus; gestor: os da equipa;
 * "Ver dados de todos os agentes": todos). Falha com 404 — não revela se o registo existe.
 * Corre ANTES da validação dos DTOs, por isso os extractores aceitam qualquer coisa e ignoram o que não for inteiro.
 */
export const VisibleTo = (resource: VisibleResource, ids: IdExtractor) => SetMetadata(VISIBLE_TO_KEY, { resource, ids } satisfies VisibleToMeta);

/** extractores comuns */
export const fromParam = (name: string): IdExtractor => (req) => [req.params?.[name]];
export const fromBody = (...path: string[]): IdExtractor => (req) => {
  let cur: unknown = req.body;
  for (const key of path) {
    if (Array.isArray(cur)) cur = cur.map((x) => (x as Record<string, unknown> | null)?.[key]);
    else cur = (cur as Record<string, unknown> | null | undefined)?.[key];
  }
  return Array.isArray(cur) ? cur : [cur];
};
