export const panelSlotControlJs = String.raw`
(function(){
  const $=id=>document.getElementById(id);
  function toastLocal(msg,bad){const t=$('toast');if(!t){alert(msg);return}t.textContent=msg;t.classList.remove('hidden');t.style.borderColor=bad?'#943540':'#60428b';clearTimeout(t._slotTimer);t._slotTimer=setTimeout(()=>t.classList.add('hidden'),3200)}
  async function request(url,opt){const r=await fetch(url,opt||{});let j={};try{j=await r.json()}catch{}if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j}

  let mode='automatic',editing=false,saving=false;

  function createPage(){
    const main=document.querySelector('.main');if(!main||$('slotsAdmin'))return;
    const sec=document.createElement('section');sec.id='slotsAdmin';sec.className='view';
    sec.innerHTML='<div class="section"><div class="sectionHead"><div><h2>🎛️ Gerenciamento de Slots</h2><div class="subtitle">Defina como o Guerra Fria controla a capacidade do servidor.</div></div><span id="slotModeBadge" class="badge green">Carregando...</span></div><div class="body">'+
      '<div class="segmented" style="margin-bottom:14px"><button id="slotModeAuto" type="button">⚡ Automático</button><button id="slotModeManual" type="button">✋ Manual</button></div>'+
      '<div id="slotAutoFields"><div class="stateCard" style="margin-bottom:12px"><b>Modo automático</b><small>O bot controla os slots de acordo com população e fila, mas você escolhe exatamente o mínimo e o máximo permitidos.</small></div><div class="grid2"><div class="field"><label>Mínimo de slots</label><input id="slotMin" type="number" min="1" max="1000" step="1" inputmode="numeric"><div class="subtitle">De 1 a 1.000. O sistema nunca reduz abaixo deste limite.</div></div><div class="field"><label>Máximo de slots</label><input id="slotMax" type="number" min="1" max="1000" step="1" inputmode="numeric"><div class="subtitle">De 1 a 1.000. O sistema nunca aumenta acima deste limite.</div></div></div></div>'+
      '<div id="slotManualFields" class="hidden"><div class="stateCard" style="margin-bottom:12px"><b>Modo manual</b><small>Você assume o controle e escolhe uma quantidade fixa de slots.</small></div><div class="field"><label>Slots fixos</label><input id="slotManual" type="number" min="1" max="1000" step="1" inputmode="numeric"><div class="subtitle">Por segurança, não pode ser menor que a quantidade de jogadores online.</div></div></div>'+
      '<div class="cards" style="margin-top:14px"><div class="card"><small>Capacidade atual</small><strong id="slotCurrent">—</strong></div><div class="card"><small>Jogadores online</small><strong id="slotPlayers">—</strong></div><div class="card"><small>Fila</small><strong id="slotQueue">—</strong></div><div class="card accent"><small>Faixa configurada</small><strong id="slotRange">—</strong></div></div>'+
      '<div class="stateCard" style="margin:14px 0"><b id="slotStatusTitle">Status do controle</b><small id="slotStatusText">Carregando configuração...</small></div>'+
      '<button id="slotSave" type="button" class="btn yellow" style="width:100%">Salvar configuração de slots</button><div class="subtitle" style="text-align:center;margin-top:10px">Guerra Fria • Desenvolvido por Maciota</div></div></div>';
    main.appendChild(sec);
    $('slotModeAuto')?.addEventListener('click',()=>{editing=true;setMode('automatic')});
    $('slotModeManual')?.addEventListener('click',()=>{editing=true;setMode('manual')});
    $('slotSave')?.addEventListener('click',save);
    for(const id of ['slotMin','slotMax','slotManual'])$(id)?.addEventListener('input',()=>{editing=true});
    $('slotMin')?.addEventListener('input',()=>{const min=Number($('slotMin')?.value),max=Number($('slotMax')?.value);if(Number.isFinite(min)&&Number.isFinite(max)&&min>max)$('slotMax').value=String(min)});
  }

  function ensureNav(){
    for(const id of ['nav','mobileNav']){
      const box=$(id);if(!box||box.querySelector('[data-slot-control]'))continue;
      const b=document.createElement('button');b.type='button';b.textContent='Slots';b.dataset.slotControl='1';b.dataset.view='slotsAdmin';b.onclick=openPage;box.appendChild(b);
    }
  }

  function openPage(){
    createPage();ensureNav();
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    $('slotsAdmin')?.classList.add('active');
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='slotsAdmin'));
    if($('pageTitle'))$('pageTitle').textContent='Gerenciamento de Slots';
    load();
  }

  function setMode(next){
    mode=next==='manual'?'manual':'automatic';
    $('slotModeAuto')?.classList.toggle('active',mode==='automatic');
    $('slotModeManual')?.classList.toggle('active',mode==='manual');
    $('slotAutoFields')?.classList.toggle('hidden',mode!=='automatic');
    $('slotManualFields')?.classList.toggle('hidden',mode!=='manual');
    if($('slotModeBadge')){$('slotModeBadge').textContent=mode==='automatic'?'AUTOMÁTICO':'MANUAL';$('slotModeBadge').className='badge '+(mode==='automatic'?'green':'yellow')}
  }

  async function load(){
    try{
      const d=await request('/api/admin/server/slot-control',{cache:'no-store'}),s=d.settings||{},i=d.info||{};
      if(!editing&&!saving){
        if($('slotMin'))$('slotMin').value=String(s.minSlots??100);
        if($('slotMax'))$('slotMax').value=String(s.maxSlots??250);
        if($('slotManual'))$('slotManual').value=String(s.manualSlots??s.minSlots??100);
        setMode(s.mode);
      }
      const current=Number(i.maxPlayers||s.currentSlots||0),players=Number(i.players||0),queue=Number(i.queued||0);
      if($('slotCurrent'))$('slotCurrent').textContent=current||'—';
      if($('slotPlayers'))$('slotPlayers').textContent=String(players);
      if($('slotQueue'))$('slotQueue').textContent=String(queue);
      if($('slotRange'))$('slotRange').textContent=s.minSlots+'–'+s.maxSlots;
      if($('slotStatusTitle'))$('slotStatusTitle').textContent=mode==='automatic'?'Controle automático ativo':'Controle manual ativo';
      if($('slotStatusText'))$('slotStatusText').textContent=mode==='automatic'?'O bot pode variar automaticamente entre '+s.minSlots+' e '+s.maxSlots+' slots.':'O servidor está configurado para manter '+s.manualSlots+' slots.';
    }catch(e){toastLocal(e.message,true)}
  }

  async function save(){
    const minSlots=Number($('slotMin')?.value),maxSlots=Number($('slotMax')?.value),manualSlots=Number($('slotManual')?.value);
    if(!Number.isFinite(minSlots)||!Number.isFinite(maxSlots)||minSlots<1||maxSlots<minSlots)return toastLocal('Confira o mínimo e o máximo de slots.',true);
    if(mode==='manual'&&(!Number.isFinite(manualSlots)||manualSlots<1))return toastLocal('Informe a quantidade manual de slots.',true);
    const btn=$('slotSave');saving=true;if(btn){btn.disabled=true;btn.textContent='Salvando...'}
    try{
      const d=await request('/api/admin/server/slot-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,minSlots,maxSlots,manualSlots})});
      toastLocal(mode==='automatic'?'Automático configurado entre '+minSlots+' e '+maxSlots+' slots.':'Controle manual aplicado em '+manualSlots+' slots.');
      editing=false;saving=false;await load();if(!d.applied)toastLocal('Configuração salva, mas o RCON ainda não confirmou a alteração.',true);
    }catch(e){toastLocal(e.message,true)}finally{saving=false;if(btn){btn.disabled=false;btn.textContent='Salvar configuração de slots'}}
  }

  function boot(){
    createPage();ensureNav();
    const card=$('ovSlots')?.closest('.card');if(card){card.classList.add('click');card.style.cursor='pointer';card.onclick=openPage;}
    setInterval(()=>{ensureNav();if($('slotsAdmin')?.classList.contains('active'))load()},5000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
`;
