# Cobra Aqui API — NestJS + TypeORM + PostgreSQL

Migração da API AdonisJS (Lucid/MySQL) para **NestJS 10 + TypeORM 0.3 + PostgreSQL 16**, com Clean Architecture modular, logs estruturados, auditoria, idempotência e protecção contra race conditions.

## Arranque

```bash
cp .env.example .env            # ajustar segredos
docker compose up -d postgres
npm install
npm run migration:run           # cria o schema (src/infrastructure/database/migrations/schema.sql)
ADMIN_EMAIL=admin@empresa.ao ADMIN_PASSWORD='senha-forte-123' npm run seed
npm run start:dev               # http://localhost:3333/api  · Swagger: /api/docs
npm test                        # testes de domínio (Money, calculadora, política de negociação, facturas)
```

> Para compilar com `nest build`, copie também `schema.sql` para `dist` (ou adicione `"assets": ["**/*.sql"]` em `nest-cli.json` → `compilerOptions`).

## Arquitectura

```
src/
  shared/            núcleo sem frameworks: erros de domínio, Money (decimal), paginação, PORTAS
                     (UnitOfWork, AuditTrail, DistributedLock, Mailer, FileStorage, PasswordHasher, Clock…)
  infrastructure/    adaptadores: TypeORM/UnitOfWork (AsyncLocalStorage), pg advisory lock,
                     pino, filtro de excepções, idempotência, auditoria, storage local, SMTP, bcrypt
  modules/<módulo>/
    domain/          entidades/regras puras + portas de repositório (classes abstractas = tokens DI)
    application/     1 caso de uso = 1 classe (SRP); depende só de portas (DIP)
    infrastructure/  entidades TypeORM + repositórios concretos
    presentation/    controllers finos + DTOs (class-validator + Swagger)
```

Módulos: `auth`, `users`, `access-control`, `organizations`, `debtors`, `catalogs`, `invoices`, `processes` (inclui contactos e transferências), `wallets`, `negotiations`, `notifications` (+ WebSocket), `imports`, `scheduler`.

**SOLID na prática**
- *SRP*: cada caso de uso tem uma responsabilidade; controllers só traduzem HTTP.
- *DIP / não depender de implementações*: casos de uso injectam `abstract class` (ex.: `InvoiceRepository`, `UnitOfWork`); o módulo liga a porta à implementação (`{ provide: Port, useClass: Impl }`).
- *ISP*: portas pequenas e específicas (`ProcessLookup` para negociações, `ProcessQueries` para leitura, `NotificationPublisher` para outros módulos, `CatalogReader`/`ContactTypeWriter`).
- *LSP*: qualquer implementação de uma porta (ex.: `Mailer` SMTP vs. fake em testes) é substituível sem alterar os casos de uso.
- CQRS-lite: escrita em `*Repository`, listagens em `*Queries`.

## Finanças: atomicidade, concorrência e idempotência

| Risco | Solução |
|---|---|
| Erros de vírgula flutuante | `NUMERIC(18,2)` na BD, strings na API, `decimal.js` no domínio (`Money`). Comparações exactas, sem tolerâncias. |
| Operações parciais | `UnitOfWork.run()` — transacção propagada por AsyncLocalStorage; efeitos externos (e-mail, socket) só em `afterCommit`. |
| Duplicados por corrida (SELECT→INSERT) | Unicidade na BD + `INSERT … ON CONFLICT`. Ex.: 1 processo aberto por devedor (índice único parcial), factura em 1 só processo, devedor em 1 só carteira, 1 responsável por processo, processo em 1 só negociação activa. |
| Duas negociações/transferências simultâneas | `SELECT … FOR UPDATE` ordenado por id (sem deadlocks) + índice único parcial como última barreira. |
| Duplo clique / retry de rede | Header `Idempotency-Key` (obrigatório em criar negociação e transferir processos): reenvio devolve a resposta original. |
| Jobs em várias réplicas | `pg_try_advisory_xact_lock` por job + bloqueio de reentrância. `FOR UPDATE SKIP LOCKED` nos candidatos. |
| Retry de serialização | `UnitOfWork` repete em `40001`/`40P01` com backoff. |
| Invariantes | `CHECK`s na BD (total = dívida − desconto, final ≤ total, valores > 0, datas coerentes). Auditoria `audit_logs` append-only (trigger). |
| Dívida forjada pelo cliente | Ao criar negociação, `debtAmount` tem de ser igual à soma real das facturas dos processos. |

