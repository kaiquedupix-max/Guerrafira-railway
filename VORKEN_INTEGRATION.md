# Integração Guerra Fria ↔ Vorken

A verificação administrativa do Rust, o bot do Discord e o Vorken usam a mesma sessão.

## Fluxo

1. A staff usa `/telagem`.
2. O plugin `Verificacao.cs` mostra ao jogador um código individual.
3. O jogador envia o código no canal `#verificacao`.
4. O bot cria uma sala privada e solicita ao Vorken uma análise vinculada ao SteamID.
5. O link exclusivo do Vorken é enviado dentro da sala privada.
6. Ao finalizar o scanner, a análise aparece no painel do Vorken.
7. No painel do Vorken a staff pode liberar ou banir o jogador. A decisão volta para o Guerra Fria via API e RCON.

## Variáveis no Guerra Fria / Coolify

Obrigatórias:

- `VORKEN_GF_INTEGRATION_KEY`: segredo compartilhado. Deve ser exatamente igual no Vorken.
- `DISCORD_GUILD_ID`: servidor Discord onde o fluxo será criado.

Opcional:

- `VORKEN_BASE_URL`: URL do Vorken. Padrão: `https://vorkenac.guerrafriarust.com.br`.
- `DISCORD_VERIFICATION_CHANNEL_ID`: canal fixo para receber os códigos. Se não for informado, o bot procura/cria `#verificacao`.
- `DISCORD_VERIFICATION_CATEGORY_ID`: categoria dos tickets. Se não for informado, o bot procura/cria `VERIFICAÇÃO VORKEN`.
- `DISCORD_VERIFICATION_STAFF_ROLE_IDS`: IDs de cargos separados por vírgula. Mesmo sem esta variável, cargos com permissões administrativas/moderação são adicionados ao ticket.

O bot precisa de permissão para criar/gerenciar canais e sobrescritas de permissões no Discord.

## Endpoint recebido do Vorken

`POST /api/integrations/vorken/decision`

Autenticação: cabeçalho `x-vorken-integration-key`.

Esse endpoint é interno à integração e não deve ser exposto sem o segredo compartilhado.
