import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {resolve} from 'node:path';
import {Collection} from 'discord.js';

const pg=new PGlite();
const pool={query:(s,p)=>pg.query(s,p),connect:async()=>({
  query:(s,p)=>s.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):pg.query(s,p),release(){}
})};
const products={bronze:{name:'VIP Bronze',price:15,emoji:'🥉'},prata:{name:'VIP Prata',price:49.9,emoji:'🥈'},ouro:{name:'VIP Ouro',price:79.9,emoji:'🥇'},combo:{name:'Pacote 3 VIPs',price:70,emoji:'🎁'},duo:{name:'Super Combo Duo',price:120,emoji:'👥'}};
globalThis.__storeTests={pool,products};
const log='export const logger={info(){},warn(){},error(){}};';
async function bundle(path,mocks={}){
  const result=await build({entryPoints:[resolve(path)],bundle:true,platform:'node',format:'esm',packages:'external',write:false,
    plugins:[{name:'test-adapters',setup(b){
      const map={...mocks};
      b.onResolve({filter:/.*/},args=>{
        const key=Object.keys(map).find(x=>args.path===x||args.path.endsWith('/'+x));
        return key?{path:key,namespace:'mock'}:null;
      });
      b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:map[args.path],loader:'js'}));
    }}]});
  // Write the module next to installed packages, since external imports cannot resolve from data URLs.
  const {writeFile,mkdtemp,rm}=await import('node:fs/promises');
  const dir=await mkdtemp(resolve('tests/.store-test-'));
  try{await writeFile(dir+'/module.mjs',result.outputFiles[0].text);return await import('file:///'+(dir+'/module.mjs').replaceAll('\\','/'));}
  finally{await rm(dir,{recursive:true,force:true});}
}
after(async()=>{delete globalThis.__storeTests;await pg.close()});

test('persistent card attempts reuse the same payment and reject changed buyer, product, email or price',async()=>{
  await pg.exec(`CREATE TABLE payments(id SERIAL PRIMARY KEY,discord_user_id TEXT,steam_id TEXT,email TEXT,vip_tier TEXT,amount NUMERIC,method TEXT,status TEXT,mp_external_reference TEXT);`);
  const {cardAttempt}=await bundle('src/routes/storeCardAttempts.ts',{'@workspace/db':'export const pool=globalThis.__storeTests.pool;'});
  const key='dd01d978-65d7-451d-a8de-45b3f9dd4173', purchase={tier:'duo',steamId:'76561190000000001',discordUserId:'buyer',email:'buyer@example.com'};
  const first=await cardAttempt(key,purchase,120),retry=await cardAttempt(key,purchase,120);
  assert.equal(first.id,retry.id);
  for(const change of [{discordUserId:'attacker'},{steamId:'76561190000000002'},{tier:'ouro'},{email:'another@example.com'}])
    await assert.rejects(cardAttempt(key,{...purchase,...change},120),/inválida/);
  await assert.rejects(cardAttempt(key,purchase,1),/inválida/);
  assert.equal((await pg.query('SELECT * FROM payments')).rows.length,1);
  assert.equal((await pg.query('SELECT * FROM store_card_attempts')).rows.length,1);
});

test('provider requests keep server price and identities and contain no hosted redirect for embedded Stripe',async()=>{
  const original=globalThis.fetch,requests=[];
  process.env.MP_ACCESS_TOKEN='test-secret';process.env.MP_PUBLIC_KEY='test-public';
  process.env.STRIPE_SECRET_KEY='sk_test_secret';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_public';
  process.env.APP_URL='https://www.guerrafriarust.com.br';
  globalThis.fetch=async(url,options)=>{
    requests.push({url,options});return new Response(JSON.stringify(String(url).includes('stripe')?{id:'cs_test_example',client_secret:'cs_test_example_secret'}:{id:123,status:'pending'}));
  };
  try{
    const mp=await bundle('src/bot/mpEmbedded.ts',{'logger.js':log});
    assert.equal(mp.parseCardData({token:'short',payment_method_id:'visa',installments:1}),null);
    assert.equal(mp.parseCardData({token:'token_valid',payment_method_id:'visa',installments:100}),null);
    const card=mp.parseCardData({token:'token_valid',payment_method_id:'visa',installments:1,transaction_amount:0.01,card_number:'should-never-pass',payer:{email:'attacker@example.com'}});
    await mp.createEmbeddedMpPayment({id:1,key:'retry-stable',amount:120,email:'buyer@example.com',tier:'duo',discord:'buyer',steam:'steam',description:'Duo',card});
    const data=JSON.parse(requests[0].options.body);
    assert.equal(data.transaction_amount,120);assert.equal(data.payer.email,'buyer@example.com');
    assert.equal(data.card_number,undefined);assert.equal(data.metadata.payment_row_id,'1');
    assert.equal(requests[0].options.headers['X-Idempotency-Key'],'site-card-retry-stable');
    const stripe=await bundle('src/bot/stripe.ts',{'logger.js':log});
    assert.equal(stripe.isEmbeddedStripeConfigured(),true);
    const result=await stripe.createStripeCheckout({embedded:true,paymentRowId:1,amount:120,title:'Duo',email:'buyer@example.com',discordUserId:'buyer',steamId:'steam',vipTier:'duo'});
    assert.equal(result.clientSecret,'cs_test_example_secret');
    const body=new URLSearchParams(requests[1].options.body);
    assert.equal(body.get('ui_mode'),'embedded');assert.equal(body.get('redirect_on_completion'),'never');
    assert.equal(body.has('success_url'),false);assert.equal(body.has('cancel_url'),false);
    assert.equal(body.get('line_items[0][price_data][unit_amount]'),'12000');
  }finally{globalThis.fetch=original;}
});

