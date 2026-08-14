export const memberPickerV2Js = `
(function(){
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  async function fetchMembers(q){var r=await fetch('/api/admin/discord/members?q='+encodeURIComponent(q||''));var j={};try{j=await r.json()}catch(_e){}if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j.members||[]}
  function enhance(input){
    if(!input||input.dataset.memberPickerV2==='1')return;
    input.dataset.memberPickerV2='1'; input.type='hidden';
    var host=document.createElement('div');host.style.cssText='position:relative;margin-top:8px';
    var search=document.createElement('input');search.type='text';search.placeholder='Digite o nome do membro do Discord...';search.autocomplete='off';
    var selected=document.createElement('div');selected.style.cssText='display:none;margin-top:8px;padding:10px;border:1px solid #285c3a;background:#0b2113;border-radius:10px;color:#8ff0ad';
    var results=document.createElement('div');results.style.cssText='display:none;position:absolute;left:0;right:0;top:48px;z-index:100000;background:#0d0914;border:1px solid #49336c;border-radius:12px;max-height:290px;overflow:auto;box-shadow:0 18px 45px #000a';
    var manual=document.createElement('button');manual.type='button';manual.textContent='Digitar ID manualmente';manual.className='btn';manual.style.cssText='margin-top:8px;font-size:11px;padding:7px 9px';
    host.appendChild(search);host.appendChild(results);host.appendChild(selected);host.appendChild(manual);input.parentNode.insertBefore(host,input);
    var timer=null;
    function choose(m){input.value=m.id;search.value=m.displayName||m.username;selected.innerHTML='<b>'+esc(m.displayName||m.username)+'</b><small style="display:block;color:#84c997">@'+esc(m.username)+'</small>';selected.style.display='block';results.style.display='none'}
    function render(rows){results.innerHTML=(rows.length?rows.map(function(m){return '<button type="button" data-id="'+esc(m.id)+'" style="width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:11px;background:transparent;border:0;border-bottom:1px solid #21182d;color:#fff"><img src="'+esc(m.avatar||'')+'" width="36" height="36" style="border-radius:50%"><span><b>'+esc(m.displayName||m.username)+'</b><small style="display:block;color:#8f849b">@'+esc(m.username)+'</small></span></button>'}).join(''):'<div style="padding:12px;color:#9b8ba9">Nenhum membro encontrado.</div>');results.style.display='block';Array.from(results.querySelectorAll('[data-id]')).forEach(function(btn){btn.onclick=function(){var id=btn.getAttribute('data-id');var m=rows.find(function(x){return x.id===id});if(m)choose(m)}})}
    async function run(){try{render(await fetchMembers(search.value.trim()))}catch(err){results.innerHTML='<div style="padding:12px;color:#fca5a5">'+esc(err.message)+'</div>';results.style.display='block'}}
    search.addEventListener('focus',run);search.addEventListener('input',function(){input.value='';selected.style.display='none';clearTimeout(timer);timer=setTimeout(run,180)});
    manual.onclick=function(){var id=prompt('Digite o Discord ID do membro:');if(id&&/^\\d{10,25}$/.test(id.trim())){input.value=id.trim();search.value='ID manual';selected.textContent='ID manual: '+id.trim();selected.style.display='block'}else if(id){alert('Discord ID inválido.')}};
    document.addEventListener('click',function(ev){if(!host.contains(ev.target))results.style.display='none'});
  }
  function scan(){enhance(document.getElementById('gfDiscordVerify'));enhance(document.getElementById('verifyDiscord'))}
  scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
`;