Testado contra PostgreSQL 16: geração de processos com 4 sessões concorrentes (exactamente 1 processo por devedor, sem facturas duplicadas) e duas negociações simultâneas sobre o mesmo processo (a segunda é rejeitada).

## N+1 eliminados (exemplos)

| Original | Agora |
|---|---|
| Cron de processos: ~4 queries por factura | 1 statement (CTE) para todas |
| Atribuição por carteira: 2 queries por carteira | 1 `INSERT … SELECT` |
| Import de devedores/facturas: 3–5 queries por linha | 3–4 lookups para o ficheiro inteiro + inserts em lote de 500 |
| Validadores Vine com query por item de array | 1 query `ANY($1)` no caso de uso |
| Remover facturas do processo / carteiras: 1–3 queries por item | 1 statement |
| Dashboard devedores: 4 queries | 1 query com `FILTER` |
| Listagens com relações N:N + paginação | página por id + 1 query `IN` para as relações |
| Estados de factura/processo pesquisados por nome em cada pedido | cache em memória por `code` |

## Logs de sistema

- `nestjs-pino`: JSON em produção, legível em dev; `x-request-id` por pedido (gerado ou propagado) e devolvido no header.
- Redacção de `authorization`, `password`, `token`.
- Queries lentas (> `DB_LOG_SLOW_QUERY_MS`) e erros SQL registados; jobs registam resultado e duração.
- `audit_logs`: quem (utilizador, IP, request-id) fez o quê em cada operação de negócio — gravado na mesma transacção.

## Segurança corrigida face ao original

- Todas as rotas exigem JWT por omissão (`@Public()` só em login/recuperação); muitas rotas originais estavam abertas.
- `PUT /users/new_password` alterava a senha de **qualquer** email; agora só a própria, exigindo a actual.
- Socket.IO autenticado por JWT; antes qualquer cliente entrava na sala de qualquer utilizador e as notificações eram também emitidas em broadcast global.
- Tokens de reset guardados como SHA-256, uso único atómico, sem revelar se o email existe; senhas geradas com `crypto` (não `Math.random`).
- `token_version`: logout, troca de senha e desactivação invalidam JWTs emitidos.
- Rate-limit no login/recuperação, `helmet`, uploads em memória com limite e validação de mimetype, protecção contra path traversal.

## Bugs do original corrigidos

- Job de vencidas marcava como "Vencida" facturas **pagas/canceladas**; agora só estados abertos.
- Geração de processos usava todas as facturas com vencimento passado (incl. pagas).
- `transferenciaDefinitiva` era gravada invertida; transferências temporárias nunca regressavam (agora há job de devolução).
- `GET /invoices/overdue` filtrava por coluna inexistente; atribuição automática filtrava `processes.status` inexistente.
- Import de facturas ignorava a coluna Moeda (`%KZ%` fixo); import de organizações fixava `address = 'Belas'`.
- Remoção de logo antigo antes de gravar o novo; e-mails enviados mesmo quando a gravação falhava.

## Contrato da API

Rotas mantidas com os mesmos caminhos e nomes de campos de entrada (incluindo grafias como `desable`, `assgin_user`, `curriency`) para o frontend continuar a funcionar. Diferenças a ajustar no frontend:
- respostas em camelCase das entidades (ex.: `phoneNumber`, `referenceNumber`, `debtorType`);
- valores monetários em string (`"1500.00"`);
- paginação `{ meta: { total, perPage, currentPage, lastPage, firstPage }, data }`;
- login devolve `data.token.token` (JWT Bearer, 1h);
- `POST /api/negotiations` e `POST /api/process/transfere` exigem `Idempotency-Key`;
- `PUT /api/users/new_password` recebe `{ currentPassword, newPassword }`;
- novos: `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/negotiations/:id/cancel`, simuladores `calculate-values`, `generate-installments`, `calculate-overdue`, `GET /health`.

## Fora de âmbito / decisões

