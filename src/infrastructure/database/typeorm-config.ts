import { ConfigService } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** TLS para a BD: valida o certificado do servidor (CA própria opcional). */
const sslOptions = (cfg: Pick<ConfigService, 'get'>) => {
  if (String(cfg.get('DB_SSL')) !== 'true') return false;
  const rawCa = String(cfg.get('DB_SSL_CA') ?? '').trim();
  const ca = !rawCa ? undefined : rawCa.includes('BEGIN CERTIFICATE') ? rawCa : existsSync(rawCa) ? readFileSync(rawCa, 'utf8') : undefined;
  return { rejectUnauthorized: String(cfg.get('DB_SSL_REJECT_UNAUTHORIZED') ?? 'true') !== 'false', ...(ca ? { ca } : {}) };
};

export const buildDataSourceOptions = (cfg: Pick<ConfigService, 'get'>): DataSourceOptions => ({
  type: 'postgres',
  host: cfg.get<string>('DB_HOST'),
  port: Number(cfg.get('DB_PORT') ?? 5432),
  username: cfg.get<string>('DB_USER'),
  password: cfg.get<string>('DB_PASSWORD'),
  database: cfg.get<string>('DB_DATABASE'),
  ssl: sslOptions(cfg),
  namingStrategy: new SnakeNamingStrategy(),
  entities: [join(__dirname, '..', '..', '**', '*.orm-entit{y,ies}.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'schema_migrations',
  synchronize: false, // NUNCA em finanças: schema só via migrações revistas
  migrationsRun: false,
  maxQueryExecutionTime: Number(cfg.get('DB_LOG_SLOW_QUERY_MS') ?? 500),
  extra: {
    max: Number(cfg.get('DB_POOL_MAX') ?? 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
    application_name: cfg.get<string>('APP_NAME') ?? 'cobra-aqui-api',
  },
});
