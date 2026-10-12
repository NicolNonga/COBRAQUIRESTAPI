# Tarefas — 06/10/2026

Legenda: `[ ]` por fazer · `[x]` feito · **(D)** = depende de decisão de negócio

## 0. Arranque do dia (validar o que foi feito hoje)
- [ ] `npm run migration:run` — aplica `SearchIndexes` e `ContactHistory` (se ainda não aplicadas)
- [ ] Reiniciar a API e confirmar no log os 3 handlers da outbox: `mail.smtp-sender`, `notifications.persist`, `notifications.socket-push`
- [ ] Teste manual no Swagger: login → criar contacto 2× no mesmo processo → `GET /api/contacts/process/:id` mostra os 2
- [ ] Teste manual: `GET /api/process?noContactSince=...&sort=lastContactAt:asc`
- [ ] Teste manual: criar utilizador agente com `managerId` → gestor recebe notificação (`GET /api/notifications`) e `GET /api/outbox/stats` mostra SENT
- [ ] Fazer commit do estado actual (`git add nestjs-api && git commit`)

## 1. Lembretes internos de vencimento (em curso)
Objectivo: avisar por socket o **agente responsável** e o **gestor** antes/depois do vencimento de facturas e parcelas.
> ⚠️ Os dias (`-3, 0, +1, +7`) **não** podem ficar fixos no backend: implementar já como acção "notificar agente/gestor" da régua dinâmica (secção 5). Fazer as secções 1 e 5 em conjunto.
- [x] SQL da tabela `reminder_deliveries` (dedup) — rascunho em `docs/wip/reminders.sql`, testado em Postgres
- [ ] Migração `1759720000000-Reminders` (usar `docs/wip/reminders.sql`)
- [ ] Repositório: query de facturas a vencer (`offsets -3, 0, +1, +7`, janela de recuperação de 2 dias)
      - destinatário = responsável do processo, senão dono da carteira; excluir pagas/canceladas/em disputa e processos em negociação activa
- [ ] Repositório: query de parcelas de negociações `ACTIVE` (`PENDING`/`OVERDUE`) → responsável do 1.º processo
- [ ] Caso de uso `RunDueRemindersUseCase`: agrupa por destinatário (1 notificação por agente/dia), junta o gestor (`wallet_agents`), publica via `NotificationPublisher` (outbox)
- [ ] Prioridade: antes do vencimento `low`, no dia `medium`, depois `high`
- [ ] Job diário (lock distribuído, `CRON_REMINDERS`, fuso Africa/Luanda) + `POST /api/reminders/run` (permissão `reminders_run_permission`)
- [ ] Env só para parâmetros técnicos (`REMINDER_CATCHUP_DAYS=2`, cron); os dias vêm das etapas da régua
- [ ] Testes: dedup (correr 2× não duplica), concorrência (2 jobs em paralelo), exclusões (paga/disputa)
- [ ] Swagger + README

## 2. Pagamentos, conta-corrente e repasses — ✅ implementado (06/10)
Decisões: A **e** B (por pagamento: `receiver` CREDITOR/AGENCY) · confirma-se pelo comprovativo (gestor da carteira ou `payment_confirm_permission`, nunca quem registou) · anular pendente com motivo · estornar confirmado com motivo · nunca se apaga (triggers na BD) · meios e moedas configuráveis · data = a do comprovativo · parcial aceite · excedente abate as parcelas seguintes e o resto fica crédito do devedor · acordo pago → processo fecha e facturas Liquidadas · comissão % por credor, nas duas opções · repasses com comprovativo e quatro olhos.
- [x] Migração `1759740000000-Payments` (payments, payment_allocations, debtor_credit_entries, creditor_settlements, creditor_ledger_entries, payment_methods, organizations.commission_rate, 4 permissões)
- [x] `POST /payments` (multipart, Idempotency-Key) · `GET /payments` · `GET /payments/pending-confirmation` · `GET /payments/:id` (+alocações) · `GET /payments/:id/proof`
- [x] `POST /payments/:id/confirm` · `/cancel` · `/reverse` · `GET /payments/debtor-credit/:debtorId`
- [x] `GET|POST|PATCH /payment-methods` · `GET|POST|PATCH /payment-currencies`
- [x] `GET /creditor-accounts` (saldos) · `GET /creditor-accounts/:orgId` (extracto) · `PATCH /:orgId/commission-rate`
- [x] `POST /creditor-accounts/:orgId/settlements` · `GET /creditor-accounts/settlements` · `/settlements/:id/confirm|cancel|proof`
- [x] Negociação: saldo de renegociação abate pagamentos; renegociar bloqueado com pendentes; cancelar bloqueado com pagamentos; quebra automática ignora parcelas pagas a tempo (inclui pendentes com data ≤ vencimento) e usa SKIP LOCKED
- [ ] `npm run migration:run` e testar o fluxo no Swagger (registar → confirmar → ver conta-corrente → repasse)
- [ ] Ligar `NEGOTIATION_AUTO_BREAK_ENABLED=true` no `.env`
- [ ] Definir a taxa de comissão de cada credor (`PATCH /creditor-accounts/:orgId/commission-rate`; por defeito 0%)
- [ ] Aplicar crédito do devedor a um novo acordo/renegociação (hoje fica guardado e visível)
- [x] Mostrar "pago/em falta" por parcela no detalhe da negociação (`installments[].paidAmount|pendingAmount|remainingAmount|paymentState` + `paymentTotals`)

