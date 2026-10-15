# Protecção de dados pessoais na cobrança — Lei n.º 22/11 (Angola)

Estado a 14/10/2026. **Não é parecer jurídico**: os artigos vêm de uma transcrição da lei (angolex.com / lex.ao) e devem ser confirmados por jurista e, para notificações e autorizações, junto da Agência de Protecção de Dados (APD). Legenda: **OK** feito · **Parcial** · **Lacuna** · **Jurista** (depende de decisão jurídica/da APD).

## 1. Quem é quem
- **Credor (cliente)** é o *responsável pelo tratamento* dos dados dos devedores; a **Cobraqui/agência** age, em regra, como *subcontratante* (art. 23.º): contrato escrito, só trata segundo instruções do credor, devolve/destrói os dados no fim. Se usar os dados para fins próprios passa a responsável. **Jurista:** confirmar o papel em cada contrato e quem notifica a APD.
- **Fornecedores** (SMTP, SMS, alojamento) são subcontratantes da Cobraqui (art. 23.º) → contrato e, se estiverem fora de Angola, transferência internacional (§3).

## 2. O ciclo de cobrança, passo a passo
| Fase | Exigência (artigo) | O que o sistema faz | Estado |
|---|---|---|---|
| Carga de devedores/facturas (importação, ERP) | Finalidade determinada e proporcionalidade: só dados necessários (8.º, 9.º); veracidade (10.º) | Importa só os campos de cobrança; ERP em modo leitura; correcção de dados nos ecrãs | Parcial — não há lista fechada documentada de campos por finalidade |
| Inclusão em ficheiro de devedores | Informar o titular até 60 dias após a inclusão (16.º); informar quando os dados não vêm dele, até 30 dias (25.º) | **Não há registo de que o devedor foi informado** | **Lacuna** |
| Base de legitimidade | Consentimento ou notificação à APD; dispensa para execução de contrato/interesse legítimo (12.º); crédito e solvabilidade exigem consentimento ou autorização da APD (16.º) | — | **Jurista** (qual base por credor; autorização da APD) |
| Contacto por email/SMS (régua) | Comunicações electrónicas: direito de oposição e lista de opositores (18.º, 19.º, 27.º) | **Registo "não contactar" por canal, verificado na régua e outra vez no envio**; fica histórico e auditoria | **OK (novo)** |
| Chamadas de cobrança | Gravar chamadas exige consentimento expresso registado no início e autorização da APD (20.º) | O sistema não grava chamadas; só regista o contacto | OK — manter assim ou tratar antes de gravar |
| Dados de terceiros / sensíveis | Dados sensíveis (saúde, vida privada…) só com lei/autorização (13.º); infracções penais só autoridade (15.º) | Não há campos sensíveis; texto livre dos contactos pode receber | Parcial — avisar os agentes e sinalizar texto livre |
| Acesso interno | Segurança e sigilo (30.º-32.º) | Agente vê só o seu; gestor a equipa; permissões individuais; auditoria (ver `SEGURANCA.md`) | OK |
| Partilha com o credor/terceiros | Comunicação a terceiros exige consentimento e notificação (21.º, 22.º) | Só utilizadores do sistema e PDF exportado por utilizador autenticado | Parcial — exportações não ficam registadas por devedor |
| Direitos do titular | Acesso (26.º), oposição (27.º), rectificação/eliminação em 60 dias úteis (28.º), não ficar sujeito a decisão só automatizada (29.º) | Oposição ao contacto: OK. **Sem registo de pedidos de acesso/rectificação/eliminação nem do prazo** | **Lacuna** |
| Decisões automatizadas | Art. 29.º | A régua envia avisos automáticos e muda o estado; não decide perdão/negociação nem corta serviço | OK — manter decisão final humana |
| Conservação | Só o tempo necessário, depois eliminar/anonimizar (11.º) | **Sem prazo nem rotina de anonimização**; auditoria e financeiro têm de ficar o prazo legal | **Lacuna + Jurista** |
| Fim do contrato com o credor | Devolver ou destruir os dados (23.º) | Sem procedimento | **Lacuna** |
| Incidentes | Segurança (30.º); crimes de acesso indevido, sigilo (56.º, 59.º) | Auditoria e logs; sem procedimento de incidente | Parcial |