test('checkout mounts both SDKs inside the store, retains card retry id and PIX displays its code',async()=>{
  const {renderStorePage}=await bundle('src/admin/storePage.ts',{'vipProducts.js':'export const VIP_PRODUCTS=globalThis.__storeTests.products;'});
  const requests=[],mounted=[],errors=[];let cardSubmit,fail=true;
  const dom=new JSDOM(renderStorePage('Buyer'),{url:'https://www.guerrafriarust.com.br/loja',runScripts:'dangerously',beforeParse(w){
    w.addEventListener('error',e=>errors.push(e.message));
    w.Stripe=()=>({initEmbeddedCheckout:async()=>({mount:x=>mounted.push(x),destroy(){}})});
    w.MercadoPago=class{bricks(){return{create:async(type,id,config)=>{
      mounted.push(type);if(type==='cardPayment')cardSubmit=config.callbacks.onSubmit;
      config.callbacks.onReady();return{unmount:async()=>{}};
    }}}};
    const append=w.Element.prototype.append;
    w.Element.prototype.append=function(script){append.call(this,script);if(script.tagName==='SCRIPT'&&script.src)setTimeout(()=>script.onload(),0)};
    w.fetch=async(url,options)=>{
      requests.push({url,body:options?.body&&JSON.parse(options.body)});
      let data={};
      if(url==='/api/store/me')data={steamId:'76561190000000001',steamVerified:true,stripeEnabled:true,mpEnabled:true,stripePublishableKey:'pk_test_public',mpPublicKey:'mp_public'};
      else if(url==='/api/store/duo-purchases')data=[];
      else if(url==='/api/store/stripe/card')data={rowId:1,clientSecret:'secret'};
      else if(url==='/api/store/card'){if(fail){fail=false;throw Error('network')}data={rowId:2,paymentId:'123',status:'pending'};}
      else if(url==='/api/store/pix')data={rowId:3,qrCode:'pix-test-code',qrCodeBase64:'AA==',expiresAt:new Date(Date.now()+600000).toISOString()};
      else if(url.startsWith('/api/store/payments/'))data={status:'pending'};
      return{ok:true,json:async()=>data};
    };
  }});
  const pause=()=>new Promise(r=>setTimeout(r,30));
  const doc=dom.window.document;await pause();doc.querySelector('[data-tier=duo]').click();await pause();doc.getElementById('email').value='buyer@example.com';
  doc.getElementById('stripe').click();await pause();assert.ok(mounted.includes('#stripeCheckout'));
  doc.getElementById('card').click();await pause();assert.ok(mounted.includes('cardPayment'));
  const card={token:'valid-token',payment_method_id:'visa',installments:1};
  await assert.rejects(cardSubmit(card),/Falha de conexão/);await cardSubmit(card);await pause();
  const tries=requests.filter(r=>r.url==='/api/store/card');assert.equal(tries.length,2);assert.equal(tries[0].body.attemptId,tries[1].body.attemptId);
  assert.ok(mounted.includes('statusScreen'));
  doc.getElementById('pix').click();await pause();assert.equal(doc.getElementById('pixCode').textContent,'pix-test-code');
  assert.match(doc.getElementById('pixExpiry').textContent,/válido por/);assert.equal(dom.window.location.pathname,'/loja');
  assert.deepEqual(errors,[]);dom.window.close();
});

test('Discord migration preserves humans, paginates old cards, replaces with two website buttons and is idempotent',async()=>{
  const vip=await bundle('src/bot/vipStore.ts',{'logger.js':log,'booster.js':'export async function startBoosterSystem(){}','moderation.js':'export function startDiscordModeration(){}'});
  delete process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID;delete process.env.DISCORD_GUILD_ID;
  const messages=[],deleted=[];let next=300;
  const make=(id,author,embeds)=>({id:String(id),author:{id:author},embeds,
    edit:async function(p){this.embeds=p.embeds.map(e=>e.toJSON());this.components=p.components.map(r=>r.toJSON());return this},
    delete:async function(){deleted.push(this.id);messages.splice(messages.indexOf(this),1)}
  });
  for(let i=1;i<=105;i++)messages.push(make(i,'bot',[{title:'Old VIP'}]));
  messages.push(make(200,'human',[{title:'Human embed'}]));
  const channel={id:'vip',guildId:'guild',isTextBased:()=>true,isSendable:()=>true,messages:{fetch:async({limit,before})=>{
    const list=messages.filter(m=>!before||Number(m.id)<Number(before)).sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,limit);return new Collection(list.map(m=>[m.id,m]));
  }},send:async p=>{const m=make(next++,'bot',p.embeds.map(e=>e.toJSON()));m.components=p.components?.map(r=>r.toJSON());messages.push(m);return m}};
  const client={user:{id:'bot'},channels:{fetch:async()=>channel}};
  await vip.setupVipStore(client);assert.equal(deleted.length,105);assert.equal(messages.length,3);
  assert.equal(messages.filter(m=>m.author.id==='human').length,1);
  for(const m of messages.filter(m=>m.author.id==='bot')){
    const button=m.components[0].components[0];assert.equal(button.style,5);assert.match(button.url,/\/loja\?server=(solo-duo|trio)$/);assert.equal(button.custom_id,undefined);
    assert.match(m.embeds[0].image.url,/\/api\/store\/art\/duo-banner$/);
  }
  await vip.setupVipStore(client);assert.equal(messages.length,3);assert.equal(deleted.length,105);
});
