import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '@/shared/application/request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, _res: Response, next: NextFunction): void {
    RequestContext.run(
      {
        requestId: String(req.id ?? req.headers['x-request-id'] ?? ''),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      next,
    );
  }
}
