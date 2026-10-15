/**
 * Catálogo de permissões — ÚNICA fonte de verdade.
 *
 * As permissões não são criadas pela interface: existem aqui, no código, junto
 * das rotas que protegem. No arranque da API (e no `npm run seed`) o catálogo é
 * sincronizado com a tabela `permissions`:
 *   - permissões novas são inseridas e atribuídas aos perfis em `defaultRoles`;
 *   - nome/descrição são actualizados; as que saíram do catálogo ficam inactivas;
 *   - o perfil `super-admin` recebe SEMPRE todas as permissões activas.
 *
 * Para proteger uma rota: `@RequirePermissions(P.DEBTOR_CREATE)`.
 */

export const P = {
  DASHBOARD_VIEW: 'dashboard_view_permission',
  DASHBOARD_VIEW_ALL: 'dashboard_view_all_permission',

  DEBTOR_VIEW: 'debtor_view_permission',
  DEBTOR_CREATE: 'debtor_create_permission',
  DEBTOR_UPDATE: 'debtor_update_permission',
  DEBTOR_TOGGLE: 'debtor_toggle_permission',
  CONTACT_RESTRICTION_ADD: 'contact_restriction_add_permission',
  CONTACT_RESTRICTION_LIFT: 'contact_restriction_lift_permission',

  INVOICE_VIEW: 'invoice_view_permission',
  INVOICE_CREATE: 'invoice_create_permission',
  INVOICE_UPDATE: 'invoice_update_permission',

  DISPUTE_VIEW: 'invoice_dispute_view_permission',
  DISPUTE_OPEN: 'invoice_dispute_open_permission',
  DISPUTE_RESOLVE: 'invoice_dispute_resolve_permission',

  /** visibilidade: sem esta, o agente vê só o que é seu e o gestor o seu e o da equipa */
  AGENTS_VIEW_ALL: 'agents_view_all_permission',

  PROCESS_VIEW: 'process_view_permission',
  PROCESS_ASSIGN: 'process_assign_permission',
  PROCESS_INVOICE_REMOVE: 'process_invoice_remove_permission',
  CONTACT_REGISTER: 'contact_register_permission',

  WALLET_VIEW: 'wallet_view_permission',
  WALLET_MANAGE: 'wallet_manage_permission',

  NEGOTIATION_VIEW: 'negotiation_view_permission',
  NEGOTIATION_CREATE: 'negotiation_create_permission',
  NEGOTIATION_CANCEL: 'negotiation_cancel_permission',
  NEGOTIATION_APPROVE: 'negotiation_approve_permission',
  NEGOTIATION_BREAK: 'negotiation_break_permission',

  PAYMENT_VIEW: 'payment_view_permission',
  PAYMENT_REGISTER: 'payment_register_permission',
  PAYMENT_CONFIRM: 'payment_confirm_permission',
  PAYMENT_METHOD_MANAGE: 'payment_method_manage_permission',

  ORGANIZATION_VIEW: 'organization_view_permission',
  ORGANIZATION_MANAGE: 'organization_manage_permission',
  CREDITOR_ACCOUNT_VIEW: 'creditor_account_view_permission',
  CREDITOR_SETTLEMENT: 'creditor_settlement_permission',
  CREDITOR_COMMISSION_MANAGE: 'creditor_commission_manage_permission',

  LADDER_VIEW: 'collection_ladder_view_permission',
  LADDER_MANAGE: 'collection_ladder_manage_permission',
  LADDER_RUN: 'collection_ladder_run_permission',
  POLICY_MANAGE: 'collection_policy_manage_permission',

  USER_VIEW: 'user_view_permission',
  USER_CREATE: 'user_create_permission',
  USER_UPDATE: 'user_update_permission',
  USER_TOGGLE: 'user_toggle_permission',
  USER_RESET_PASSWORD: 'user_reset_password_permission',
  USER_PERMISSIONS_MANAGE: 'user_permissions_manage_permission',
  ROLE_VIEW: 'role_view_permission',
  ROLE_MANAGE: 'role_manage_permission',

  CATALOG_MANAGE: 'catalog_manage_permission',
  AUDIT_VIEW: 'audit_view_permission',
  IMPORT_HISTORY_VIEW: 'import_history_view_permission',

  REPORTS_VIEW: 'reports_view_permission',
  REPORTS_COST_MANAGE: 'reports_cost_manage_permission',
  OUTBOX_MANAGE: 'outbox_manage_permission',

  INTEGRATION_VIEW: 'integration_view_permission',
  INTEGRATION_MANAGE: 'integration_manage_permission',
  INTEGRATION_REVIEW: 'integration_review_permission',
} as const;

