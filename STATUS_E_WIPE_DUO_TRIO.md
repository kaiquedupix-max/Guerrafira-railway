# Bots de status e wipe por servidor

O mesmo processo no Coolify inicia o bot principal e dois bots de status.
Cada bot precisa de um token distinto e deve estar convidado ao Discord.
Os bots dedicados usam somente o intent Guilds e não registram comandos.
O código não precisa do Application ID dos bots dedicados para fazer login.

## Status

| Função | Variável no Coolify |
| --- | --- |
| Bot principal, total Duo + Trio | `DISCORD_BOT_TOKEN` existente |
| Bot dedicado ao Duo | `DUO_STATUS_BOT_TOKEN` |
| Bot dedicado ao Trio | `TRIO_STATUS_BOT_TOKEN` |
| Mensagem de status do Duo, opcional | `DUO_STATUS_CHANNEL_ID` |
| Mensagem de status do Trio, opcional | `TRIO_STATUS_CHANNEL_ID` |

Compatibilidade: se TRIO_STATUS_BOT_TOKEN não existir, o Trio usa
TRIO_DISCORD_BOT_TOKEN, quando configurado. Não repita o token principal.

Consultas ao Rust:

- Duo: `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD` existentes.
- Trio: `TRIO_RCON_HOST`, `TRIO_RCON_PORT`, `TRIO_RCON_PASSWORD`.

A presença atualiza a cada 30 segundos. Os bots dedicados mostram os online
somente no próprio servidor. O principal soma as conexões dos dois servidores,
sem incluir a fila. Se um servidor não responder, a presença mostra a soma
parcial com `+` e identifica a conexão indisponível.

Os canais são opcionais para a presença. Para publicar e atualizar uma mensagem
no canal, o bot correspondente precisa conseguir ver o canal, enviar mensagens,
inserir links/embeds e ler o histórico. A mensagem existente é reaproveitada no
reinício. Nome, avatar e banner das contas são configurados separadamente no Discord.

## /criarmapa

O primeiro campo obrigatório é `servidor`: Solo/Duo ou Trio. O /menu também
mostra essa seleção antes dos demais campos. Este comando agenda um **wipe de
mapa**, preservando blueprints. Não agenda wipe geral.

O alvo fica salvo junto aos mapas da votação e é restaurado após reinício.
Votações antigas sem alvo continuam no Solo/Duo. Cada servidor pode ter sua
própria votação ativa. Avisos de votação, vencedor, parada e retorno identificam
servidor e wipe de mapa. O Trio não utiliza credenciais do painel do Duo como
alternativa. O wipe do Trio não reseta o leaderboard compartilhado do Duo.

A agenda existente foi mantida: segunda/sexta, votação encerra às 18h de Brasília;
o fluxo técnico inicia às 18h25. A confirmação de retorno depende da hospedagem.
O horário público de referência permanece 18h30. Encerrar a votação manualmente
não antecipa o wipe, e votos antigos atrasados não são executados fora da janela.

Para o Trio, configure:

- `TRIO_PANEL_URL`, `TRIO_PANEL_SERVER_ID`, `TRIO_PANEL_API_KEY`: painel da
  hospedagem Rust compatível com a API Pterodactyl, não o endereço do Coolify.
- `TRIO_DISCORD_MAP_CHANNEL_ID`: canal de votação, obrigatório.
- `TRIO_DISCORD_CHAT_CHANNEL_ID`: canal de lembretes e resultado.
- `TRIO_DISCORD_ANNOUNCEMENTS_CHANNEL_ID`: avisos de parada e retorno.
- `TRIO_DISCORD_LOG_CHANNEL_ID`: avisos de falha técnica.
- `TRIO_RUST_SERVER_HOST`, `TRIO_RUST_SERVER_PORT`: botão de conexão.

O bot principal deve ter acesso aos canais acima: ele conduz as votações e os
avisos; os bots dedicados cuidam do status.

A execução automática depende também de `WIPE_EXECUTION_ENABLED=true`,
`WIPE_AUTOMATION_ENABLED=true` e da trava administrativa liberada. A integração
verifica as capacidades do painel para seed/size ou link .map antes de publicar
uma votação. A conexão de status por RCON e o wipe via painel são integrações
separadas: configurar só tokens de Discord não habilita essas duas integrações.

## Validação

Testes automatizados com Discord, RCON e hospedagem simulados cobrem soma dos
online, estados indisponíveis, alvo persistido, configuração isolada do Trio,
restauração de votos antigos e execuções simultâneas nos dois servidores.
Não foi executado wipe real nem login com credenciais de produção nesta sessão.
