import * as Joi from 'joi';

/**
 * Validação das variáveis de ambiente no arranque.
 * Falha rápida (fail-fast): a aplicação não sobe com configuração inválida.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3333),
  APP_NAME: Joi.string().default('cobra-aqui-api'),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  // em produção as origens têm de ser listadas (nunca '*')
  CORS_ORIGINS: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.string().invalid('*').required(), otherwise: Joi.string().default('*') }),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_DATABASE: Joi.string().required(),
  DB_POOL_MAX: Joi.number().integer().min(1).default(20),
  DB_SSL: Joi.boolean().default(false),
  // com SSL o certificado do servidor é validado; só desligue em desenvolvimento
  DB_SSL_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  // CA do servidor de BD: caminho do ficheiro .pem ou o próprio PEM
  DB_SSL_CA: Joi.string().allow('').default(''),
  DB_LOG_SLOW_QUERY_MS: Joi.number().integer().min(1).default(500),

  // em produção recusa-se o valor de exemplo do .env.example
  JWT_SECRET: Joi.string().min(32).required().when('NODE_ENV', { is: 'production', then: Joi.string().invalid('troque-isto-por-um-segredo-com-pelo-menos-32-caracteres') }),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  // quem emite e a quem se destina o token: um JWT assinado com o mesmo segredo para outro fim é recusado
  JWT_ISSUER: Joi.string().default('cobraqui-api'),
  JWT_AUDIENCE: Joi.string().default('cobraqui-app'),
  // bloqueio de conta contra credential stuffing: N falhas seguidas bloqueiam o email durante M minutos
  LOGIN_MAX_FAILURES: Joi.number().integer().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
  // documentação interactiva: desligada por omissão em produção
  SWAGGER_ENABLED: Joi.boolean().when('NODE_ENV', { is: 'production', then: Joi.boolean().default(false), otherwise: Joi.boolean().default(true) }),
  // rejeitar (400) campos não declarados nos DTOs em vez de os descartar em silêncio
  REJECT_UNKNOWN_FIELDS: Joi.boolean().default(false),
  // cookie de sessão (HttpOnly). Secure obrigatório em produção; SameSite=none só com frontend noutro domínio
  AUTH_COOKIE_SECURE: Joi.boolean().when('NODE_ENV', { is: 'production', then: Joi.boolean().valid(true).default(true), otherwise: Joi.boolean().default(false) }),
  AUTH_COOKIE_SAMESITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
  AUTH_COOKIE_DOMAIN: Joi.string().allow('').default(''),

  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USERNAME: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().required(),

  LINK_FORGET_PASSWORD: Joi.string().uri({ allowRelative: false }).required(),
  UPLOAD_DIR: Joi.string().default('uploads'),
  MAX_UPLOAD_MB: Joi.number().min(1).default(10),
  MAX_PENALTY_PERCENT: Joi.number().min(0).max(100).default(2),

  OUTBOX_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),
  OUTBOX_DISPATCHER_ENABLED: Joi.boolean().default(true),
  OUTBOX_POLL_MS: Joi.number().integer().min(250).default(5000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).max(500).default(50),
  OUTBOX_CONCURRENCY: Joi.number().integer().min(1).max(50).default(5),
  OUTBOX_LEASE_SECONDS: Joi.number().integer().min(10).default(120),
  OUTBOX_HANDLER_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),

  CRON_COLLECTION_LADDERS: Joi.string().default('50 7 * * *'),
  /** mensagens da régua ao devedor: log = só nos logs (testes); send = envia email por SMTP (SMS ainda sem fornecedor) */
  DEBTOR_MESSAGES_MODE: Joi.string().valid('log', 'send').default('log'),
  LADDER_CATCHUP_DAYS: Joi.number().integer().min(0).max(30).default(2),
  NEGOTIATION_APPROVAL_DISCOUNT_LIMIT_PERCENT: Joi.number().min(0).max(100).default(10),
  NEGOTIATION_LATE_MONTHLY_INTEREST_PERCENT: Joi.number().min(0).max(100).default(1),
  NEGOTIATION_AUTO_BREAK_ENABLED: Joi.boolean().default(false),
  BASE_CURRENCY_CODE: Joi.string().length(3).uppercase().default('AOA'),
  CRON_NEGOTIATION_AUTO_BREAK: Joi.string().default('15 7 * * *'),
  CRON_LADDER_TRACKING: Joi.string().default('*/15 * * * *'),
  CIRCUIT_FAILURE_THRESHOLD: Joi.number().integer().min(1).max(100).default(5),
  CIRCUIT_OPEN_SECONDS: Joi.number().integer().min(1).max(3600).default(30),
  CIRCUIT_MAX_OPEN_SECONDS: Joi.number().integer().min(1).max(86400).default(600),
  /** só para testes: todos os jobs a cada N segundos (ignorado em produção) */
  JOBS_EVERY_SECONDS: Joi.number().integer().min(1).max(59).optional(),
  CRON_NOTIFICATIONS_PURGE: Joi.string().default('30 3 * * *'),
  CRON_INVOICE_OVERDUE: Joi.string().default('*/5 * * * *'),
  CRON_PROCESS_GENERATION: Joi.string().default('*/5 * * * *'),
  CRON_WALLET_ASSIGNMENT: Joi.string().default('*/5 * * * *'),
  CRON_TEMP_TRANSFER_RETURN: Joi.string().default('*/10 * * * *'),
  /** integração com o ERP: cifra das credenciais (64 hex). Opcional: sem ela a API sobe mas não grava credenciais */
  INTEGRATIONS_ENCRYPTION_KEY: Joi.string().hex().length(64).allow('').optional(),
  CRON_INTEGRATION_SYNC: Joi.string().default('*/5 * * * *'),
});