- Modelos sem rotas no original (peças, veículos, stock, pagamentos, clientes, logs de app) não foram migrados.
- Migração de dados MySQL → PostgreSQL não incluída: as tabelas mudaram de nome (`user_walltets` → `user_wallets`, `parcela_negocicaos` → `negotiation_installments`, `transfere_process_agents` → `process_transfers`) e colunas (`refencence_number` → `reference_number`, `processe_id` → `process_id`). Estados passam a ter `code` estável em vez de nomes via `.env`.
- Mantida a regra original de 1 contacto por processo (`ux_contacts_process`) — provavelmente deve ser removida para registar histórico de contactos.
- Limite de multa configurável (`MAX_PENALTY_PERCENT`, por omissão 2%): a regra original citava o CDC brasileiro; confirmar o enquadramento legal angolano.
- `RequirePermissions('slug')` + `PermissionsGuard` estão prontos, mas não aplicados às rotas porque os slugs são dados; aplicar quando o catálogo de permissões estiver fechado.

## Outbox / Inbox (entrega fiável de e-mails e notificações)

```
caso de uso ── UnitOfWork ──┬─ INSERT negócio (ex.: users, process_transfers)
                            └─ INSERT outbox_messages  ← mesma transacção (email.send, notification.requested)
                                       │ trigger pg_notify('outbox_new')
                                       ▼
OutboxDispatcher (em cada réplica) ── claim FOR UPDATE SKIP LOCKED + lease
  email.send             → 'mail.smtp-sender'          (externo, at-least-once)
  notification.requested → 'notifications.persist'     (transaccional, exactly-once: inbox + INSERT notifications
                                                          + outbox notification.created na mesma tx)
  notification.created   → 'notifications.socket-push' (externo, Socket.IO)
  inbox_messages(message_id, handler) = cada handler conclui no máximo uma vez com sucesso
  sucesso → SENT (payload sensível apagado) · falha transitória → PENDING com backoff · esgotou/permanente → DEAD
```

- **Outbox**: produtores chamam `Outbox.enqueue()` dentro da transacção. Nunca há e-mail enviado para um utilizador cuja criação fez rollback, nem utilizador criado sem e-mail.
- **Inbox**: chave `(message_id, handler)`. Handlers `transactional: true` gravam a inbox na mesma transacção dos seus efeitos (exactly-once). Handlers externos (SMTP, socket) são at-least-once, e a inbox impede reenvio após sucesso quando outro handler da mesma mensagem falha.
- **Retry**: backoff exponencial com jitter (30 s → 1 h). Erros SMTP 5xx/destinatário inválido são permanentes e vão directo para `DEAD`. Por omissão `max_attempts` = 10 (reset de senha: 6, notificações: 5).
- **Concorrência**: `FOR UPDATE SKIP LOCKED` (N réplicas sem duplicar), lease com expiração (crash recovery), fencing por `locked_by` (worker antigo não confirma mensagem que já não é sua).
- **Segurança**: payloads com senhas/tokens são cifrados (AES-256-GCM, `OUTBOX_ENCRYPTION_KEY`) e apagados depois de enviados. A API de administração nunca devolve payloads.
- **Latência**: LISTEN/NOTIFY acorda o dispatcher logo após o commit; polling (`OUTBOX_POLL_MS`) é a rede de segurança.
- **Operação**:
  - `GET /api/outbox/stats`, `GET /api/outbox?status=DEAD` e `POST /api/outbox/retry { ids }` exigem a permissão `outbox_manage_permission`, atribuída ao super-admin pela migração.
  - Logs com `alert: OUTBOX_DEAD_LETTER` devem ligar um alerta no agregador de logs.
  - Limpeza automática: SENT > 7 dias, inbox > 30 dias.
- **Novo consumidor**: criar uma classe com `@OutboxHandler({ name, types, transactional })` e registá-la como provider; é descoberta automaticamente.

## Permissões

As permissões **não são criadas pela interface**. Estão definidas no código em
`src/modules/access-control/domain/permission-catalog.ts` (nome, descrição e área de cada uma).

- No arranque da API e no `npm run seed`, o catálogo é sincronizado com a tabela `permissions`.
  Permissões novas são atribuídas aos perfis indicados em `defaultRoles` (Gestor/Agente).
- O perfil **super-admin recebe sempre todas as permissões** e não é possível retirar-lhas.
- Cada rota é protegida com `@RequirePermissions(P.ALGUMA_COISA)`; o `PermissionsGuard` global
  devolve 403 com uma mensagem legível quando falta a permissão. As permissões são lidas da BD em
  cada pedido, por isso alterar um perfil tem efeito imediato.
- Para uma nova funcionalidade: acrescente a entrada ao catálogo, use a constante `P.X` no controller
  e reinicie a API.
