# Segurança da API — modelo de ameaças e matriz de controlos

Estado a 14/10/2026. Legenda: **OK** implementado e verificado · **Parcial** existe mas falta algo · **Lacuna** não existe.
Cada linha: ameaça → controlo → onde está → critério de aceitação → como se verifica.

## 1. Identidade e sessão
| Ameaça | Controlo | Onde | Critério de aceitação | Verificação | Estado |
|---|---|---|---|---|---|
| Token forjado ou de outro sistema | JWT HS256 com `iss`/`aud` verificados; algoritmo fixo | `auth.module.ts`, `jwt.strategy.ts` | token sem/ com `aud` errado → 401 | `auth-security.spec.ts` | OK |
| Sessão viva após logout/troca de palavra-passe/desactivação | `tokenVersion` e `isActive` conferidos **em cada pedido** | `jwt.strategy.ts`, `UserRepository.bumpTokenVersion` | após logout o token antigo falha no pedido seguinte | teste de integração (a criar) | OK |
| Credential stuffing / força bruta | Throttle por IP (5/min) **e** bloqueio por email (5 falhas → 15 min), na BD, conta emails inexistentes | `auth.controller.ts`, `auth.use-cases.ts`, `login_attempts` | 5.ª falha → 429; palavra-passe certa durante o bloqueio também → 429 | `auth-security.spec.ts` | OK |
| Enumeração de utilizadores | Mesma mensagem e tempo (hash fictício); reset responde sempre igual | `auth.use-cases.ts` | resposta idêntica para email existente/inexistente | `auth-security.spec.ts` | OK |
| Palavra-passe truncada pelo bcrypt (72 bytes) | Recusa-se >72 bytes; DTOs com máx. 72 | `bcrypt-password-hasher.ts`, DTOs | 73 bytes → 400 | `auth-security.spec.ts` | OK |
| Reset de palavra-passe abusado | Token aleatório 256 bit, guardado em hash, uso único, 30 min, invalida os anteriores, termina todas as sessões | `auth.use-cases.ts` | segundo uso do token → erro | revisão de código (teste a criar) | OK |
| Segredo fraco/de exemplo em produção | `JWT_SECRET` ≥32 e diferente do exemplo em produção | `env.validation.ts` | arranque falha em produção com o exemplo | arranque | OK |
| Sessão por cookie sem protecção | HttpOnly, Secure obrigatório em produção, verificação de origem (CSRF) | `session-cookie.ts` | `session-cookie.spec.ts` | jest | OK |
| Operações financeiras com sessão roubada | MFA / reautenticação (step-up) | — | — | — | **Lacuna** |
| Refresh token / rotação | Não existe: sessão de 1 h sem renovação | — | — | — | Decisão (ver §7) |

## 2. Autorização
| Ameaça | Controlo | Onde | Critério | Verificação | Estado |
|---|---|---|---|---|---|
| Função sem permissão (BFLA) | Autenticação global por omissão + `@RequirePermissions` | `JwtAuthGuard`, `PermissionsGuard` | das 181 rotas só `auth/logout`, `auth/me` e as 5 de notificações (recursos do próprio) não pedem permissão | inventário por script (este documento) | OK |
| Acesso a objecto de outro (BOLA) em notificações | Filtradas por `user_id` do token | `typeorm-notification.repository.ts` | `PUT/DELETE :id` de outro utilizador → 404 | a cobrir com teste | Parcial |
| Agente a ver processos/carteiras/contactos de outros | `PROCESS_VIEW` e `WALLET_VIEW` dão leitura global e todos os perfis a têm | `permission-catalog.ts` | — | — | **Decisão do negócio** (ver §7) |
| Quatro olhos | Pagamentos (CHECK na BD + regra), negociações, acertos | `ck_payments_four_eyes`, `payment-authority.ts` | quem registou não confirma | jest + BD | OK |
| Mass assignment | `whitelist: true`; `REJECT_UNKNOWN_FIELDS` rejeita campos extra | `main.ts` | campo extra → 400 (com a flag) | a ligar | Parcial |

### 2.1 Visibilidade por agente e permissões individuais

