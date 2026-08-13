export const adminExtraJs = `
(function(){
  function e(id){return document.getElementById(id)}
  const players = e('players');
  if(!players) return;
  const box = document.createElement('div');
  box.className='section';
  box.innerHTML='<div class="sectionHead"><h2>🛡️ Verificação de jogador</h2><span>Discord + grupo vr no Rust</span></div><div class="body"><div class="form"><h3>Marcar jogador como verificado</h3><p class="hint">Selecione o jogador na tabela acima e informe o Discord ID do membro. Jogadores verificados deixam de gerar alertas do anti-cheat próprio.</p><div class="field"><label>Discord ID do jogador</label><input id="verifyDiscord" placeholder="ID do membro no Discord"></div><div class="rowBtns"><button class="btn green" id="verifyBtn">Verificar jogador</button></div></div></div>';
  players.appendChild(box);
  e('verifyBtn').onclick=function(){
    if(!window.selected){ toast('Selecione um jogador primeiro.',true); return; }
    const discordUserId=e('verifyDiscord').value.trim();
    if(!discordUserId){ toast('Informe o Discord ID do jogador.',true); return; }
    post('/api/admin/moderation/verify',{steamId:window.selected.steamId,discordUserId:discordUserId},'Confirmar verificação de '+window.selected.name+'?');
  };
})();
`;
