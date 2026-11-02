# Revisão da moderação e do painel — 28/10/2026

Repositório: `kaiquedupix-max/Guerrafira-railway`.

## Correções

- Banimento continua atingindo Duo e Trio, incluindo associação. O Discord recebe um card por jogador após a confirmação dos dois servidores. Reaplicar um banimento atualiza o card existente.
- O card informa **Banido de todos os servidores do Guerra Fria**, com identidade Steam, motivo, duração e responsável. A referência da mensagem é persistida; operações seguintes não precisam percorrer o histórico do canal.
- Desbanimento dispensa motivo no serviço central, no comando e no painel. Não publica mensagem no jogo, card, DM ou push. Apaga o card anterior, incluindo duplicados antigos encontrados nos canais configurados. A resposta privada da operação e o registro administrativo interno continuam existindo.
- Falhas do Discord deixam uma tarefa persistida para repetir a atualização do card sem repetir o desbanimento no jogo.
- Banimentos só são confirmados após consulta à lista nativa e salvamento. Uma resposta vazia do transporte não comprova um banimento.
- Mute e desmute usam comandos próprios do plugin com confirmação explícita, persistência e expiração local. Há suporte a chat padrão e BetterChat, reconexão e recarga do plugin. Painel e bot usam o mesmo serviço e os mesmos prazos.
- Expiração e novas punições usam a mesma trava por jogador. Um banimento antigo não deve remover uma punição nova ou uma sincronização pendente mais recente.
- A limpeza do banco preserva estados de moderação e tarefas pendentes necessários para não fazer uma punição antiga reaparecer.
- A central pública mostra um banimento por jogador e remove o registro após desbanimento. Filtragem e limite são aplicados no banco; foi acrescentado índice para consultas do histórico por SteamID.
- Foi removido o segundo card que a terceira advertência enviava após o serviço de banimento já ter enviado o card principal.
- O painel reaproveita o estado já consultado do jogador, evita alterações causadas por uma resposta atrasada em outra ficha e bloqueia troca de jogador/servidor enquanto uma ação aguarda confirmação.
- Escritas invalidam o cache de leitura; respostas antigas em andamento não repovoam o cache após uma alteração.
- Comandos com entrega ambígua não são repetidos automaticamente, para evitar duplicar itens ou outras ações. O erro orienta conferir o estado antes de reenviar.
- Validação recusa SteamIDs com sufixos, quantidades inválidas e teleporte para o próprio jogador.
- Corrigidos erros de TypeScript e o ponto de entrada antigo do bot passou a usar a implementação atual. Ajustados testes para Windows e para o calendário oficial já existente, sem alterar horários de wipe.

## Validação

- Suíte completa: **189 testes aprovados em Node 22.23.4**, com banco PostgreSQL compatível em memória, simulações de Discord/RCON e execução do painel em JSDOM.
- Plugin C#: **22 verificações aprovadas**, compilado em .NET 8 contra adaptadores da API Rust/Oxide. Inclui IP, associação de time, mute, desmute, recarga, expiração e BetterChat.
- Checagem de tipos de todos os projetos do workspace e build de produção da API aprovadas.

Essas verificações não executam punições em jogadores reais. A compatibilidade com a versão e os demais plugins instalados em produção precisa ser validada no servidor real após a publicação.

## Publicação

1. Publicar a branch revisada e executar o predeploy existente (`lib/db/init-db.mjs`), que cria o índice sem alterar dados de moderação.
2. A build inclui `GuerraFriaModeration.cs` 1.1.0. O mecanismo existente de instalação verifica `GF_GUARD_READY_2` e atualiza o plugin nos servidores ao preparar a moderação.
3. O bot precisa acessar os canais de logs com permissão de visualizar, ler histórico, enviar/editar suas mensagens e excluir seus cards. A busca legada considera os canais configurados e mensagens do próprio bot.
4. Conferir com uma conta de teste: mute curto, desmute, banimento nos dois servidores, card único e desbanimento silencioso pelo painel e pelo comando. Nunca usar conta de jogador real para esse teste.

## Próximas melhorias sugeridas

1. **Central de operações:** mostrar por ação o estado de Duo, Trio e Discord, tentativas pendentes e último erro. Aproveitar a fila de sincronização existente.
2. **Permissões por função:** separar consulta, mute/kick, banimento, VIP/itens e controle do servidor; registrar quem confirmou cada ação.
3. **Identificador único por solicitação e trava compartilhada no banco:** impedir que duas instâncias ou dois moderadores executem acidentalmente a mesma operação. As travas desta revisão coordenam operações dentro de uma instância.
4. **Linha do tempo por jogador:** reunir punições, recursos, provas e sincronizações, mantendo o desbanimento sem anúncios públicos.
5. **Ambiente de homologação e verificações de CI:** executar esta suíte antes de publicar, testar a combinação real de plugins e simular queda de um servidor sem afetar jogadores.

Referências das integrações: [OnPlayerChat (Oxide)](https://docs.oxidemod.com/hooks/player/OnPlayerChat) e [OnBetterChat / CancelOption (uMod)](https://umod.org/plugins/better-chat#onbetterchat).