## 3. Transferência internacional (arts. 33.º-34.º)
Notificação à APD (país com nível adequado) ou autorização (sem nível adequado). A APD multou a MAXAM em USD 150 000 por transferir dados para o Reino Unido. Atenção: **alojamento na nuvem fora de Angola, SMTP e fornecedor de SMS estrangeiros** contam. **Jurista/TI:** onde estão a base de dados, backups, email e SMS.

## 4. Segurança (arts. 30.º-31.º)
Medidas técnicas e organizativas e **documento de segurança**: ver `SEGURANCA.md`. Novo: o email/telefone do devedor aparece **mascarado** nos logs; o texto completo da mensagem só aparece em modo de teste (`DEBTOR_MESSAGES_MODE=log`). Lacunas: cifra em repouso de NIF e contactos, backups, procedimento de incidente.

## 5. Notificação à APD e sanções
Tratamentos exigem notificação prévia ou autorização (35.º-36.º; a APD responde em 30 dias; registo público no 38.º). Multas de USD 65 000-150 000 por infracção, ×3 para pessoas colectivas (51.º); crimes de 3 meses a 3 anos (55.º-59.º); direito a indemnização (48.º). **Jurista:** estado das notificações do credor e da agência.

## 6. O que foi implementado nesta fase
- Tabela `debtor_contact_restrictions` (migração `1759860000000-DataProtection`): canal EMAIL/SMS/ALL, origem (pedido do devedor, reclamação, legal, outra), motivo obrigatório, quem e quando; levantar guarda quem, quando e porquê. Nada se apaga.
- `GET/POST/DELETE /debtors/:id/contact-restrictions`. Permissões: `contact_restriction_add_permission` (gestor e agente) e `contact_restriction_lift_permission` (só gestor).
- A régua deixa de enfileirar mensagens bloqueadas (e conta-as em `suppressedByOpposition`); o envio verifica de novo, porque a oposição pode chegar com a mensagem já na fila.
- Máscara de email/telefone nos logs de mensagens ao devedor.
- Testes: `debtor-opposition.spec.ts`.

## 7. Proposta para as próximas fases (precisa das tuas decisões)
1. **Aviso ao devedor (arts. 16.º e 25.º):** campo e registo de "informado em…" por devedor, mensagem-modelo da política de privacidade enviada na primeira abordagem, e painel de devedores ainda não informados com alerta aos 20 dias. Precisa do texto aprovado pelo jurista.
2. **Pedidos do titular (arts. 26.º-28.º):** registo de pedidos (acesso, rectificação, eliminação, oposição) com prazo de 60 dias úteis, estado, responsável e resposta; exportação dos dados do devedor.
3. **Conservação (art. 11.º):** prazos por tipo de dado (processo encerrado, auditoria, contabilidade), rotina que anonimiza e relatório do que foi anonimizado. **Preciso do prazo que o jurista definir.**
4. **Horário e frequência de contacto** (limite de mensagens por semana e janela diária) — boa prática; não está na lei, é decisão de negócio.
5. **Registo de exportações e consultas** de dados pessoais por devedor (quem viu/exportou).
6. **Cifra em repouso** de NIF, telefone e email; **procedimento de incidente** e de fim de contrato (devolução/destruição).
7. **Registo das actividades de tratamento** (para as notificações à APD): finalidades, categorias, destinatários, prazos, transferências.

Fontes: [Lei n.º 22/11 (angolex)](https://angolex.com/paginas/leis/lei-de-protecao-de-dados-pessoais.html) · [Lei n.º 22/11 (lex.ao)](https://lex.ao/docs/assembleia-nacional/2011/lei-n-o-22-11-de-17-de-junho/) · [PLMJ — Dados Pessoais e Cibersegurança em Angola](https://plmj.com/xms/files/03_Novidades_legislativas/2024/N_Colab_RVA-PLMJ_Dados_Pessoais_e_Ciber-seguranca_em_Angola.pdf)
