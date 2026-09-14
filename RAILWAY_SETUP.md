# Deploy no Railway — Guerra Fria

Este projeto foi ajustado para subir diretamente no Railway sem depender do ambiente do Replit.

## 1. Crie um projeto novo no Railway

Conecte o novo repositório GitHub ao Railway.

## 2. Adicione PostgreSQL

No mesmo projeto Railway, adicione um serviço PostgreSQL.

No serviço do bot, em **Variables**, crie `DATABASE_URL` como referência à variável `DATABASE_URL` do PostgreSQL. Se o serviço se chamar `Postgres`, o valor será:

`${{Postgres.DATABASE_URL}}`

> Se você der outro nome ao serviço PostgreSQL, use esse nome na referência.

## 3. Variáveis principais

No serviço da aplicação, em **Variables**, mantenha configuradas as credenciais já usadas pelo projeto, incluindo:

- `DISCORD_BOT_TOKEN`
- `RCON_PASSWORD`
- `MP_ACCESS_TOKEN`
- `DATABASE_URL`

Os demais IDs do Discord, RCON host/porta, preços e comandos VIP devem continuar com os valores do ambiente de produção.

## 4. Stripe — segunda opção de cartão

A loja aceita os seguintes caminhos:

- **PIX:** Mercado Pago
- **Cartão:** Mercado Pago
- **Cartão alternativo:** Stripe

A interface informa ao comprador que ele pode usar **Stripe caso o cartão não funcione no Mercado Pago**, mas também permite escolher Stripe diretamente.

Para habilitar o Stripe, adicione no Railway apenas esta variável:

```text
STRIPE_SECRET_KEY=sk_live_...
```

Para testar antes de usar dinheiro real, use temporariamente uma chave `sk_test_...`.

Não coloque essa chave no GitHub, no frontend ou em arquivos públicos. Ela deve ficar somente nas **Variables** do Railway.

### Como funciona

O Stripe usa Checkout hospedado e aceita apenas **cartão** neste fluxo. O valor do VIP é definido pelo backend; o navegador não envia o preço.

Depois do pagamento, o servidor consulta a sessão diretamente na API da Stripe e só ativa o VIP quando `payment_status` estiver como `paid`. Além do retorno imediato da página, existe uma conciliação automática dos pagamentos Stripe pendentes a cada 30 segundos. Assim, se o comprador fechar a página após pagar, a compra continua sendo verificada pelo servidor.

O fluxo não exige `STRIPE_PUBLISHABLE_KEY` nem webhook da Stripe para funcionar. A única variável nova obrigatória é `STRIPE_SECRET_KEY`.

Se `STRIPE_SECRET_KEY` não estiver configurada, a opção Stripe aparece indisponível e **Mercado Pago continua funcionando normalmente**.

## 5. Domínio

Não é necessário preencher `APP_DOMAIN` no Railway. O projeto usa `RAILWAY_PUBLIC_DOMAIN` automaticamente. Para o Stripe, `APP_URL` pode ser usado opcionalmente se você quiser forçar uma URL pública específica; caso contrário, o domínio público do Railway é utilizado.

Depois do primeiro deploy, gere um domínio público para o serviço em **Settings > Networking > Public Networking**.

## 6. Banco de dados

Antes de cada novo deploy, o `preDeployCommand` executa `pnpm --filter @workspace/db run init`. O script cria com `IF NOT EXISTS` as tabelas e colunas utilizadas pelo projeto. Ele não apaga dados existentes.

A integração Stripe adiciona ao histórico de pagamentos os identificadores da Checkout Session e do PaymentIntent para conciliação e auditoria.

## 7. Healthcheck

O Railway verifica `/api/healthz`, que responde HTTP 200 quando o servidor está no ar.

## 8. Start

O processo de produção inicia com:

`node artifacts/api-server/dist/index.mjs`

## Diagnóstico rápido

- `DATABASE_URL não está configurada`: crie a referência ao PostgreSQL no serviço do bot.
- `getaddrinfo ENOTFOUND ...`: a URL do banco está incorreta; não digite host manualmente, use a referência do Railway.
- `DISCORD_CLIENT_ID not set`: confira as variáveis do Discord no serviço.
- `RCON not connected`: confira `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD` e se WebRCON está habilitado no servidor Rust.
- Botão Stripe indisponível: configure `STRIPE_SECRET_KEY` e faça um novo deploy.
- Stripe abre em modo de teste: você configurou uma chave `sk_test_...`; para produção use a chave secreta `sk_live_...` da conta Stripe correta.
