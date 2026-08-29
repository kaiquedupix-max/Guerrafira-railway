export const panelModerationParityJs = String.raw`
(function(){'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
    try{state=await api('/api/admin/player-state/'+encodeURIComponent(steamId));}catch{return;}

    const banBtn=document.getElementById('actBan');
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
          if(!confirm('Aplicar BANIMENTO PREVENTIVO neste jogador?\n\nEle ficará bloqueado até abrir um ticket e passar por verificação.'))return;
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
      card.innerHTML='<b style="color:'+(preventive?'#ffd27a':'#ff9a9a')+'">'+title+'</b><small>Motivo: '+esc(state.ban.reason||'Não informado')+'</small><small>Duração: '+esc(duration)+(state.ban.adminName?' • Aplicado por '+esc(state.ban.adminName):'')+'</small>'+next;
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
        if(!reason)return toast('Informe o motivo do desbanimento.',true);
        if(!confirm('Remover o banimento deste jogador?'))return;
        banBtn.disabled=true;banBtn.textContent='Desbanindo...';
        try{
          await post('/api/admin/moderation/unban',{steamId,reason});
          toast(preventive?'Banimento preventivo removido com sucesso.':'Jogador desbanido com sucesso.');
          document.getElementById('closeDrawer')?.click();
        }catch(e){toast(e.message||'Erro ao desbanir.',true);banBtn.disabled=false;banBtn.textContent='✅ Desbanir';}
      };
    }
  }

  const host=document.getElementById('drawerHost');
  if(host){new MutationObserver(()=>queueMicrotask(enhanceDrawer)).observe(host,{childList:true,subtree:true});}
})();`;
