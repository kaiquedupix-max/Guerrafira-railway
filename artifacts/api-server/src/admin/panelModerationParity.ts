export const panelModerationParityJs = String.raw`
(function(){'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const linkify = v => esc(v).replace(/(https:\/\/[^\s&<]+)/g,'<a href="$1" target="_blank" rel="noopener" style="color:#72e6ca;text-decoration:underline">Abrir provas</a>');
  const toast = (msg,bad=false) => {
    const t=document.getElementById('toast');
    if(!t)return;
    t.textContent=msg;t.classList.remove('hidden');
    t.style.borderColor=bad?'#943540':'#60428b';
    clearTimeout(t._parityTimer);t._parityTimer=setTimeout(()=>t.classList.add('hidden'),3500);
  };
  async function api(url,opt){
    const r=await fetch(url,opt||{});let j={};try{j=await r.json()}catch{}
    if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j;
  }
  async function post(url,data){return api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});}

  async function enhanceDrawer(){
    const host=document.getElementById('drawerHost');
    const drawer=host?.querySelector('.drawer');
    if(!drawer || drawer.dataset.moderationParity==='1')return;
    drawer.dataset.moderationParity='1';
    const steamNode=drawer.querySelector('.mono.subtitle');
    const steamId=(steamNode?.textContent||'').trim();
    if(!/^7656119\d{10}$/.test(steamId))return;

    let state;
    try{state=drawer.gfPlayerState||await api('/api/admin/player-state/'+encodeURIComponent(steamId));}catch{drawer.dataset.moderationParity='';return;}

    if (!drawer.isConnected || host.querySelector('.drawer') !== drawer) return;
    const banBtn=drawer.querySelector('#actBan');
    const muteBox=document.createElement('div');
    muteBox.className='stateCard';
    muteBox.style.marginTop='14px';
    muteBox.innerHTML='<b>Chat do jogo</b><small>'+(state.muted?'Silenciado até '+new Date(state.muteExpiresAt).toLocaleString('pt-BR'):'Sem mute ativo')+'</small><label for="muteDuration">Duração do mute</label><select id="muteDuration"></select><button id="actMute" type="button" class="btn">Silenciar jogador</button><button id="actUnmute" type="button" class="btn green">Remover mute</button>';
    drawer.querySelector('.actionGrid')?.after(muteBox);
    api('/api/admin/moderation/mute-durations').then(data=>{if(!muteBox.isConnected)return;for(const duration of data.durations||[]){const option=document.createElement('option');option.value=duration.value;option.textContent=duration.name;muteBox.querySelector('select').appendChild(option);}}).catch(error=>toast(error.message,true));
    for(const muted of [true,false]){
      const button=muteBox.querySelector(muted?'#actMute':'#actUnmute');
      button.onclick=async()=>{
        const reason=(drawer.querySelector('#actReason')?.value||'').trim();
        if(muted&&!reason)return toast('Informe o motivo do mute.',true);
        if(muted&&!muteBox.querySelector('select').value)return toast('Aguarde o carregamento dos prazos.',true);
        button.disabled=true;
        try{await post('/api/admin/moderation/'+(muted?'mute':'unmute'),{steamId,reason,duration:muteBox.querySelector('select').value});toast(muted?'Mute confirmado pelo servidor.':'Mute removido.');if(drawer.isConnected)drawer.querySelector('#closeDrawer')?.click();}catch(error){toast(error.message,true);}finally{button.disabled=false;}
      };
    }
    if(!state?.banned){
      if(banBtn && !document.getElementById('actPreventiveBan')){
        const preventiveBtn=document.createElement('button');
        preventiveBtn.id='actPreventiveBan';
        preventiveBtn.type='button';
        preventiveBtn.className='btn yellow';
        preventiveBtn.style.cssText='background:#4a3510;border-color:#b7791f;color:#ffe7a3';
        preventiveBtn.textContent='🛡️ Banimento preventivo';
        banBtn.insertAdjacentElement('afterend',preventiveBtn);
        preventiveBtn.onclick=async()=>{
          const reason=(document.getElementById('actReason')?.value||'').trim();
          if(!reason)return toast('Informe o motivo do banimento preventivo.',true);
          if(!confirm('Aplicar BANIMENTO PREVENTIVO neste jogador no Duo e no Trio?\n\nEle ficará bloqueado até abrir um ticket e passar por verificação.'))return;
          preventiveBtn.disabled=true;preventiveBtn.textContent='Aplicando preventivo...';
          try{
            await post('/api/admin/moderation/preventive-ban',{steamId,reason});
            toast('Banimento preventivo aplicado. O jogador foi orientado a abrir ticket para verificação.');
            document.getElementById('closeDrawer')?.click();
          }catch(e){toast(e.message||'Erro ao aplicar banimento preventivo.',true);preventiveBtn.disabled=false;preventiveBtn.textContent='🛡️ Banimento preventivo';}
        };
      }
      return;
    }

    const reasonInput=drawer.querySelector('#actReason');if(reasonInput)reasonInput.placeholder='Motivo do desbanimento (opcional)';
    const preventive=Boolean(state.preventiveBan || state.ban?.type==='preventive');
    const toolbar=drawer.querySelector('.toolbar');
    if(toolbar){
      const badge=document.createElement('span');
      badge.className='badge';
      badge.style.cssText=preventive
        ?'background:rgba(245,158,11,.16);border-color:rgba(245,158,11,.45);color:#ffd27a'
        :'background:rgba(239,68,68,.16);border-color:rgba(239,68,68,.45);color:#ff8a8a';
      badge.textContent=preventive?'🛡️ Preventivo':'🔨 Banido';
      toolbar.appendChild(badge);
    }

    if(state.ban){
      const card=document.createElement('div');
      card.className='stateCard';
      card.style.cssText=preventive
        ?'margin:14px 0;border-color:rgba(245,158,11,.38);background:linear-gradient(135deg,rgba(120,72,10,.20),rgba(30,18,10,.75))'
        :'margin:14px 0;border-color:rgba(239,68,68,.38);background:linear-gradient(135deg,rgba(127,29,29,.18),rgba(30,12,34,.75))';
      const duration=state.ban.duration==='perm'?'Permanente':(state.ban.duration||'Não informado');
      const title=preventive?'Banimento preventivo ativo':'Banimento ativo';
      const next=preventive?'<small>Para liberação: o jogador deve abrir um ticket em discord.gg/guerrafria e passar por VERIFICAÇÃO.</small>':'';
      card.innerHTML='<b style="color:'+(preventive?'#ffd27a':'#ff9a9a')+'">'+title+'</b><small>Motivo: '+linkify(state.ban.reason||'Não informado')+'</small><small>Duração: '+esc(duration)+(state.ban.adminName?' • Aplicado por '+esc(state.ban.adminName):'')+'</small>'+next;
      const field=drawer.querySelector('.field');
      if(field)field.parentElement?.insertBefore(card,field);
    }

    const durationField=document.getElementById('banDuration')?.closest('.field');
    if(durationField)durationField.style.display='none';

    if(banBtn){
      banBtn.textContent='✅ Desbanir';
      banBtn.classList.remove('red');
      banBtn.classList.add('green');
      banBtn.style.cssText='background:#123b28;border-color:#218a53;color:#caffdf';
      banBtn.onclick=async()=>{
        const reason=(document.getElementById('actReason')?.value||'').trim();
        if(!confirm('Remover o banimento deste jogador no Duo e no Trio?'))return;
        banBtn.disabled=true;banBtn.textContent='Desbanindo...';
        try{
          await post('/api/admin/moderation/unban',{steamId,reason});

          document.getElementById('closeDrawer')?.click();
        }catch(e){toast(e.message||'Erro ao desbanir.',true);banBtn.disabled=false;banBtn.textContent='✅ Desbanir';}
      };
    }
  }

  const host=document.getElementById('drawerHost');
  if(host){new MutationObserver(()=>queueMicrotask(enhanceDrawer)).observe(host,{childList:true,subtree:true});}
})();`;
