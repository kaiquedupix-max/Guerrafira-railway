# Correção da carga inicial da Visão Geral

O painel tentava registrar eventos em controles que já tinham sido removidos por outras partes da interface. O caso reproduzido foi o botão do antigo formulário de anúncio; usuários sem acesso financeiro também podiam perder os controles financeiros antes da conclusão da autenticação. A exceção interrompia a inicialização antes de carregar os cartões da Visão Geral e iniciar a atualização periódica. O recuperador de autenticação mostrava o painel mesmo assim, deixando os cartões vazios. Ao navegar de volta para Visão Geral, o carregamento finalmente era chamado.

A inicialização agora tolera a ausência desses controles opcionais, abre Visão Geral pelo fluxo normal de navegação e evita inicializações simultâneas. A recuperação de autenticação retoma a inicialização completa, e voltar à página visível solicita atualização dos dados.

Testes reproduziram o cartão vazio antes da correção e agora verificam os cartões completos na primeira abertura, sem qualquer clique em Jogadores. Cobrem Duo, Trio, autenticação demorada, controles removidos, atualização automática e recuperação de autenticação. A mudança é no código do painel; sua ativação em produção depende do deploy do site no Coolify.
