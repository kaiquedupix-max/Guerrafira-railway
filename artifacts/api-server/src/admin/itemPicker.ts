export const itemPickerJs = `
(function(){
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  async function fetchItems(q){var r=await fetch('/api/admin/server/items?q='+encodeURIComponent(q||''));var j={};try{j=await r.json()}catch(_e){}if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j.items||[]}
  function enhance(input){
    if(!input||input.dataset.itemPicker==='1')return;
    input.dataset.itemPicker='1';input.type='hidden';
    var host=document.createElement('div');host.style.cssText='position:relative';
    var search=document.createElement('input');search.type='text';search.placeholder='Digite o nome do item...';search.autocomplete='off';search.spellcheck=false;
    var chosen=document.createElement('div');chosen.style.cssText='display:none;margin-top:8px;padding:9px 10px;border:1px solid #5b4b1f;background:#211b08;border-radius:10px;color:#ffe37c';
    var results=document.createElement('div');results.style.cssText='display:none;position:absolute;left:0;right:0;top:48px;z-index:100000;background:#0d0914;border:1px solid #49336c;border-radius:12px;max-height:300px;overflow:auto;box-shadow:0 18px 45px #000a';
    host.appendChild(search);host.appendChild(results);host.appendChild(chosen);input.parentNode.insertBefore(host,input);
    var timer=null;
    function choose(item){input.value=item.shortname;search.value=item.name;chosen.innerHTML='<b>'+esc(item.name)+'</b><small style="display:block;color:#b8a96f">'+esc(item.shortname)+(item.category?' • '+esc(item.category):'')+'</small>';chosen.style.display='block';results.style.display='none'}
    function render(rows){results.innerHTML=(rows.length?rows.map(function(x){return '<button type="button" data-short="'+esc(x.shortname)+'" style="width:100%;display:block;text-align:left;padding:11px 12px;background:transparent;border:0;border-bottom:1px solid #21182d;color:#fff"><b>'+esc(x.name)+'</b><small style="display:block;color:#8f849b">'+esc(x.shortname)+(x.category?' • '+esc(x.category):'')+'</small></button>'}).join(''):'<div style="padding:12px;color:#9b8ba9">Nenhum item encontrado.</div>');results.style.display='block';Array.from(results.querySelectorAll('[data-short]')).forEach(function(btn){btn.onclick=function(){var s=btn.getAttribute('data-short');var item=rows.find(function(x){return x.shortname===s});if(item)choose(item)}})}
    async function run(){try{render(await fetchItems(search.value.trim()))}catch(err){results.innerHTML='<div style="padding:12px;color:#fca5a5">'+esc(err.message)+'</div>';results.style.display='block'}}
    search.addEventListener('focus',run);search.addEventListener('input',function(){input.value='';chosen.style.display='none';clearTimeout(timer);timer=setTimeout(run,160)});
    document.addEventListener('click',function(ev){if(!host.contains(ev.target))results.style.display='none'});
  }
  function scan(){enhance(document.getElementById('gfItem'));enhance(document.getElementById('giveItem'))}
  scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
`;