- **Agente** vê só os *seus* processos (`process_assignments`), as facturas e negociações ligadas a eles (ou que criou) e os contactos desses processos.
- **Gestor** vê o seu e o dos agentes da sua carteira (`wallet_agents`); vê também os processos ainda **sem responsável**, porque é ele quem os distribui.
- **`agents_view_all_permission`** ("Ver dados de todos os agentes") levanta o limite — por perfil ou só para um utilizador.
- **Permissões individuais** (`user_permissions`): somam-se às do perfil, valem só para o utilizador, são lidas a cada pedido (efeito imediato) e auditadas.
  Regras anti-escalada: não se alteram as próprias, só se dá o que se tem, e o que o perfil já dá não se guarda.
- Listas filtram na própria query (`Criteria.visibleTo`); acesso por id passa pelo `VisibilityGuard` (`@VisibleTo`) e responde **404**, não 403, para não revelar que o registo existe.
- Ainda **sem** âmbito por agente: pagamentos, disputas, devedores e relatórios (decisão pendente).

Protecção de dados pessoais (Lei 22/11): ver `PROTECCAO-DADOS.md`.

## 3. Ataques a APIs
| Ameaça | Controlo | Onde | Estado |
|---|---|---|---|
| SQL injection | Consultas parametrizadas; ordenação por lista fechada de campos; filtros OData do SAP escapados | repositórios, `*_SORTABLE`, `odataString` | OK |
| SSRF | O conector SAP só segue `nextLink` do mesmo anfitrião; URL do ERP vem de configuração com permissão própria | `sap-b1.connector.ts` | OK |
| Path traversal / uploads | Caminho normalizado e confinado; tipo por extensão + MIME + assinatura real; limite de tamanho | `local-file-storage.ts`, `upload.ts`, `MAX_UPLOAD_MB` | OK |
| DoS / paginação | `perPage` ≤ 100; throttling global 300/min por IP; limite de upload | `pagination.dto.ts`, `ThrottlerModule` | Parcial: contadores em memória (cada réplica conta à parte); usar Redis com várias réplicas |
| Replay de operações financeiras | `Idempotency-Key` por utilizador+rota, com impressão digital do pedido (método+URL+corpo) | `idempotency.interceptor.ts` | OK (corrigido: antes só o corpo; a mesma chave noutro `:id` repetia a resposta do primeiro) |
| Erros que revelam internos | Filtro global: 500 genérico, stack só em ficheiro fora de produção | `domain-exception.filter.ts` | OK |
| Superfície exposta | Swagger desligado por omissão em produção (`SWAGGER_ENABLED`) | `main.ts` | OK |
| CORS / cabeçalhos | `*` proibido em produção; `helmet()` | `main.ts` | OK |
| Dependências | `npm audit` não correu (rede sem acesso ao registo) | — | **Por verificar** |

## 4. Integridade financeira
Transacções por caso de uso (`UnitOfWork`), `CHECK` e índices únicos na BD, bloqueios de linha nas transferências e pagamentos, idempotência, auditoria e outbox para efeitos externos. A idempotência não promete execução "exactamente uma vez": garante que o mesmo pedido não cria dois efeitos locais; efeitos em sistemas externos dependem do outbox (pelo-menos-uma-vez) e de quem recebe.

## 5. Dados e segredos
Credenciais do ERP cifradas (AES-256-GCM, chave própria, nunca na auditoria); palavra-passe com bcrypt custo 12; redacção de `authorization`, cookies, palavras-passe, tokens e credenciais nos logs; TLS à BD configurável (`DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`). **Lacunas:** sem gestão/rotação de chaves (KMS), sem política de retenção/anonimização de dados de devedores, sem cifra de campos sensíveis (NIF, contactos) em repouso, backups fora do âmbito deste repositório.

## 6. Testes de segurança
`auth-security.spec.ts` (bloqueio, enumeração, 72 bytes, iss/aud, idempotência). A acrescentar: testes de autorização por rota (cada rota sem token → 401 e sem permissão → 403, gerados a partir do inventário), BOLA de notificações e SAST/SCA no CI (`npm audit`, Dependabot).

## 7. Decisões que precisam de ti
1. **Visibilidade de processos:** hoje qualquer agente vê todos os processos, contactos e carteiras. Restringir cada agente aos seus (e ao gestor à sua equipa, como já se faz no painel) é mais seguro, mas muda o trabalho diário.
2. **MFA/step-up** em pagamentos, estornos e alteração de credenciais do ERP.
3. **Refresh token:** manter 1 h com `tokenVersion` (simples, revogação imediata) ou sessões renováveis.
4. **`REJECT_UNKNOWN_FIELDS=true`:** ligar depois de confirmar que o frontend só envia campos declarados.
