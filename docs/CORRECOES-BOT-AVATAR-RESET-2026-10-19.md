# Correções: respostas do bot, avatar e reset de wipe

- Perguntas sobre wipe são diferenciadas de anúncios. O aviso com `@everyone` não dispara resposta automática.
- Uma reserva persistente por mensagem impede respostas duplicadas entre processos/deploys. O envio usa também nonce do Discord; instalação dos listeners é idempotente.
- Foto e nome do Discord são carregados no cabeçalho compartilhado de loja, leaderboard, Season, doações, integridade, status, perfil e administração. O menu mantém a inicial como alternativa se a imagem falhar.
- Reset do leaderboard remove todos os registros de estatísticas daquele wipe e servidor, incluindo a contagem de jogadores, líderes, farm e raid. Diretório de jogadores e Season não são apagados.
- O reset grava um limite de tempo e bloqueia eventos antigos que poderiam repor pontos depois dele. Reset e ingestão usam a mesma trava transacional por servidor.
- O plugin de leaderboard 1.6.0 envia a data de criação do save em cada evento e um aviso periódico. Mudança de save limpa o leaderboard do servidor; reinício/reload no mesmo save mantém as estatísticas.
- No primeiro contato com o plugin novo, o mapa atual é registrado sem apagar dados. A partir do próximo mapa, o reset automático funciona também quando o wipe é feito fora do painel. Para corrigir dados antigos imediatamente, usar o reset no painel após o deploy, no servidor selecionado.
- Wipes executados pelo painel limpam o leaderboard antes de iniciar o servidor, evitando apagar atividade nova depois da abertura.

## Plugins

`scripts/package-rust-competitive.py --output CAMINHO` gera pacotes separados Duo/Trio, com dois `.cs`, instruções e hashes SHA-256. Mantém os nomes dos plugins e preserva os demais valores/segredo da configuração. Cada pacote fixa a origem correta da Season; o leaderboard identifica a origem nos eventos. Não instalar os dois pacotes no mesmo servidor.

Fazer deploy do site/bot antes de substituir/recarregar os plugins. Não é necessário apagar a configuração ou os dados da Season. A instalação em produção não foi realizada nesta alteração.

## Validação

Testes SQL/HTTP verificam reset completo, cache, isolamento Duo/Trio, eventos atrasados, mapa novo versus reinício e preservação da Season. Testes DOM verificam avatar/nome/menu em todas as seções. Testes de respostas verificam concorrência, replay, nova tentativa após falha e anúncios ignorados. O CI compila o leaderboard original e as variantes Duo/Trio contra adaptadores de API e testa o protocolo de eventos. Isso não substitui compilar/carregar no Carbon/Rust real. O plugin grande da Season foi alterado apenas na identificação de origem do pacote e não foi compilado contra assemblies do Rust neste ambiente.
