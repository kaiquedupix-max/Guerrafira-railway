# Loja VIP no dedicado / Coolify

Todos os cinco produtos usam o mesmo card vertical. O Super Combo Duo (R$ 120,00)
inclui Bronze, Prata e Ouro para o comprador e para um duo. A arte está em
`artifacts/api-server/assets/vip-super-combo-duo.png` e é servida por
`/api/store/art/duo`. O build copia a arte para `dist/assets`; preserve essa
pasta ao publicar o artefato de produção.
Os embeds do Discord usam uma arte geral da loja em `vip-store-banner.png`,
servida por `/api/store/art/store-banner`, com “Loja VIP — Acesse a loja”.

## Pagamentos dentro do site

Configure as variáveis no serviço que executa o site/bot:

| Variável | Finalidade |
| --- | --- |
| `APP_URL` | URL HTTPS pública, atualmente `https://www.guerrafriarust.com.br` |
| `MP_ACCESS_TOKEN` | Credencial privada Mercado Pago (já usada pelo PIX) |
| `MP_PUBLIC_KEY` | Chave pública da mesma conta e ambiente, para Card Payment Brick |
| `MP_WEBHOOK_URL` | Opcional; padrão `${APP_URL}/webhook/mercadopago` |
| `STRIPE_SECRET_KEY` | Credencial privada Stripe |
| `STRIPE_PUBLISHABLE_KEY` | Chave pública Stripe do mesmo ambiente |
| `DUO_TOKEN_SECRET` | Segredo estável dos links de duo; preserve o valor existente |
| `DISCORD_VIP_STORE_CHANNEL_ID` | Canal VIP; padrão `1530049713422729328` |

Aliases públicos aceitos: `MERCADO_PAGO_PUBLIC_KEY` e `STRIPE_PUBLIC_KEY`.
Nunca coloque as credenciais privadas no frontend. Cada opção de cartão fica
indisponível quando sua chave pública/privada está ausente; PIX continua usando
o fluxo existente. As contas de pagamento devem permitir os recursos contratados.

Stripe usa Embedded Checkout (`ui_mode=embedded`, cartão, sem redirecionamento
na conclusão). Mercado Pago usa Card Payment Brick para tokenização e Status
Screen Brick para confirmação/3DS. O site recebe apenas o token do cartão;
não armazena número ou CVV. A sessão Discord e a autenticação oficial Steam
identificam o destinatário. Produto, valor e identidade são determinados no
backend, nunca pelo formulário do provedor.

`store_card_attempts` é criada automaticamente no primeiro pagamento com cartão
Mercado Pago. Uma UUID vincula a tentativa ao pagamento, comprador, Steam,
produto, e-mail e valor. Repetir a mesma tentativa usa a mesma chave de
idempotência do provedor, inclusive após perda de conexão; o token não é
persistido. Consultas de status e confirmação Stripe exigem o dono da compra.
Somente consultas oficiais aos provedores confirmam pagamentos e concedem VIPs.
PIX apresenta QR, código copiável, validade e acompanhamento da confirmação.

O fluxo de resgate do duo permanece descrito em `SUPER_COMBO_DUO.md`:
um destinatário, vínculo persistente, validade de 30 dias e retomada de entrega
parcial. Copiar/abrir o link não consome o resgate; outro duo não pode reutilizá-lo.

## Discord e publicação

Após publicar e reiniciar o bot, ele percorre todo o canal VIP, cria/atualiza
dois embeds com botões de link para Solo/Duo e Trio e remove os outros cards
publicados pelo próprio bot. Mensagens de pessoas são preservadas. Os dois
substitutos precisam existir antes da limpeza; reinícios não duplicam os cards.
O bot precisa de acesso ao histórico, envio de mensagens/embeds e remoção de
suas mensagens. Os botões de venda antigos passam a mostrar a loja, sem gerar
pagamentos ou coletar dados. Tickets de suporte, cargos e concessões continuam.

Trio continua em preparação conforme `core/servers.ts`. O botão abre a seleção
Trio, inclusive após login Discord; não cobra por um servidor indisponível.

No Coolify, publique a `main` no serviço atual, preservando banco, segredos e
configuração RCON. A limpeza real dos cards acontece no próximo início do bot.
Faça uma compra em ambiente de teste com cada provedor e autentique duas
contas distintas para conferir comprador/duo antes de liberar pagamentos reais.

## Verificação

`pnpm --filter @workspace/api-server test:store`: 16 testes cobrem resgate único,
expiração, estorno, entrega parcial, validação Steam, snapshot da tentativa,
repetição após falha de rede, contratos dos provedores, montagem dos SDKs sem
navegar para fora e migração idempotente do Discord com mais de 100 cards.
Também reproduzem a desvinculação Steam com histórico de pagamentos/VIPs,
confirmando ausência de recriação do vínculo, remoção da confirmação oficial,
rollback atômico e atualização de um checkout já aberto.
SDKs/pagamentos/Discord são simulados nos testes; não houve cobrança real.
O build completo do backend passou ao normalizar LF para o hook de wipe existente
(o checkout Windows usa CRLF). Não alteramos as regras de wipe. A checagem geral
de tipos mantém os 39 erros preexistentes; as bibliotecas passam.

## Desvinculação Steam

O vínculo atual tem uma única fonte: `booster_links`. Consultar o site não
importa identidades de pagamentos nem de VIPs antigos. `/steam desvincular`
e o painel administrativo removem o vínculo e `store_steam_auth` na mesma
transação. Trocas administrativas invalidam a confirmação oficial anterior.
O histórico e os VIPs já entregues são preservados.

Uma loja já aberta atualiza a conta a cada 10 segundos, remove o SteamID antigo
e bloqueia novos pagamentos enquanto a Steam estiver desconectada. Se a versão
antiga já recriou um vínculo após o comando, execute `/steam desvincular`
novamente após atualizar o bot; a nova versão não o recriará.

Documentação dos provedores:
- https://docs.stripe.com/payments/checkout/custom-success-page?payment-ui=embedded-form
- https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/card-payment-brick/payment-submission
- https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/how-tos/integrate-3ds
