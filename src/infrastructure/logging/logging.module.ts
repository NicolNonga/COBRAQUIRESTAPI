import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Logs estruturados (JSON) com pino:
 *  - correlation-id por pedido (header `x-request-id`, gerado se ausente);
 *  - redacção de segredos (password, token, authorization);
 *  - nível ajustado ao status HTTP (5xx=error, 4xx=warn);
 *  - formato legível em desenvolvimento (pino-pretty).
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const isProd = cfg.get('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level: cfg.get<string>('LOG_LEVEL', 'info'),
            base: { app: cfg.get<string>('APP_NAME'), env: cfg.get<string>('NODE_ENV') },
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const existing = req.headers['x-request-id'];
              const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                '*.password',
                '*.newPassword',
                '*.currentPassword',
                '*.token',
                '*.accessToken',
                '*.refreshToken',
                '*.secret',
                '*.credentials',
                '*.credentials.*',
                '*.passwordHash',
                'req.headers["x-api-key"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            serializers: {
              req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
                ip: req.remoteAddress,
              }),
            },
            autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
            transport: isProd ? undefined : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } },
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
