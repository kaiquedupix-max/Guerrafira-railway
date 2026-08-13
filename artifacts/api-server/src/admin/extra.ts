export const adminExtraJs = `
(function(){
  function e(id){return document.getElementById(id)}
  function addFinance(box){
    if(!box||box.querySelector('[data-finance-link]'))return;
    const b=document.createElement('button');
    b.textContent='Financeiro';
    b.dataset.financeLink='1';
    b.onclick=function(){window.location.href='/api/finance/revenue-view?days=30'};
    box.appendChild(b);
  }
  setTimeout(function(){addFinance(e('nav'));addFinance(e('mobileNav'))},150);

  const old=window.selectPlayer;
  if(typeof old==='function'){
    window.selectPlayer=function(id,name){window.gfPlayer={steamId:id,name:name};return old(id,name)};
  }
  const players=e('players');
  if(players){
    const box=document.createElement('div'); box.className='section';
    box.innerHTML='<div class="sectionHead"><h2>🛡️ Verificação de jogador</h2><span>Discord + grupo vr</span></div><div class="body"><div class="form"><p class="hint">Selecione o jogador acima e informe o Discord ID.</p><div class="field"><label>Discord ID</label><input id="verifyDiscord"></div><button class="btn green" id="verifyBtn">Verificar jogador</button></div></div>';
    players.appendChild(box);
    e('verifyBtn').onclick=function(){const p=window.gfPlayer;if(!p)return toast('Selecione um jogador primeiro.',true);const d=e('verifyDiscord').value.trim();if(!d)return toast('Informe o Discord ID.',true);post('/api/admin/moderation/verify',{steamId:p.steamId,discordUserId:d},'Confirmar verificação de '+p.name+'?')};
  }
})();
`;
