# Loja, Trio e CISO

## Preços e entregas

`storePricing.ts` é a fonte de preços em centavos. Solo/Duo: Bronze 15, Prata 20, Ouro 40, pacote 70 e Super Combo 120 reais. Trio: 20, 30, 50, 93,33 e 200 reais, respectivamente. O preço de tabela do Super Combo Trio é 240 reais. Comprar nos dois servidores aplica 10% sobre a soma dos preços promocionais.

O Super Combo Solo/Duo inclui comprador e um amigo; Trio inclui comprador e dois amigos. Na compra combinada, comprador e primeiro amigo recebem em ambos; segundo amigo recebe no Trio. Pedidos antigos preservam a capacidade original de um convite. Os convites são individuais, exigem Steam oficial e Discord distintos, expiram em 30 dias e ficam associados ao destinatário na primeira tentativa de entrega. Uma entrega parcial pode ser retomada sem duplicar benefícios.

O checkout exige escolher o servidor a cada abertura. Os cards individuais ocultam o preço; Super Combo exibe o menor preço inicial. O selo Mais popular usa apenas pagamentos aprovados dos VIPs individuais. Cartão/Pix Mercado Pago ficam no site; Stripe usa checkout hospedado. A confirmação só informa benefícios ativos depois da entrega. Todos os convites também integram o recibo privado do Discord, com retentativa em caso de falha.

## Catálogo e administração

O catálogo vem de `VipKits.cs`, com ícones por shortname e categorias Recursos, Componentes, Armas e Roupas. Aliases de kits iguais são deduplicados; kits diferentes, quantidades, skins e prazos são preservados.

As requisições administrativas identificam o servidor via `X-GF-Server`. RCON, console da hospedagem, arquivos, energia, caches e reinícios ficam separados por servidor. Recursos históricos exclusivos do Duo rejeitam solicitações direcionadas ao Trio. A hospedagem requer uma chave Pterodactyl válida; RCON e vendas não dependem dessa chave. Nunca versionar chaves ou arquivos de jogadores.

## CISO

`GuerraFriaSeasonV117.cs` aplica o multiplicador à pontuação no momento da ação: 100 ou mais jogadores conectados = 100%; 30–99 = 50%; menos de 30 = 20%. O registro conserva população e multiplicador aplicado. A auditoria fica restrita à administração. A configuração existente do plugin, incluindo o segredo de integração, deve ser preservada ao atualizar.

## Artes

Artes criadas com a ferramenta integrada de geração de imagens, em `artifacts/api-server/assets/vip-rust-*.webp`. Briefing: personagens contemporâneos de Rust; Bronze hazmat em bronze/cobre; Prata fullset de placas de trânsito e capacete de lata de café em prata; Ouro facemask com sorriso e olhos em chamas em dourado. Combos usam os mesmos personagens. Fundo transparente, sem textos, preços, molduras ornamentadas ou elementos medievais.

## Validação

Executar os testes Node em `artifacts/api-server`: `tests/duo.test.mjs`, `storeCheckout.test.mjs`, `storeCatalog.test.mjs`, `vipServers.test.mjs`, `vipMigration.test.mjs`, `storePricing.test.mjs` e `adminServerContext.test.mjs`. Cobrem concorrência de resgate, retomada de entrega, pedidos antigos, preços, isolamento dos servidores e preservação das validades. Pagamento real exige uma transação do proprietário.
