import * as http from 'node:http';
import * as https from 'node:https';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** aceitar certificados autoassinados (comum num Business One instalado localmente); nunca em produção */
  insecureTls?: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Fronteira de rede do conector: nos testes é substituída por um falso. */
export abstract class HttpTransport {
  abstract send(req: HttpRequest): Promise<HttpResponse>;
}

const MAX_BODY = 20 * 1024 * 1024;

export class NodeHttpTransport extends HttpTransport {
  send(req: HttpRequest): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(req.url);
      const lib = url.protocol === 'https:' ? https : http;
      const r = lib.request(
        url,
        {
          method: req.method,
          headers: { ...req.headers, ...(req.body ? { 'Content-Length': Buffer.byteLength(req.body) } : {}) },
          timeout: req.timeoutMs,
          ...(url.protocol === 'https:' && req.insecureTls ? { rejectUnauthorized: false } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) {
              r.destroy(new Error('Resposta do ERP demasiado grande'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        },
      );
      r.on('timeout', () => r.destroy(new Error(`Sem resposta em ${req.timeoutMs / 1000}s`)));
      r.on('error', reject);
      if (req.body) r.write(req.body);
      r.end();
    });
  }
}
