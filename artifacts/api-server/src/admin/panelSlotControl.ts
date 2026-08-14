export const panelSlotControlJs = String.raw`
(function(){
  const $=id=>document.getElementById(id);
  function toastLocal(msg,bad){
    const t=$('toast');
    if(!t){alert(msg);return;}
    t.textContent=msg;t.classList.remove('hidden');t.style.borderColor=bad?'#943540':'#60428b';
    clearTimeout(t._slotTimer);t._slotTimer=setTimeout(()=>t.classList.add('hidden'),3200);
  }
  async function request(url,opt){
    const r=await fetch(url,opt||{});let j={};try{j=await r.json()}catch{}
    if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j;
  }
  function html(){
    const server=$('server');if(!server||$('slotControlSection'))return;
    const wrap=document.createElement('div');
    wrap.id='slotControlSection';wrap.className='section';
    wrap.innerHTML='<div class="sectionHead"><div><h2>Controle de slots</h2><div class="subtitle">Escolha entre controle automático do bot ou quantidade fixa definida por você.</div></div><span id="slotModeBadge" class="badge green">Carregando...</span></div>'+
    '<div class="body">'+
      '<div class="segmented" style="margin-bottom:14px"><button id="slotModeAuto" type="button">Automático</button><button id="slotModeManual" type="button">Manual</button></div>'+
      '<div id="slotAutoFields" class="grid2">'+
        '<div class="field"><label>Mínimo de slots</label><input id="slotMin" type="number" min="1" max="1000" step="1"></div>'+
        '<div class="field"><label>Máximo de slots</label><input id="slotMax" type="number" min="1" max="1000" step="1"></div>'+
      '</div>'+
      '<div id="slotManualFields" class="field hidden"><label>Slots fixos</label><input id="slotManual" type="number" min="1" max="1000" step="1"><div class="subtitle" style="margin-top:6px">O painel nunca permitirá definir menos slots do que jogadores online.</div></div>'+
      '<div class="stateCard" style="margin:12px 0"><b id="slotStatusTitle">Status</b><small id="slotStatusText">Carregando configuração...</small></div>'+
      '<button id="slotSave" type="button" class="btn yellow">Salvar controle de slots</button>'+
    '</div>';
    server.insertBefore(wrap,server.firstChild);
  }
  let mode='automatic';
  function setMode(next){
    mode=next==='manual'?'manual':'automatic';
    $('slotModeAuto')?.classList.toggle('active',mode==='automatic');
    $('slotModeManual')?.classList.toggle('active',mode==='manual');
    $('slotAutoFields')?.classList.toggle('hidden',mode!=='automatic');
    $('slotManualFields')?.classList.toggle('hidden',mode!=='manual');
    if($('slotModeBadge')){$('slotModeBadge').textContent=mode==='automatic'?'Automático':'Manual';$('slotModeBadge').className='badge '+(mode==='automatic'?'green':'yellow');}
  }
  async function load(){
    try{
      const d=await request('/api/admin/server/slot-control',{cache:'no-store'}),s=d.settings||{},i=d.info||{};
      if($('slotMin'))$('slotMin').value=String(s.minSlots??100);
      if($('slotMax'))$('slotMax').value=String(s.maxSlots??250);
      if($('slotManual'))$('slotManual').value=String(s.manualSlots??s.minSlots??100);
      setMode(s.mode);
      const current=Number(i.maxPlayers||s.currentSlots||0),players=Number(i.players||0),queue=Number(i.queued||0);
      if($('slotStatusTitle'))$('slotStatusTitle').textContent='Servidor agora: '+(current||'—')+' slots';
      if($('slotStatusText'))$('slotStatusText').textContent=mode==='automatic'
        ? 'Faixa automática: '+s.minSlots+'–'+s.maxSlots+' • '+players+' online • fila '+queue
        : 'Controle manual: '+s.manualSlots+' slots • '+players+' online';
    }catch(e){toastLocal(e.message,true)}
  }
  async function save(){
    const minSlots=Number($('slotMin')?.value),maxSlots=Number($('slotMax')?.value),manualSlots=Number($('slotManual')?.value);
    if(!Number.isFinite(minSlots)||!Number.isFinite(maxSlots)||minSlots<1||maxSlots<minSlots)return toastLocal('Confira o mínimo e o máximo de slots.',true);
    if(mode==='manual'&&(!Number.isFinite(manualSlots)||manualSlots<1))return toastLocal('Informe a quantidade manual de slots.',true);
    const btn=$('slotSave');if(btn){btn.disabled=true;btn.textContent='Salvando...';}
    try{
      const d=await request('/api/admin/server/slot-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,minSlots,maxSlots,manualSlots})});
      toastLocal(mode==='automatic'?'Controle automático ativado.':'Controle manual aplicado.');
      await load();
      if(!d.applied)toastLocal('Configuração salva, mas o RCON não confirmou a alteração imediatamente.',true);
    }catch(e){toastLocal(e.message,true)}finally{if(btn){btn.disabled=false;btn.textContent='Salvar controle de slots';}}
  }
  function boot(){
    html();
    $('slotModeAuto')?.addEventListener('click',()=>setMode('automatic'));
    $('slotModeManual')?.addEventListener('click',()=>setMode('manual'));
    $('slotSave')?.addEventListener('click',save);
    load();setInterval(()=>{if(document.getElementById('server')?.classList.contains('active'))load()},10000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
`;