export type PermissionSlug = (typeof P)[keyof typeof P];

export interface PermissionDefinition {
  slug: PermissionSlug;
  /** Nome curto mostrado ao utilizador ("Criar devedores") */
  name: string;
  /** O que a permissão permite fazer, em linguagem simples */
  description: string;
  /** Área funcional — agrupa as permissões no ecrã */
  group: string;
  /** Perfis que a recebem quando a permissão é criada pela primeira vez */
  defaultRoles?: string[];
}

export const SUPER_ADMIN_ROLE = 'super-admin';
const GESTOR = 'gestor_role';
const AGENTE = 'agente_role';
const ALL = [GESTOR, AGENTE];

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // Painel
  { group: 'Painel', slug: P.DASHBOARD_VIEW, name: 'Ver painel', description: 'Ver os indicadores do painel inicial (valores em cobrança, recuperados, por agente e por credor).', defaultRoles: ALL },
  { group: 'Painel', slug: P.DASHBOARD_VIEW_ALL, name: 'Ver dados de toda a empresa', description: 'Ver indicadores e tarefas de todas as equipas, e não apenas da sua.' },

  // Devedores
  { group: 'Devedores', slug: P.DEBTOR_VIEW, name: 'Ver devedores', description: 'Consultar a lista de devedores e a ficha de cada um.', defaultRoles: ALL },
  { group: 'Devedores', slug: P.DEBTOR_CREATE, name: 'Criar devedores', description: 'Registar novos devedores, individualmente ou por importação de Excel.', defaultRoles: [GESTOR] },
  { group: 'Devedores', slug: P.DEBTOR_UPDATE, name: 'Editar devedores', description: 'Alterar os dados de um devedor (contactos, morada, credor, logótipo).', defaultRoles: [GESTOR] },
  { group: 'Devedores', slug: P.DEBTOR_TOGGLE, name: 'Activar ou desactivar devedores', description: 'Suspender um devedor ou voltar a activá-lo.', defaultRoles: [GESTOR] },
  { group: 'Devedores', slug: P.CONTACT_RESTRICTION_ADD, name: 'Registar oposição a contacto', description: 'Marcar que o devedor não quer ser contactado por email ou SMS (Lei 22/11, art. 27.º). Aplica-se logo à régua e ao envio.', defaultRoles: ALL },
  { group: 'Devedores', slug: P.CONTACT_RESTRICTION_LIFT, name: 'Levantar oposição a contacto', description: 'Voltar a permitir o contacto num canal, com motivo registado (por exemplo, novo consentimento do devedor).', defaultRoles: [GESTOR] },

  // Facturas
  { group: 'Facturas', slug: P.INVOICE_VIEW, name: 'Ver facturas', description: 'Consultar facturas, incluindo as vencidas.', defaultRoles: ALL },
  { group: 'Facturas', slug: P.INVOICE_UPDATE, name: 'Editar facturas', description: 'Corrigir número, valor, datas, moeda ou devedor de uma factura ainda não paga.', defaultRoles: [GESTOR] },
  { group: 'Facturas', slug: P.INVOICE_CREATE, name: 'Registar facturas', description: 'Criar facturas e importá-las por Excel ou PDF.', defaultRoles: [GESTOR] },
  { group: 'Facturas', slug: P.DISPUTE_VIEW, name: 'Ver disputas', description: 'Consultar as facturas contestadas pelos devedores.', defaultRoles: ALL },
  { group: 'Facturas', slug: P.DISPUTE_OPEN, name: 'Abrir disputas', description: 'Registar que um devedor contesta uma factura.', defaultRoles: ALL },
  { group: 'Facturas', slug: P.DISPUTE_RESOLVE, name: 'Resolver disputas', description: 'Decidir uma disputa: dar razão ao devedor ou manter a cobrança.' },

  // Processos
  { group: 'Processos', slug: P.AGENTS_VIEW_ALL, name: 'Ver dados de todos os agentes', description: 'Ver os processos, facturas, negociações, contactos e carteiras de todos os agentes. Sem esta permissão, o agente vê só o seu e o gestor o seu e o da sua equipa.' },
  { group: 'Processos', slug: P.PROCESS_VIEW, name: 'Ver processos', description: 'Consultar processos de cobrança, as suas facturas e o histórico de contactos.', defaultRoles: ALL },
  { group: 'Processos', slug: P.PROCESS_ASSIGN, name: 'Atribuir e transferir processos', description: 'Atribuir processos a agentes (manual ou automaticamente), transferi-los e gerar novos processos.', defaultRoles: [GESTOR] },
  { group: 'Processos', slug: P.PROCESS_INVOICE_REMOVE, name: 'Retirar facturas de processos', description: 'Remover facturas de um processo de cobrança.', defaultRoles: [GESTOR] },
  { group: 'Processos', slug: P.CONTACT_REGISTER, name: 'Registar contactos', description: 'Registar chamadas, emails, SMS e visitas feitas ao devedor.', defaultRoles: ALL },

  // Carteiras
  { group: 'Carteiras', slug: P.WALLET_VIEW, name: 'Ver carteiras', description: 'Consultar os devedores atribuídos a cada responsável.', defaultRoles: ALL },
  { group: 'Carteiras', slug: P.WALLET_MANAGE, name: 'Gerir carteiras', description: 'Adicionar, remover e transferir devedores entre carteiras.', defaultRoles: [GESTOR] },

  // Negociações
  { group: 'Negociações', slug: P.NEGOTIATION_VIEW, name: 'Ver negociações', description: 'Consultar acordos de pagamento e as suas prestações.', defaultRoles: ALL },
  { group: 'Negociações', slug: P.NEGOTIATION_CREATE, name: 'Criar negociações', description: 'Simular e criar acordos de pagamento, incluindo renegociações.', defaultRoles: ALL },
  { group: 'Negociações', slug: P.NEGOTIATION_CANCEL, name: 'Cancelar negociações', description: 'Cancelar um acordo de pagamento.', defaultRoles: [GESTOR] },
  { group: 'Negociações', slug: P.NEGOTIATION_APPROVE, name: 'Aprovar negociações', description: 'Aprovar ou rejeitar acordos com desconto acima do limite, de qualquer equipa.' },
  { group: 'Negociações', slug: P.NEGOTIATION_BREAK, name: 'Marcar acordo como quebrado', description: 'Declarar que o devedor deixou de cumprir o acordo.' },

  // Pagamentos
  { group: 'Pagamentos', slug: P.PAYMENT_VIEW, name: 'Ver pagamentos', description: 'Consultar pagamentos, comprovativos e o crédito disponível dos devedores.', defaultRoles: ALL },
  { group: 'Pagamentos', slug: P.PAYMENT_REGISTER, name: 'Registar pagamentos', description: 'Registar um pagamento recebido de um devedor.', defaultRoles: ALL },
  { group: 'Pagamentos', slug: P.PAYMENT_CONFIRM, name: 'Confirmar pagamentos', description: 'Confirmar, anular ou estornar pagamentos de qualquer equipa (área financeira).' },
  { group: 'Pagamentos', slug: P.PAYMENT_METHOD_MANAGE, name: 'Gerir meios de pagamento e moedas', description: 'Criar e alterar meios de pagamento e moedas aceites.' },

  // Credores
  { group: 'Credores', slug: P.ORGANIZATION_VIEW, name: 'Ver credores', description: 'Consultar a lista de credores (clientes da cobrança).', defaultRoles: [GESTOR] },
  { group: 'Credores', slug: P.ORGANIZATION_MANAGE, name: 'Gerir credores', description: 'Criar, editar, importar, activar e desactivar credores.' },
  { group: 'Credores', slug: P.CREDITOR_ACCOUNT_VIEW, name: 'Ver conta-corrente dos credores', description: 'Consultar quanto foi recuperado, a comissão e o saldo a entregar a cada credor.', defaultRoles: [GESTOR] },
  { group: 'Credores', slug: P.CREDITOR_SETTLEMENT, name: 'Liquidar credores', description: 'Registar, confirmar e cancelar entregas de dinheiro aos credores.' },
  { group: 'Credores', slug: P.CREDITOR_COMMISSION_MANAGE, name: 'Definir comissões', description: 'Alterar a taxa de comissão cobrada a cada credor.' },

  // Régua de cobrança
  { group: 'Régua de cobrança', slug: P.LADDER_VIEW, name: 'Ver réguas de cobrança', description: 'Consultar réguas, as suas etapas, tarefas e cumprimento.', defaultRoles: ALL },
  { group: 'Régua de cobrança', slug: P.LADDER_MANAGE, name: 'Gerir réguas de cobrança', description: 'Criar, editar, activar, desactivar e arquivar réguas.', defaultRoles: [GESTOR] },
  { group: 'Régua de cobrança', slug: P.LADDER_RUN, name: 'Executar régua manualmente', description: 'Correr a régua de cobrança agora, sem esperar pelo horário automático.' },

  { group: 'Régua de cobrança', slug: P.POLICY_MANAGE, name: 'Definir a régua master', description: 'Alterar os limites de dias, prazos, canais, contactos e passos obrigatórios que todas as réguas têm de cumprir.' },

  // Utilizadores e acessos
  { group: 'Utilizadores e acessos', slug: P.USER_VIEW, name: 'Ver utilizadores', description: 'Consultar a lista de utilizadores da plataforma.', defaultRoles: [GESTOR] },
  { group: 'Utilizadores e acessos', slug: P.USER_CREATE, name: 'Criar utilizadores', description: 'Convidar novos utilizadores e definir o seu perfil.' },
  { group: 'Utilizadores e acessos', slug: P.USER_UPDATE, name: 'Editar utilizadores', description: 'Alterar dados, perfil, gestor e categoria de um utilizador.' },
  { group: 'Utilizadores e acessos', slug: P.USER_TOGGLE, name: 'Activar ou desactivar utilizadores', description: 'Bloquear ou desbloquear o acesso de um utilizador.' },
  { group: 'Utilizadores e acessos', slug: P.USER_PERMISSIONS_MANAGE, name: 'Gerir permissões individuais', description: 'Dar a um utilizador permissões além das do seu perfil. Só se pode dar o que se tem.' },
  { group: 'Utilizadores e acessos', slug: P.USER_RESET_PASSWORD, name: 'Redefinir palavra-passe', description: 'Gerar uma nova palavra-passe para outro utilizador.' },
  { group: 'Utilizadores e acessos', slug: P.ROLE_VIEW, name: 'Ver perfis e permissões', description: 'Consultar os perfis e o que cada um pode fazer.' },
  { group: 'Utilizadores e acessos', slug: P.ROLE_MANAGE, name: 'Gerir perfis', description: 'Criar e editar perfis e escolher as permissões de cada um.' },

  // Estatísticas
  { group: 'Estatísticas', slug: P.REPORTS_VIEW, name: 'Ver estatísticas e relatórios', description: 'Consultar os indicadores de contas a receber (DSO, inadimplência, CEI, aging, custo por cobrança) e gerar os relatórios em PDF.', defaultRoles: [GESTOR] },
  { group: 'Estatísticas', slug: P.REPORTS_COST_MANAGE, name: 'Gerir custos de cobrança', description: 'Lançar, corrigir e remover os custos da operação usados no indicador de custo por cobrança.' },

  // Sistema
  { group: 'Sistema', slug: P.CATALOG_MANAGE, name: 'Gerir tabelas auxiliares', description: 'Criar tipos de contacto e outras listas de apoio.' },
  { group: 'Sistema', slug: P.AUDIT_VIEW, name: 'Ver auditoria', description: 'Consultar o histórico de alterações: quem fez o quê, quando e de onde.' },
  { group: 'Sistema', slug: P.IMPORT_HISTORY_VIEW, name: 'Ver histórico de importações', description: 'Consultar os ficheiros importados (credores, devedores e facturas), abrir o ficheiro original e ver os erros de cada linha.', defaultRoles: [GESTOR] },
  // Integrações (ERP)
  { group: 'Integrações', slug: P.INTEGRATION_VIEW, name: 'Ver integração com o ERP', description: 'Consultar a ligação ao SAP, as execuções e a fila de revisão.' },
  { group: 'Integrações', slug: P.INTEGRATION_MANAGE, name: 'Gerir integração com o ERP', description: 'Configurar a ligação ao SAP, gravar credenciais, activar, pausar e correr sincronizações.' },
  { group: 'Integrações', slug: P.INTEGRATION_REVIEW, name: 'Resolver revisões da integração', description: 'Decidir os casos que a integração não fecha sozinha (pagos no SAP com acordo activo, valores alterados, devedores incompletos).' },

  { group: 'Sistema', slug: P.OUTBOX_MANAGE, name: 'Gerir fila de envios', description: 'Acompanhar e reenviar emails e notificações que falharam.' },
];

const BY_SLUG = new Map(PERMISSION_CATALOG.map((d) => [d.slug as string, d]));
export const catalogEntry = (slug: string): PermissionDefinition | undefined => BY_SLUG.get(slug);
export const GROUP_ORDER = [...new Set(PERMISSION_CATALOG.map((d) => d.group))];
