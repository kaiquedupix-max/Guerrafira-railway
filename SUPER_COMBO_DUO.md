<!-- Atualização da loja, checkout e publicação no dedicado: veja LOJA_CHECKOUT.md. -->
# Super Combo Duo

Produto da loja `/loja`: R$ 120,00, Bronze + Prata + Ouro por 30 dias
para duas contas. O pacote individual continua em R$ 70,00 e os VIPs
individuais mantêm preços e checkout. O servidor Trio continua bloqueado.

## Fluxo e persistência

- Discord usa o OAuth existente. Steam usa OpenID com estado assinado,
  nonce e validação do `return_to`, endpoint e campos assinados.
- `store_steam_auth` registra somente autenticações oficiais. Vínculos antigos
  inferidos de compras não autorizam a compra/resgate Duo sem login Steam.
- PIX/Mercado Pago e Stripe criam pedidos pendentes com o preço definido no
  servidor. Os conciliadores consultam os provedores; nenhum retorno do navegador
  confirma pagamento. Para Duo, valor e moeda precisam corresponder ao pedido.
- Após aprovação, cria-se uma linha única em `duo_redemptions` por pagamento,
  com nonce aleatório, hash SHA-256 do token, vencimento e estado.
- O token é um HMAC reproduzível pelo backend para o comprador recuperar o
  mesmo link sem guardar o segredo de resgate em texto simples no banco.
- A loja lista compras e copia o link com token no fragmento (`#...`). A página
  remove o fragmento e mantém o token no armazenamento da aba durante o login.
  O token não vai em URLs de requests, no OAuth, nem em cabeçalhos Referer.
- Abrir/inspecionar não consome o link. O POST de confirmação exige sessão
  Discord, Steam oficialmente autenticada e origem do site. O comprador não
  pode ocupar a vaga, por Discord ou Steam.
- Uma trava consultiva do PostgreSQL por pagamento serializa entregas entre
  instâncias. Usa pool separado, limitado a quatro conexões, para não bloquear
  as conexões usadas pelas entregas. Uma tentativa concorrente recebe feedback
  para aguardar. A associação Steam/Discord é persistida antes dos comandos externos.
- Estados: `available`, `delivering`, `redeemed`; `expired` é calculado para
  links disponíveis vencidos. O prazo inicial é 30 dias após a primeira
  confirmação processada. Uma entrega já vinculada pode continuar após vencer.
- Bronze, Prata e Ouro são entregues separadamente com origem `purchase:<id>`.
  Retentativas ignoram componentes já registrados para o mesmo destinatário.
  Falhas parciais deixam a vaga vinculada. O conciliador tenta novamente a cada
  30 segundos. Outro duo nunca pode assumir essa vaga.
- Pagamentos não aprovados, incluindo cancelados ou estornados, bloqueiam novos
  resgates. A remoção de VIPs já entregues após estorno continua dependendo do
  processo administrativo existente.

Um link pode ser encaminhado/copiado várias vezes fora do site; o sistema
garante **uma vaga e um resgate concluído**, não controla o compartilhamento em
aplicativos externos. O duo confirma explicitamente a conta antes da vinculação.

## Configuração e publicação

As tabelas novas são criadas de forma idempotente no primeiro uso; o schema
Drizzle também as descreve. `vip_subscriptions.source` é ampliado para 64
caracteres para comportar IDs de pagamento. O usuário do banco precisa dessas
permissões DDL. Nenhum dado existente é apagado.

Configure um segredo estável `DUO_TOKEN_SECRET` no serviço do dedicado/Coolify. Se ausente, usa
`ADMIN_SESSION_SECRET` ou `DISCORD_CLIENT_SECRET`, sem fallback público.
Alterar esse segredo invalida links existentes; mantenha-o estável e faça uma
migração deliberada se precisar rotacionar. Checkout Duo falha sem um segredo.

Mantêm-se as configurações atuais de Discord, Mercado Pago, Stripe e RCON.
O domínio/callback do fluxo é `https://www.guerrafriarust.com.br`, seguindo o
checkout atual. `VIP_DUO_IMAGE_URL` é opcional; a arte padrão do Super Combo Duo
está em `artifacts/api-server/assets/vip-super-combo-duo.png`.
Os comandos RCON devem conceder grupos VIP de forma idempotente. Como no fluxo
atual, não há transação distribuída entre Rust, Discord e PostgreSQL: uma queda
após um comando externo e antes do registro pode exigir repetição desse comando.

## Validação

Execute `pnpm --filter @workspace/api-server test:duo`.
Os testes usam PostgreSQL embutido (PGlite), adaptadores de entrega/locks e DOM
para pagamento pendente, emissão única, inspeção, bloqueio do comprador,
concorrência, reuso, expiração, estorno, falha parcial e autenticação Steam.
As travas consultivas e os provedores reais exigem validação em staging.

Resultado local: 10 testes passaram, incluindo expansão real dos produtos e
recuperação do checkout após falha de rede. O teste legado
`scripts/test-vip-discord.cjs` também passou. As bibliotecas passaram na
checagem de tipos, e o bundle da rota da loja compilou. A conferência no
navegador confirmou cards de aproximadamente 264 px no desktop e ausência
de rolagem horizontal a 390 px de largura.

A checagem geral do backend apresenta os mesmos 39 erros da cópia original
de `main`. O build completo para no hook de wipe com
`same-day schedule validation source not found`, também reproduzido na
cópia original. Esses problemas não foram alterados por esta implementação.

Antes da publicação, validar com um pagamento de teste de cada provedor,
duas contas Steam/Discord distintas, reinício durante entrega parcial e dois
processos tentando resgatar simultaneamente. As regras de wipe e outros fluxos
fora da loja não foram alterados.
