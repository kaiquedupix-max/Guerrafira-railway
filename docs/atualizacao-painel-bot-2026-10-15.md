# Atualização do painel e bot — 15/10/2026

## Correções e mudanças

- Jogadores: diretório persistente separado por servidor, atualização em segundo plano, pesquisa e paginação. Autocomplete deixa de consultar o RCON e milhares de logs a cada tecla.
- Falhas do RCON preservam o último snapshot conhecido, sem marcar todos offline. Leituras simultâneas compartilham a mesma consulta, com cache curto separado por servidor.
- Painel: removidos ciclos de MutationObserver que disparavam requisições e alterações de DOM repetidamente; uma consulta de resumo substitui múltiplas consultas concorrentes. Atualização periódica apenas da página ativa quando visível.
- Requisições: cabeçalho do servidor definido antes do primeiro carregamento; requisições explícitas de outro servidor são respeitadas. Leituras transitórias podem ser repetidas uma vez; ações nunca são repetidas automaticamente pelo navegador.
- Gaveta do jogador: exibe carregamento e falhas reais; ações não partem de dados vazios após erro. Respostas antigas não sobrescrevem outro jogador selecionado.
- VIPs: consulta em lote da origem de compras antigas substitui consultas individuais por assinatura.
- Banimento: fluxo Discord com motivo, duração, opção de incluir o time real e confirmação. Nomes apresentados antes da ação; mudança no time exige nova revisão. O painel usa o mesmo serviço de associação.
- Banimentos e desbanimentos continuam sendo aplicados no Duo e Trio. Falhas parciais permanecem na fila durável de sincronização já existente.
- Steam/IP: novo plugin GuerraFriaModeration captura endereços, mantém bloqueios persistentes e impede login por outra Steam que compartilhe um IP bloqueado. Duração e desbanimento respeitam a regra de origem; duas regras para o mesmo IP continuam independentes.
- Inicialização: tarefas secundárias do Discord são isoladas; uma falha de canal, ranking ou comandos não interrompe a inicialização das outras.
- Telemetria e recursos do painel passam a manter amostras independentes para Duo e Trio.

## Chat Duo e Trio

- Painel exibe duas colunas, com consultas isoladas e seletor explícito do destino de envio.
- O bot principal cria `chat-trio` clonando o canal configurado do Duo, incluindo categoria e permissões, e posiciona o novo canal ao lado dele.
- ID persistido no banco para reutilização após reinícios. Canal Trio configurado ou existente é reaproveitado. Reconciliação a cada minuto permite recuperar falhas temporárias de acesso ao Discord.
- Mensagens do jogo são enviadas somente ao canal correspondente. IDs Duo/Trio iguais nunca autorizam envio de mensagens Trio ao canal Duo.
- Mensagens do Discord são enviadas somente ao Rust correspondente; reação indica confirmação ou falha do RCON.
- Bridge aceita o JSON de chat também em eventos genéricos do BetterChat. Chat de time não é publicado no Discord, e mensagens dos jogadores não disparam menções.
- Envio no painel só é registrado como mensagem de administração após confirmação do RCON.

## Implantação e limites de validação

A aplicação tenta instalar o plugin em `/carbon/plugins` ou `/oxide/plugins` pelo Pterodactyl usando as credenciais de cada servidor, e exige resposta `GF_GUARD_READY_1` antes de confirmar proteção por IP. O bot precisa de Gerenciar Canais e das permissões de leitura/envio no canal Duo. Não é necessário informar manualmente o novo ID Trio.

IPs nunca observados não podem ser recuperados: a resposta informa quando a Steam foi banida mas o IP é desconhecido. IPs compartilhados ficam bloqueados pela regra solicitada. Uma conta alternativa tem o login recusado pela regra de IP; não é criado um banimento nativo permanente independente, para preservar expiração e desbanimento corretos.

Banimentos iniciados no bot/painel são espelhados nos dois servidores. Banimentos digitados diretamente no console Rust recebem proteção local pelo hook; o hook não transforma comandos externos em operações globais.

A suíte cobre cache, SQL do diretório, painel completo em DOM simulado, provisionamento de canais, roteamento de chat, associação, moderação global e regressões existentes. O CI compila o banco e a API, inicia a aplicação contra PostgreSQL real e executa o plugin C# contra adaptadores da API Rust. Essa validação não substitui a compilação Carbon/Oxide no servidor real nem um teste de reconexão de jogador em produção. Há erros TypeScript antigos fora deste escopo; o build oficial usa esbuild e é verificado separadamente.

Publicação do código, execução de CI e deploy no Coolify são estados distintos. Não há confirmação de implantação ou alteração dos canais reais sem acesso ao ambiente de produção.
