export const storeProductDetails=String.raw`
(function(){
  const root=document.getElementById('productModal'),items=document.getElementById('kitContents');let product=null,requestVersion=0,priceVersion=0;
  const duration=s=>!s?'Sem espera':s>=86400?(s/86400).toLocaleString('pt-BR')+' dias':s>=3600?(s/3600).toLocaleString('pt-BR')+' horas':Math.ceil(s/60)+' minutos';
  const selectedServer=()=>document.getElementById('serverSolo').classList.contains('active')?'solo-duo':document.getElementById('serverTrio').classList.contains('active')?'trio':null;
  function resetServerChoice(){
    document.getElementById('serverSolo').classList.remove('active');document.getElementById('serverTrio').classList.remove('active');
    document.getElementById('detailPrice').textContent='Selecione um servidor para ver o preço';
    document.getElementById('serverInfo').textContent='Selecione um servidor para ver o preço deste pacote.';
    document.getElementById('trioLock').hidden=true;
    document.getElementById('detailBuy').disabled=true;document.getElementById('detailGift').disabled=true;
    if(product)delete product.price;
    items.replaceChildren();const hint=document.createElement('p');hint.className='kitLoading';hint.textContent='Selecione um servidor para consultar os itens.';items.append(hint);
  }
  function refreshComboCopy(){
    const server=selectedServer();
    if(!product||product.tier!=='duo')return;
    if(!server){document.getElementById('detailName').textContent='Super Combo';document.getElementById('detailNote').textContent='Selecione o servidor. No Solo/Duo o combo atende você + 1 amigo; no Trio ele atende você + 2 amigos.';return;}
    const trio=server==='trio';
    document.getElementById('detailName').textContent=trio?'Super Combo Trio':'Super Combo Duo';
    document.getElementById('detailNote').textContent=trio
      ?'Inclui Bronze + Prata + Ouro para você e os outros 2 jogadores do trio. Uma compra gera 2 links de presente, um para cada companheiro. Vendas bloqueadas até o lançamento do Trio.'
      :'Inclui Bronze + Prata + Ouro para você e seu duo. Após pagar, envie o link exclusivo de resgate ao seu amigo.';
  }
  async function refreshPrice(){
    if(!product)return;const server=selectedServer(),price=document.getElementById('detailPrice'),buy=document.getElementById('detailBuy'),gift=document.getElementById('detailGift');
    priceVersion++;buy.disabled=true;gift.disabled=true;if(product)delete product.price;
    document.getElementById('trioLock').hidden=server!=='trio';
    if(!server){price.textContent='Selecione um servidor para ver o preço';return;}
    const seq=priceVersion;price.textContent='Consultando preço…';
    try{
      const r=await fetch('/api/store/price/'+product.tier+'?server='+server,{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(seq!==priceVersion)return;
      if(typeof d.price!=='number'||!Number.isFinite(d.price)||d.price<=0){price.textContent=server==='trio'?'Preço será divulgado no lançamento':'Preço temporariamente indisponível';document.getElementById('serverInfo').textContent=server==='trio'?'O Guerra Fria Trio ainda não foi lançado. As compras continuam bloqueadas.':'O preço deste pacote ainda não está configurado para o servidor escolhido.';return;}
      product.price=String(d.price);price.textContent=d.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' / 30 dias';
      document.getElementById('serverInfo').textContent=d.purchasable?'Compras liberadas para '+d.serverName+'.':d.serverName+' ainda não está disponível para compras.';
      buy.disabled=!d.purchasable;gift.disabled=!d.purchasable||product.tier==='duo';
    }catch{if(seq!==priceVersion)return;price.textContent='Não foi possível consultar o preço agora';document.getElementById('serverInfo').textContent='Tente selecionar o servidor novamente.';}
  }
  async function loadKits(){if(!product)return;const server=selectedServer();if(!server){items.replaceChildren();const hint=document.createElement('p');hint.className='kitLoading';hint.textContent='Selecione um servidor para consultar os itens.';items.append(hint);return;}const seq=++requestVersion,tier=product.tier;items.replaceChildren();const loading=document.createElement('p');loading.className='kitLoading';loading.textContent='Consultando os itens do servidor…';items.append(loading);
    try{const r=await fetch('/api/store/catalog/'+tier+'?server='+server,{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(seq!==requestVersion)return;items.replaceChildren();
      if(!d.available||!d.complete||d.stale){const warning=document.createElement('p');warning.className='kitNotice';warning.textContent=!d.available?(d.message||'Itens temporariamente indisponíveis.'):d.stale?'Exibindo a última lista confirmada. A conexão com o servidor está sendo atualizada.':'Alguns kits ainda estão sendo sincronizados. Abaixo estão os itens já confirmados.';items.append(warning);}
      for(const kit of d.kits||[]){const title=document.createElement('div');title.className='kitHeader';const name=document.createElement('b');name.textContent=kit.name;const time=document.createElement('small');time.textContent='Resgate: '+duration(kit.cooldownSeconds)+(kit.wipeDelaySeconds?' • Após wipe: '+duration(kit.wipeDelaySeconds):'');title.append(name,time);items.append(title);const grid=document.createElement('div');grid.className='kitGrid';
        for(const item of kit.items){const tile=document.createElement('div');tile.className='kitItem';const img=document.createElement('img');img.src=item.icon;img.alt=item.name;img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{img.remove();};const quantity=document.createElement('span');quantity.className='quantity';quantity.textContent='×'+item.amount.toLocaleString('pt-BR');const label=document.createElement('b');label.textContent=item.name;tile.append(img,quantity,label);if(item.includedIn||item.loadedAmmo){const info=document.createElement('small');info.textContent=item.includedIn?'Acessório de '+item.includedIn:'Carregado: '+item.loadedAmmo+' × '+item.ammoType;tile.append(info);}if(item.skin&&item.skin!=='0'){const skin=document.createElement('small');skin.textContent='Skin '+item.skin;tile.append(skin);}grid.append(tile);}items.append(grid);
      }
      if(d.updatedAt){const stamp=document.createElement('p');stamp.className='kitSource';stamp.textContent='Itens do servidor • '+new Date(d.updatedAt).toLocaleString('pt-BR')+' • imagens dos itens base do Rust';items.append(stamp);}
    }catch{if(seq!==requestVersion)return;items.textContent=server==='trio'?'O servidor Trio ainda não foi lançado. Os itens ficarão disponíveis quando as vendas forem liberadas.':'Não foi possível consultar os itens agora. Reabra o pacote para tentar novamente.';}
  }
  document.querySelectorAll('.vipCard .buy').forEach(b=>b.onclick=()=>{product={...b.dataset};document.getElementById('detailName').textContent=product.name;document.getElementById('detailArt').src='/api/store/art/vip-'+product.tier;document.getElementById('detailArt').alt=product.name;document.getElementById('detailGift').hidden=product.tier==='duo';document.getElementById('detailNote').textContent=product.tier==='duo'?'Selecione o servidor para definir o tamanho do Super Combo e ver o preço.':'Selecione o servidor para ver o preço deste VIP. Você também pode comprar para sua conta ou presentear um amigo.';resetServerChoice();refreshComboCopy();root.classList.add('open');});
  const close=()=>{root.classList.remove('open');requestVersion++;priceVersion++;};document.getElementById('productClose').onclick=close;root.onclick=e=>{if(e.target===root)close()};document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  document.getElementById('detailBuy').onclick=()=>{const server=selectedServer();if(!product||!server||!product.price)return;const detail={...product,name:product.tier==='duo'?(server==='trio'?'Super Combo Trio':'Super Combo Duo'):product.name,gift:false};close();document.dispatchEvent(new CustomEvent('gf:checkout',{detail}));};
  document.getElementById('detailGift').onclick=()=>{const server=selectedServer();if(!product||!server||!product.price)return;const detail={...product,gift:true};close();document.dispatchEvent(new CustomEvent('gf:checkout',{detail}));};
  document.addEventListener('gf:server',()=>{refreshComboCopy();refreshPrice();loadKits();});
  async function gifts(){try{const r=await fetch('/api/store/gift/purchases',{cache:'no-store'});if(!r.ok)return;const rows=await r.json(),container=document.getElementById('giftPurchases');container.replaceChildren();if(!rows.length){container.textContent='Seus presentes e links aparecerão aqui após o pagamento.';return;}const labels={available:'Pronto para enviar',delivering:'Amigo ativando o VIP',redeemed:'Presente resgatado',expired:'Link expirado'};for(const row of rows){const box=document.createElement('div');box.className='purchase';const name=document.createElement('p');name.textContent=row.product+' • Compra #'+row.id+' • '+(labels[row.status]||'Aguardando pagamento');box.append(name);if(row.claimUrl){const input=document.createElement('input');input.value=row.claimUrl;input.readOnly=true;input.setAttribute('aria-label','Link do presente');const button=document.createElement('button');button.textContent='COPIAR PRESENTE';button.onclick=async()=>{try{await navigator.clipboard.writeText(row.claimUrl);button.textContent='COPIADO ✓'}catch{input.select();}};box.append(button,input);}container.append(box);}}catch{}}
  gifts();setInterval(gifts,10000);
})();`;
