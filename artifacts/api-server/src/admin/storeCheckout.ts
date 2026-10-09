/** Runs in the browser; card data is collected/tokenized only by the provider SDK. */
export const storeCheckoutScript = String.raw`
(function(){
  const el=id=>document.getElementById(id), modal=el('modal');
  let account={}, tier='', serverId='solo-duo', amount=0, gift=false,busy=false, generation=0;
  let checkout=null, brick=null, paymentTimer=null, pixTimer=null;
  const sdkPromises=new Map();
  const paymentStyle={theme:'dark',customVariables:{baseColor:'#ffb800',baseColorFirstVariant:'#e5a400',baseColorSecondVariant:'#ffd368',buttonTextColor:'#080b0d',textPrimaryColor:'#f8fafc',textSecondaryColor:'#b5c1ca',inputBackgroundColor:'#10191e',formBackgroundColor:'#0b1115',outlinePrimaryColor:'#455760',outlineSecondaryColor:'#ffb800',inputFocusedBoxShadow:'0 0 0 3px #ffb80033',inputVerticalPadding:'14px',inputHorizontalPadding:'14px',borderRadiusSmall:'14px',borderRadiusMedium:'18px',borderRadiusLarge:'22px',formPadding:'20px'}};
  const status=text=>{el('status').textContent=text;el('status').className='status show'};
  const flash=(text,type='')=>{el('flash').textContent=text;el('flash').className='flash show '+type};
  function buttons(){
    const linked=account.steamId && account.steamVerified;
    el('pix').disabled=busy||!linked;
    el('card').disabled=busy||!linked||!account.mpEnabled;
    el('stripe').disabled=busy||!linked||!account.stripeEnabled;
    el('email').disabled=busy||Boolean(checkout||brick);
  }
  async function dispose(){
    generation++;clearInterval(paymentTimer);clearInterval(pixTimer);
    if(checkout){checkout.destroy();checkout=null;}
    const old=brick;brick=null;if(old)await old.unmount().catch(()=>{});
    el('embedded').replaceChildren();el('qr').className='qr';busy=false;buttons();
    el('paymentSuccess').hidden=true;el('checkoutFields').hidden=false;
  }
  async function close(){modal.classList.remove('open');await dispose();}
  el('close').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  let servers={'solo-duo':{enabled:true,name:'Guerra Fria Solo/Duo'},trio:{enabled:false,name:'Guerra Fria Trio'},both:{enabled:false,name:'Guerra Fria Solo/Duo + Trio'}};
  function selectServer(id){
    serverId=id;window.gfSelectedServer=id;
    if(!id){el('serverSolo').classList.remove('active');el('serverTrio').classList.remove('active');el('serverBoth')?.classList.remove('active');el('serverInfo').textContent='Selecione um servidor para consultar preço e itens.';el('detailBuy').disabled=true;el('detailGift').disabled=true;return;}
    el('serverSolo').classList.toggle('active',id==='solo-duo');
    el('serverTrio').classList.toggle('active',id==='trio');el('serverBoth')?.classList.toggle('active',id==='both');
    el('serverInfo').textContent=servers[id].enabled?'Compras liberadas para '+servers[id].name+'.':servers[id].name+' está em preparação.';
    el('detailBuy').disabled=!servers[id].enabled;el('detailGift').disabled=!servers[id].enabled;document.dispatchEvent(new Event('gf:server'));
  }
  document.addEventListener('gf:clear-server',()=>selectServer(null));
  if(el('serverBoth'))el('serverBoth').onclick=()=>selectServer('both');el('serverSolo').onclick=()=>selectServer('solo-duo');el('serverTrio').onclick=()=>selectServer('trio');
  selectServer(new URLSearchParams(location.search).get('server')==='trio'?'trio':'solo-duo');
  fetch('/api/store/servers',{cache:'no-store'}).then(r=>r.json()).then(rows=>{for(const s of rows)if(servers[s.id])servers[s.id]=s;servers.both.enabled=servers.trio.enabled&&servers['solo-duo'].enabled;el('serverBoth')?.classList.toggle('soon',!servers.both.enabled);el('serverTrio').classList.toggle('soon',!servers.trio.enabled);el('serverTrio').querySelector('.tag').textContent=servers.trio.enabled?'DISPONÍVEL':'EM BREVE';selectServer(serverId);}).catch(()=>{});
  let accountLoading=false;
  async function refreshAccount(){
    if(accountLoading)return;accountLoading=true;
    try{
      const r=await fetch('/api/store/me',{cache:'no-store'});
      if(!r.ok)throw Error('Sua sessão expirou. Entre novamente com Discord.');
      const next=await r.json(),previousSteam=account.steamId;account=next;
      if(previousSteam&&previousSteam!==account.steamId){await dispose();status('O vínculo Steam foi atualizado pela administração. Entre com Steam novamente antes de comprar.');}
      el('steamLabel').textContent=account.steamId?'Steam '+account.steamId:'Steam não conectada';
      el('steamState').textContent=account.steamId?(account.steamVerified?'Steam ✓ autenticada':'Steam vinculada • confirme o login'):'Conectar conta Steam';
      el('steamDetail').textContent=account.steamId?'SteamID64 '+account.steamId+' receberá os VIPs.':'Entre com Steam para escolher a conta que receberá seus VIPs.';
      el('steamLogin').style.display=account.steamId&&account.steamVerified?'none':'flex';
      el('steamBox').classList.toggle('ok',Boolean(account.steamId&&account.steamVerified));
      el('card').innerHTML=account.mpEnabled?'💳 CARTÃO<br>Mercado Pago':'💳 CARTÃO<br>Mercado Pago indisponível';
      el('stripe').innerHTML=account.stripeEnabled?'💳 CARTÃO<br>Stripe':'💳 CARTÃO<br>Stripe indisponível';
      buttons();
    }catch(e){flash(e.message,'error')}finally{accountLoading=false;}
  }
  refreshAccount();setInterval(refreshAccount,10000);
  document.addEventListener('gf:checkout',async e=>{const b={dataset:e.detail};
    if(!servers[serverId]?.enabled)return;
    await dispose();tier=b.dataset.tier;amount=window.gfStorePricing?.[serverId]?.[tier]?.price??Number(b.dataset.price);gift=b.dataset.gift===true;
    el('modalTitle').textContent=window.gfStorePricing?.[serverId]?.[tier]?.name||b.dataset.name;
    el('modalPrice').textContent=amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' • 30 dias';
    el('chosenServer').textContent='Servidor: '+servers[serverId].name;
    el('paymentNote').textContent=gift?'Você está comprando um presente. Após o pagamento, envie o link ao amigo; ele entra com Steam e Discord para ativar o VIP.':serverId==='both'?'Os VIPs serão ativados nos dois servidores. Desconto adicional de 10% já aplicado.':'O VIP será ativado somente no servidor escolhido.';
    el('status').className='status';modal.classList.add('open');buttons();
    if(tier==='duo'&&!account.steamVerified)status('Confirme o login oficial com Steam para comprar o combo para seu grupo.');
    el('email').focus();
  });
  function purchase(){
    if(!account.steamId)throw Error('Entre com Steam antes de pagar.');
    if(!account.steamVerified)throw Error('Confirme o login oficial com Steam antes de comprar.');
    const email=el('email').value.trim();
    if(!el('email').checkValidity()||!email)throw Error('Informe um e-mail válido.');
    if(!servers[serverId].enabled)throw Error('Servidor em preparação.');
    return {tier,email,serverId,gift};
  }
  async function post(path,data){
    let response;try{response=await fetch('/api/store'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})}catch{throw Error('Falha de conexão. Tente novamente neste formulário.')}
    const result=await response.json().catch(()=>({error:'Não foi possível consultar o pagamento.'}));
    if(!response.ok)throw Error(result.error||'Pagamento indisponível. Tente novamente.');
    return result;
  }
  function sdk(src){
    if(!sdkPromises.has(src))sdkPromises.set(src,new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=src;script.onload=resolve;
      script.onerror=()=>{sdkPromises.delete(src);script.remove();reject(Error('Não foi possível carregar o formulário seguro. Tente novamente.'))};
      document.head.append(script);
    }));return sdkPromises.get(src);
  }
  function mountNode(id){el('embedded').replaceChildren();const div=document.createElement('div');div.id=id;el('embedded').append(div)}
  function showSuccess(d){
    el('modalTitle').textContent=d.product||'Sua compra';el('modalPrice').textContent=d.amount?Number(d.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' • 30 dias':'Compra confirmada';el('status').className='status';
    el('checkoutFields').hidden=true;el('embedded').replaceChildren();el('paymentSuccess').hidden=false;
    el('successTitle').textContent=d.gift?(d.giftReady?'Presente pronto para enviar!':'Pagamento confirmado! Preparando presente…'):d.delivered?'Pagamento concluído com sucesso!':'Pagamento confirmado!';
    el('successDetail').textContent=d.gift?'Pagamento confirmado! O VIP será ativado na conta do seu amigo quando ele resgatar o presente.':d.delivered?'Seus benefícios já estão ativos no '+(d.serverName||servers[serverId].name)+' por 30 dias.':'Estamos ativando seus benefícios. Esta tela atualizará automaticamente.';
    el('successPurchase').textContent=(d.product||'VIP')+' • Compra #'+d.id+(!d.gift&&d.steamId?' • Steam '+d.steamId:'');
    const links=(d.claimLinks||[]).filter(x=>x.claimUrl),invites=el('successInvites');if(invites){invites.replaceChildren();if(links.length)for(const link of links){const box=document.createElement('div');box.className='inviteCard';const title=document.createElement('b');title.textContent='Convite do amigo '+link.slot+(d.serverId==='both'?(Number(link.slot)===2?' • Trio':' • Solo/Duo + Trio'):'');const input=document.createElement('input');input.value=link.claimUrl;input.readOnly=true;input.setAttribute('aria-label',title.textContent);const copy=document.createElement('button');copy.className='primary';copy.textContent='COPIAR CONVITE';copy.onclick=async()=>{try{await navigator.clipboard.writeText(link.claimUrl);copy.textContent='COPIADO ✓'}catch{input.select()}};box.append(title,input,copy);invites.append(box);}}el('successDuo').hidden=!d.claimUrl||links.length>0;
    if(d.claimUrl){el('successLink').value=d.claimUrl;el('successExpiry').textContent='Um único resgate • válido até '+new Date(d.expiresAt).toLocaleString('pt-BR');}
    el('successDm').textContent=d.dmStatus==='sent'?'✓ A confirmação também foi enviada no seu privado do Discord.':d.dmStatus==='retrying'?'Não conseguimos enviar no Discord. Libere mensagens privadas do servidor; tentaremos novamente.':'A confirmação será enviada automaticamente no seu privado do Discord.';
  }
  el('successCopy').onclick=async()=>{try{await navigator.clipboard.writeText(el('successLink').value);el('successCopy').textContent='LINK COPIADO ✓'}catch{el('successLink').select();el('successCopy').textContent='Selecione e copie o link acima'}};
  function watch(id,seq){
    clearInterval(paymentTimer);
    const poll=async()=>{
      try{
        const r=await fetch('/api/store/payments/'+id,{cache:'no-store'});if(!r.ok)return;
        const d=await r.json();if(seq!==generation)return;
        if(d.status==='approved'){
          clearInterval(pixTimer);el('qr').className='qr';
          status(d.delivered?'Pagamento aprovado ✓ VIPs ativados.':'Pagamento aprovado ✓ A ativação está sendo processada.');
          showSuccess(d);
          refreshPurchases();
          if((d.delivered||d.giftReady)&&d.dmStatus==='sent')clearInterval(paymentTimer);
        }else if(['rejected','cancelled','failed','refunded','charged_back','expired'].includes(d.status)){
          clearInterval(paymentTimer);el('paymentSuccess').hidden=true;
          const labels={rejected:'recusado',cancelled:'cancelado',failed:'não concluído',refunded:'reembolsado',charged_back:'contestado',expired:'expirado'};
          status('Pagamento '+labels[d.status]+'. Confira sua compra antes de iniciar outra tentativa.');
        }else status('Aguardando confirmação do pagamento. Seus VIPs serão ativados automaticamente.');
      }catch{}
    };poll();paymentTimer=setInterval(poll,5000);
  }
  const returningPayment=Number(new URLSearchParams(location.search).get('payment'));
  if(Number.isSafeInteger(returningPayment)&&returningPayment>0){modal.classList.add('open');el('modalTitle').textContent='Sua compra';el('modalPrice').textContent='Conferindo confirmação do pagamento…';post('/payments/'+returningPayment+'/confirm',{}).catch(()=>{}).finally(()=>watch(returningPayment,generation));history.replaceState(null,'','/loja');}
  else if(new URLSearchParams(location.search).get('stripe')==='cancelled')flash('Checkout Stripe cancelado. Você pode escolher outra forma de pagamento.','warn');
  el('pix').onclick=async()=>{
    if(busy)return;
    try{
      const data=purchase();await dispose();const seq=generation;busy=true;buttons();status('Preparando seu PIX…');
      const d=await post('/pix',data);if(seq!==generation)return;
      el('qrImg').src='data:image/png;base64,'+d.qrCodeBase64;
      el('pixCode').textContent=d.qrCode;el('qr').className='qr show';
      const tick=()=>{
        const left=Math.max(0,Math.ceil((new Date(d.expiresAt).getTime()-Date.now())/1000));
        el('pixExpiry').textContent=left?'PIX válido por '+Math.floor(left/60)+'min '+left%60+'s':'PIX expirado. Gere um novo código.';
        if(!left){clearInterval(pixTimer);el('qr').className='qr';status('O PIX expirou. Você pode gerar um novo código.');}
      };tick();pixTimer=setInterval(tick,1000);watch(d.rowId,seq);
    }catch(e){status(e.message)}finally{busy=false;buttons()}
  };
  el('copy').onclick=async()=>{
    try{await navigator.clipboard.writeText(el('pixCode').textContent);el('copy').textContent='PIX COPIADO ✓'}
    catch{const range=document.createRange();range.selectNodeContents(el('pixCode'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);status('Código selecionado. Copie o PIX.');}
  };
  el('stripe').onclick=async()=>{
    if(busy||!account.stripeEnabled)return;
    try{
      const data=purchase();await dispose();const seq=generation;busy=true;buttons();status('Carregando checkout seguro…');
      const d=await post('/stripe/card',data);if(seq!==generation)return;
      const url=new URL(d.checkoutUrl);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Não foi possível abrir o checkout seguro.');
      status('Abrindo o checkout seguro da Stripe. Após pagar, você voltará à loja.');location.assign(url.href);
    }catch(e){status(e.message)}finally{busy=false;buttons()}
  };
  el('card').onclick=async()=>{
    if(busy||!account.mpEnabled)return;
    try{
      const data=purchase();await dispose();const seq=generation;busy=true;buttons();status('Carregando formulário seguro…');
      const attemptId=crypto.randomUUID();
      await sdk('https://sdk.mercadopago.com/js/v2');if(seq!==generation)return;
      const builder=new MercadoPago(account.mpPublicKey,{locale:'pt-BR'}).bricks();mountNode('mpCard');
      const instance=await builder.create('cardPayment','mpCard',{
        initialization:{amount,payer:{email:data.email}},
        customization:{visual:{style:paymentStyle},paymentMethods:{maxInstallments:12}},
        callbacks:{onReady:()=>{if(seq===generation)status('Preencha o cartão no formulário seguro abaixo.');},
          onError:()=>{if(seq===generation)status('Confira os dados do cartão ou tente carregar o formulário novamente.');},
          onSubmit:async formData=>{
            if(seq!==generation)return;
            busy=true;buttons();
            try{
              const d=await post('/card',{...data,attemptId,card:formData});if(seq!==generation)return;
              watch(d.rowId,seq);
              // Resolve submission before unmounting so the SDK finishes its own pending callback.
              setTimeout(async()=>{
                if(seq!==generation)return;
                const old=brick;brick=null;if(old)await old.unmount();if(seq!==generation)return;
                mountNode('mpStatus');
                const screen=await builder.create('statusScreen','mpStatus',{
                  initialization:{paymentId:d.paymentId,additionalInfo:d.threeDSInfo||{}},
                  customization:{visual:{style:{theme:'dark'}}},callbacks:{onReady:()=>{},onError:()=>{status('Confira o status acima. A confirmação continua automaticamente.');}}
                });
                if(seq!==generation){await screen.unmount();return;}brick=screen;buttons();
              },0);
            }catch(e){status(e.message);throw e;}finally{busy=false;buttons()}
          }
        }
      });
      if(seq!==generation){await instance.unmount();return;}brick=instance;
    }catch(e){status(e.message)}finally{busy=false;buttons()}
  };
`;
