# Atualização Guerra Fria — site, Season e Trio

Data: 19/10/2026. Este relatório descreve mudanças no código e os testes executados. Publicação na main não significa que o Coolify ou os plugins dos servidores já foram atualizados.

## Resultado

- Uma inscrição e uma pontuação da Season por Steam: eventos válidos recebidos do Duo e do Trio contribuem para a mesma classificação.
- Leaderboard do wipe separado por servidor, com seleção Duo/Trio na página e links corretos no comando do Discord.
- Páginas públicas com a paleta escura, cartões arredondados, detalhes dourados e efeitos discretos inspirados na loja. O checkout mantém seus estilos e comportamento.

## Falhas encontradas e correções

| Área | Falha encontrada | Correção |
| --- | --- | --- |
| Leaderboard Trio | Página e comandos consultavam a tabela do Duo | Tabela própria para Trio; consultas, eventos, detector de combate e reset respeitam o servidor |
| Eventos do Trio | Ponte RCON encaminhava chat, mas não estatísticas | Encaminha também kills, coleta, crafting e uso de explosivos |
| Repetição de eventos | Identificadores não distinguiam servidores; deduplicação em memória usava só o início da mensagem | Identificação por servidor e evento, mensagem completa e recibo persistente para eventos identificados |
| Gravação do leaderboard | Recibo e estatísticas eram gravados separadamente | Transação para recibo, kill e morte; repetição não soma novamente |
| Reset do wipe | Reset do Trio era ignorado | Zera somente o servidor selecionado e invalida o cache de leitura |
| Season compartilhada | Snapshot absoluto de um servidor podia sobrescrever o outro | Eventos da Season 2 somam deltas na mesma transação do recibo; a classificação usa o livro de transações |
| Consistência de patentes | Site e sincronizadores calculavam MMR de formas diferentes | Consulta comum para ranking público, cargos Discord, patentes Rust, inscritos oficiais atuais e auditoria |
| Patentes Rust | Estado global não distinguia Duo e Trio | Estado persistente por servidor; falha ao consultar administração impede alteração naquela tentativa |
| Estatísticas da Season | Busca genérica por “headshot” incluía flags falsas; mortes e assistências ficavam zeradas | Reconhece flags verdadeiras, inclusive `HS=True` do plugin, e conta eventos de morte/assistência |
| Bootstrap | Restauração podia usar MMR de snapshot antigo | Restaura o MMR compartilhado pelo livro de transações da Season 2 |
| Controle da Season | Bloqueio consultava Season 1 e referenciava variável inexistente | Consulta a Season correspondente ao calendário e autentica a origem |
| Autenticação | Não havia origem específica para Trio | Cabeçalho `X-GF-Server`, validação da origem e opção de segredos próprios; compatibilidade com os segredos anteriores do leaderboard |
| Inicialização | Serviços começavam no import, antes de preparar o banco | Inicialização explícita após as tabelas; preparação de tabelas da Season reaproveitada nas inscrições |
| Status Trio | Nova conexão WebSocket a cada consulta | Usa conexão RCON compartilhada e cache curto por servidor |
| Carregamento | Atualizações simultâneas e falhas podiam apagar rankings já carregados | Limite de tempo, uma atualização de lista por vez, preservação dos dados e atualização automática quando visível |
| Perfil | Falha de rede era mostrada como Season ainda não iniciada | Mensagem de indisponibilidade; estatísticas do wipe não são sobrescritas pela consulta da Season |
| Discord | Leitura de componentes pressupunha que todo componente tivesse filhos | Verificação do tipo antes de acessar componentes de cartões de status e tickets |
| E-mails antigos | Encerramento da Season 1 procurava a Season com atividade mais recente | Mantém a classificação vinculada à Season 1, correspondente às inscrições 101 |

## Ativação em produção

1. Fazer deploy da main no Coolify e confirmar que `/status` responde normalmente. As tabelas novas são preparadas pela aplicação, sem apagar as tabelas antigas.
2. Atualizar `rust-plugins/GuerraFriaSeasonV117.cs` em ambos os servidores, preservando os demais valores da configuração. Em `SeasonApi`, configurar `ServerId` como `solo-duo` no Duo e `trio` no Trio. Manter a API habilitada e o segredo correto.
3. Atualizar `rust-plugins/GuerraFriaLeaderboard.cs` nos dois servidores. A versão 1.5.0 inclui identificador único por evento. O bot precisa estar conectado ao RCON de cada servidor para receber esses eventos.
4. Conferir `TRIO_RCON_HOST`, `TRIO_RCON_PORT`, `TRIO_RCON_PASSWORD`, `TRIO_RUST_SERVER_HOST` e `TRIO_RUST_SERVER_PORT` no ambiente. Não usar credenciais do Duo como substituto das do Trio.
5. Opcionalmente separar `TRIO_SEASON_WEBHOOK_SECRET` e `TRIO_LEADERBOARD_WEBHOOK_SECRET`; se usados, os emissores do Trio precisam enviar os novos valores. Sem essas variáveis, permanece o segredo compartilhado com origem explícita.
6. Validar uma kill e uma coleta em cada servidor, o ranking de cada wipe, a soma da Season do mesmo jogador e a patente nos dois servidores. Conferir logs de eventos aceitos/repetidos/rejeitados e a ausência de erros de autenticação.

Recarregar os plugins pelo procedimento habitual do servidor. O deploy do site, sozinho, não altera os arquivos nem a configuração do Pterodactyl.

## Testes e limites

Foram adicionados testes SQL com PostgreSQL embarcado e testes de interface com DOM: soma Duo+Trio, evento repetido, rollback e nova tentativa, origem/segredo inválidos, reset isolado, patentes por servidor, bootstrap e consistência da auditoria. A interface é exercitada com erro de rede, nova tentativa, nomes escapados e proteção dos estilos da loja. A suíte completa e a compilação do banco/API são executadas antes da publicação; o CI também verifica a inicialização HTTP com PostgreSQL e o plugin de moderação existente.

- Não houve acesso ao banco, Discord ou servidores Rust de produção nesta atualização. A instalação e execução dos dois plugins alterados precisam ser confirmadas no servidor real.
- Dados antigos do leaderboard gravados sem origem não permitem reconstruir com segurança o histórico do Trio. Não houve transferência artificial desses pontos para a tabela nova.
- A Season só recebe eventos quando seu calendário/controle permitem pontuar. A alteração não inventa eventos antigos nem altera as regras de pontuação do plugin.
- A revisão encontrou e corrigiu os problemas descritos; não representa garantia de ausência de qualquer outro bug em todo o repositório. A checagem TypeScript integral ainda acusa erros anteriores em módulos legados; a compilação usada no deploy é verificada separadamente.
- O visual foi verificado por testes de estrutura/comportamento; não foi realizada aprovação visual em navegadores/dispositivos reais.
