export const memberPickerJs = `
(function(){
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  async function fetchMembers(q){
    var r=await fetch('/api/admin/discord/members?q='+encodeURIComponent(q||''));
    var j={};try{j=await r.json()}catch(_e){}
    if(!r.ok)throw new Error(j.error||('Erro '+r.status));
    return j.members||[];
  }
  function enhance(input){
    if(!input||input.dataset.memberPicker==='1')return;
    input.dataset.memberPicker='1';
    input.placeholder='Pesquise pelo nome ou digite o Discord ID';
    var host=document.createElement('div');host.style.cssText='position:relative;margin-top:8px';
    var search=document.createElement('input');search.type='text';search.placeholder='Buscar membro do Discord...';search.autocomplete='off';
    var results=document.createElement('div');results.style.cssText='display:none;position:absolute;left:0;right:0;top:48px;z-index:100000;background:#0d0914;border:1px solid #49336c;border-radius:12px;max-height:260px;overflow:auto;box-shadow:0 18px 45px #000a';
    host.appendChild(search);host.appendChild(results);input.parentNode.insertBefore(host,input);
    var timer=null;
    function render(rows){
      if(!rows.length){results.innerHTML='<div style="padding:12px;color:#9b8ba9">Nenhum membro encontrado. Você ainda pode digitar o ID manualmente abaixo.</div>';results.style.display='block';return;}
      results.innerHTML=rows.map(function(m){return '<button type="button" data-member-id="'+esc(m.id)+'" data-member-name="'+esc(m.displayName||m.username)+'" style="width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;background:transparent;border:0;border-bottom:1px solid #21182d;color:#fff"><img src="'+esc(m.avatar||'')+'" width="34" height="34" style="border-radius:50%"><span><b>'+esc(m.displayName||m.username)+'</b><small style="display:block;color:#8f849b">@'+esc(m.username)+' • '+esc(m.id)+'</small></span></button>'}).join('');
      results.style.display='block';
      Array.from(results.querySelectorAll('[data-member-id]')).forEach(function(btn){btn.onclick=function(){input.value=btn.dataset.memberId||'';search.value=btn.dataset.memberName||'';results.style.display='none'}});
    }
    async function run(){
      try{render(await fetchMembers(search.value.trim()))}catch(err){results.innerHTML='<div style="padding:12px;color:#fca5a5">'+esc(err.message)+'</div>';results.style.display='block'}
    }
    search.addEventListener('focus',run);
    search.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(run,220)});
    document.addEventListener('click',function(ev){if(!host.contains(ev.target))results.style.display='none'});
  }
  function scan(){enhance(document.getElementById('gfDiscordVerify'));enhance(document.getElementById('verifyDiscord'))}
  scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
`;
