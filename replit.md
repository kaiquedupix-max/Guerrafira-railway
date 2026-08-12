# Guerra Fria — Bot de Administração Discord

Bot Discord para administração do servidor de jogo Rust hospedado na Shockbyte. Permite banir, kickar e verificar jogadores (online e offline) com logs formatados em embeds.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — inicia o servidor + bot Discord (porta 8080)
- `pnpm run typecheck` — verificação TypeScript completa
- `pnpm --filter @workspace/db run push` — aplica mudanças no schema do banco de dados

## Variáveis de Ambiente Necessárias

| Variável | Tipo | Descrição |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Secret | Token do bot (Discord Developer Portal) |
| `DISCORD_CLIENT_ID` | Env | Application ID do bot |
| `DISCORD_GUILD_ID` | Env | ID do servidor Discord |
| `DISCORD_LOG_CHANNEL_ID` | Env | ID do canal de logs de moderação |
| `DISCORD_VERIFIED_ROLE_ID` | Env | ID do cargo "Verificado" |
| `RCON_HOST` | Env | IP/hostname do servidor Rust (Shockbyte) |
| `RCON_PORT` | Env | Porta RCON (padrão: 28016) |
| `RCON_PASSWORD` | Secret | Senha RCON do servidor |
| `DATABASE_URL` | Gerenciado | Banco PostgreSQL (provisionado automaticamente) |

## Comandos do Bot

| Comando | Permissão | Descrição |
|---|---|---|
| `/banir <jogador> <motivo>` | BanMembers | Bane jogador online ou offline via Steam ID |
| `/kickar <jogador> <motivo>` | KickMembers | Expulsa jogador online do servidor |
| `/verificar <jogador>` | ManageRoles | Verifica jogador após triagem anti-cheat |

Todos os comandos usam **autocomplete** — ao digitar o nome, aparece a lista de jogadores (🟢 online / ⚫ offline) com Steam ID.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: discord.js v14
- RCON: rcon-client (protocolo Source RCON — compatível com Rust)
- DB: PostgreSQL + Drizzle ORM
- API: Express 5

## Onde as Coisas Ficam

- `artifacts/api-server/src/bot/` — código do bot Discord
  - `commands/` — banir.ts, kickar.ts, verificar.ts
  - `utils/rcon.ts` — cliente RCON com reconexão automática
  - `utils/embeds.ts` — embeds formatados para os logs
  - `utils/players.ts` — operações no banco de jogadores
- `lib/db/src/schema/players.ts` — tabela de jogadores
- `lib/db/src/schema/modLogs.ts` — tabela de logs de moderação

## Como Funciona

1. A cada 30s o bot consulta o RCON (`playerlist`) e atualiza a tabela `players`
2. Jogadores que entraram ficam salvos mesmo offline
3. `/banir` executa `banid <steamId>` no RCON (funciona offline)
4. `/kickar` executa `kick <name>` — só funciona com jogador online
5. `/verificar` registra no banco e posta embed no canal de logs

## Gotchas

- Os slash commands são registrados no servidor (guild) — ficam disponíveis instantaneamente
- Se o RCON não estiver configurado, o ban ainda é registrado no DB mas não aplicado no servidor
- Para o `/verificar`, o cargo "Verificado" deve ser atribuído manualmente no Discord (não há vinculação automática Discord↔Steam)

## User preferences

_Preencher conforme preferências explícitas do usuário._