## 3. Renegociação — ✅ implementado (06/10)
- [x] Migração `NegotiationLifecycle` (aditiva): estados `PENDING_APPROVAL`, `REJECTED`, `BROKEN`, `RENEGOTIATED`; quatro olhos e coerência estado/datas por CHECK; 1 renegociação por acordo (índice único)
- [x] Aprovação **apenas acima do limite** (`NEGOTIATION_APPROVAL_DISCOUNT_LIMIT_PERCENT`, por defeito 10) → pedido ao gestor via notificação; aprovar/rejeitar
- [x] Quebra manual (`POST /:id/break`) e automática **a partir do 1.º dia** (job 07:15) — **desligada** (`NEGOTIATION_AUTO_BREAK_ENABLED=false`) até existir Pagamentos
- [x] Saldo da renegociação **inclui tudo** (capital em aberto + multa + juros compostos `NEGOTIATION_LATE_MONTHLY_INTEREST_PERCENT`), calculado no servidor
- [x] Renegociação atómica com Idempotency-Key; **sem limite** de renegociações (cadeia `previous_negotiation_id`)
- [ ] **(D)** Confirmar o limite de desconto para aprovação (hoje 10%) e a taxa de juros de mora (hoje 1%/mês)
- [ ] Ligar a quebra automática quando o módulo de Pagamentos estiver pronto

## 5. Régua de cobrança — ✅ MVP implementado (06/10)
Decisões: cada **comercial cria e edita a sua** régua; dia da régua = **dias desde a entrada do processo em cobrança**.
- [x] Migração `CollectionLadders` (réguas, etapas, execuções idempotentes, 1 régua activa por comercial)
- [x] CRUD: criar (nasce inactiva), editar com lock optimista (`expectedVersion`), activar/desactivar, arquivar
- [x] Etapas: dia, acção (`CONTACT_REMINDER`, `NEGOTIATION_SUGGESTION`, `ESCALATION`, `CUSTOM_ALERT`), destinatário (agente/gestor/ambos), prioridade, mensagem com variáveis
- [x] Pré-visualização `GET /collection-ladders/:id/preview` (não grava nem envia)
- [x] Motor: job diário 07:50 Luanda (`CRON_COLLECTION_LADDERS`), lock distribuído, janela de recuperação (`LADDER_CATCHUP_DAYS`), notificações via outbox na mesma transacção
- [x] Gestor consulta (só leitura) as réguas da sua equipa
- [ ] Etapa "cumprida" quando existe contacto no período + alerta ao gestor se não cumprida
- [ ] Filtros `GET /api/process?ladderStep=&stepOverdue=true`
- [ ] (futuro) acções para o devedor (e-mail/SMS) — quando decidirem canais
- [ ] **(D)** Processo sem responsável não tem régua: correcto, ou usar a régua do gestor?
- ~~Secção 1 (lembretes com offsets fixos)~~ substituída pela régua dinâmica

## 6. Painel, disputas, cumprimento da régua e circuit breaker — ✅ implementado (06/10)
Decisões: taxa de sucesso **por valor** (recuperado ÷ posto em cobrança no período) · visibilidade por hierarquia (agente → os seus; gestor → equipa; `dashboard_view_all_permission` → tudo) · disputa: procedente / anulada / valor corrigido · passo cumprido quando há **contacto registado** no prazo.
- [x] Migração `1759750000000-InsightsDisputesLadderTracking`
- [x] `GET /dashboard/summary` (totais + série mensal) · `/dashboard/by-agent` · `/dashboard/by-creditor` (filtros: from, to, agentId, organizationId)
- [x] `POST /invoice-disputes` · `GET /invoice-disputes` · `GET /invoice-disputes/:id` · `POST /invoice-disputes/:id/resolve` (`invoice_dispute_resolve_permission`); `POST /process/remove/invoice` passa a registar a disputa (campo `reason`)
- [x] Passos da régua com `fulfillmentDays` (prazo); job `CRON_LADDER_TRACKING` (15 min): cumprido / em atraso → escala ao gestor; `GET /collection-ladder-tasks` · `GET /collection-ladder-tasks/compliance`
- [x] Circuit breaker no SMTP: circuito aberto → e-mails esperam sem gastar tentativas; `GET /outbox/circuits`
- [ ] `npm run migration:run` e testar no Swagger
- [ ] Nas réguas existentes, definir o prazo (`fulfillmentDays`) dos passos que exigem contacto (sem prazo = só informativo)
- [ ] Frontend: enviar `reason` ao retirar facturas do processo

## Ordem sugerida para amanhã
1. Secção 0 (validar)
2. Secções 1 + 5 juntas: motor da régua dinâmica com a acção "notificar agente/gestor" (os lembretes passam a ser uma etapa configurada pelo utilizador)
3. Secção 6 (painel: tudo excepto "recuperado")
4. Decisões **(D)** de pagamentos para fechar o painel

## 4. Pendentes / decisões em aberto
- [ ] **(D)** Contactos: restringir registo ao agente responsável + gestor?
- [ ] Painel: KPI "recuperado" fica pendente até existir Pagamentos (secção 2)
- [ ] **(D)** Lembretes ao devedor (e-mail/SMS): canais, destinatário, em nome de quem, prazos, dias úteis
- [ ] Circuit breaker por handler na outbox (SMTP em baixo não gasta tentativas)
- [ ] UC5: resolver disputa de factura (volta à cobrança ou é anulada)
- [ ] UC11: fechar processo (pago / incobrável / jurídico)
- [ ] Exportação PDF assíncrona quando os volumes crescerem: acima de ~5 000 linhas gerar em job, guardar o ficheiro e avisar pelo sino com link de download (hoje é síncrono: 20 000 linhas ≈ 0,8 s a gerar, risco é o timeout do proxy)
- [ ] Remover a pasta `../_to_delete/` (pacotes temporários das cópias)
