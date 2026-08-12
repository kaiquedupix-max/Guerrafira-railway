# Deploy no Railway — Guerra Fria

Este projeto foi ajustado para subir diretamente no Railway sem depender do ambiente do Replit.

## 1. Crie um projeto novo no Railway

Conecte o novo repositório GitHub ao Railway.

## 2. Adicione PostgreSQL

No mesmo projeto Railway, adicione um serviço PostgreSQL.

No serviço do bot, em **Variables**, crie `DATABASE_URL` como referência à variável `DATABASE_URL` do PostgreSQL. Se o serviço se chamar `Postgres`, o valor será:

`${{Postgres.DATABASE_URL}}`

> Se você der outro nome ao serviço PostgreSQL, use esse nome na referência.

## 3. Importe as variáveis

Use o arquivo `.env.example` como lista. O Railway também pode sugerir essas variáveis automaticamente ao detectar o arquivo.

Preencha obrigatoriamente:

- `DISCORD_BOT_TOKEN`
- `RCON_PASSWORD`
- `MP_ACCESS_TOKEN`
- `DATABASE_URL`

Os IDs de Discord, RCON host/porta, preços e comandos VIP já estão no `.env.example`.

## 4. Domínio

Não é necessário preencher `APP_DOMAIN` no Railway. O bot usa `RAILWAY_PUBLIC_DOMAIN` automaticamente para montar o webhook do Mercado Pago.

Depois do primeiro deploy, gere um domínio público para o serviço em **Settings > Networking > Public Networking**.

## 5. Banco de dados

Antes de cada novo deploy, o `preDeployCommand` executa `pnpm --filter @workspace/db run init`. O script cria com `IF NOT EXISTS` as tabelas que o bot utiliza. Ele não apaga dados existentes.

## 6. Healthcheck

O Railway verifica `/api/healthz`, que responde HTTP 200 quando o servidor está no ar.

## 7. Start

O processo de produção inicia com:

`node artifacts/api-server/dist/index.mjs`

## Diagnóstico rápido

- `DATABASE_URL não está configurada`: crie a referência ao PostgreSQL no serviço do bot.
- `getaddrinfo ENOTFOUND ...`: a URL do banco está incorreta; não digite host manualmente, use a referência do Railway.
- `DISCORD_CLIENT_ID not set`: importe as variáveis do `.env.example` para o serviço.
- `RCON not connected`: confira `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD` e se WebRCON está habilitado no servidor Rust.
