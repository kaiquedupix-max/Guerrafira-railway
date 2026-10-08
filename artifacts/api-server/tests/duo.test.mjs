import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ts=createRequire(resolve('../../package.json'))('typescript');

process.env.DUO_TOKEN_SECRET = 'test-only-stable-secret';
const database = new PGlite();
const locks = new Set();
const calls = [];
let failTier = '';
const query = async (sql, params = []) => {
  const result = await database.query(sql, params);
  return { ...result, rowCount: /^\s*SELECT/i.test(sql) ? result.rows.length : result.affectedRows };
};
const pool = { query };
class Pool {
  on() {}
  async connect() {
    let owned;
    return {
      query: async (sql, params) => {
        // PostgreSQL's advisory-lock API is simulated; table operations use real
        // PostgreSQL in PGlite. Production multi-instance locking needs staging.
        if (sql.includes('pg_try_advisory_lock')) {
          const id = params[0], acquired = !locks.has(id);
          if (acquired) { locks.add(id); owned = id; }
          return { rows: [{ acquired }] };
        }
        if (sql.includes('pg_advisory_unlock')) { if (owned !== undefined) locks.delete(owned); return { rows: [] }; }
        return query(sql, params);
      }, release() {},
    };
  }
}
const delivery = async opts => {
  for (const tier of ['bronze','prata','ouro']) {
    const source = `purchase:${opts.paymentId}`;
    const existing = await query('SELECT 1 FROM vip_subscriptions WHERE steam_id=$1 AND vip_tier=$2 AND source=$3', [opts.steamId,tier,source]);
    if (existing.rows.length) continue;
    if (failTier === tier) throw new Error('simulated RCON outage');
    calls.push({ ...opts, tier });
    await query('INSERT INTO vip_subscriptions(steam_id,vip_tier,source) VALUES($1,$2,$3)', [opts.steamId,tier,source]);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
};
const products={bronze:{name:'VIP Bronze',price:15,emoji:'🥉'},prata:{name:'VIP Prata',price:49.9,emoji:'🥈'},ouro:{name:'VIP Ouro',price:79.9,emoji:'🥇'},combo:{name:'Pacote VIP Bronze + Prata + Ouro',price:70,emoji:'🎁'},duo:{name:'Super Combo Duo',price:120,emoji:'👥'}};
globalThis.__duoTest = { pool, Pool, delivery, products };
async function bundle(file, mocks = true) {
  const result = await build({ entryPoints:[resolve(file)], bundle:true, platform:'node', format:'esm', write:false,
    plugins: mocks ? [{ name:'test-adapters', setup(b) {
      b.onResolve({ filter:/^@workspace\/db$/ }, () => ({ path:'db',namespace:'mock' }));
      b.onResolve({ filter:/\/bot\/(client|vipProducts)\.js$/ }, args => ({path:args.path,namespace:'mock'}));
      b.onResolve({ filter:/\/lib\/logger\.js$/ }, args => ({path:args.path,namespace:'mock'}));
      b.onLoad({filter:/.*/,namespace:'mock'}, args => ({contents:args.path==='db'
        ? 'export const pool=globalThis.__duoTest.pool;export const Pool=globalThis.__duoTest.Pool;'
        : args.path.includes('vipProducts') ? 'export const grantVipProduct=globalThis.__duoTest.delivery;export const VIP_PRODUCTS=globalThis.__duoTest.products;export const isVipProduct=x=>x in VIP_PRODUCTS;'
        : args.path.includes('client') ? 'export const discordClient=()=>({});'
        : 'export const logger={error(){},info(){}};',loader:'js'}));
    } }] : [] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
await query(`CREATE TABLE payments(id INTEGER PRIMARY KEY,discord_user_id TEXT,steam_id TEXT,status TEXT,
  vip_tier TEXT, vip_granted_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT now());`);
await query('CREATE TABLE vip_subscriptions(steam_id TEXT,vip_tier TEXT,source VARCHAR(16));');
await query('CREATE TABLE booster_links(discord_user_id TEXT PRIMARY KEY,steam_id TEXT);');
const service = await bundle('src/routes/duoService.ts');
const policy = await bundle('src/routes/duoPolicy.ts',false);
after(async()=>{delete globalThis.__duoTest;await database.close();});
async function purchase(id, status='approved') {
  await query("INSERT INTO payments(id,discord_user_id,steam_id,status,vip_tier) VALUES($1,'buyer','76561190000000001',$2,'duo')", [id,status]);
}
async function token(id) {
  const row=(await query('SELECT nonce FROM duo_redemptions WHERE payment_id=$1',[id])).rows[0];
  return policy.duoToken(id,row.nonce);
}
test('pending payments cannot issue a token or deliver VIPs',async()=>{
  await purchase(1,'pending');await assert.rejects(service.fulfillDuoPayment(1),/não aprovado/);
  assert.equal((await query('SELECT * FROM duo_redemptions')).rows.length,0);
});
test('approved purchase delivers three VIPs and issues one stable link',async()=>{
  await purchase(2);await service.fulfillDuoPayment(2);await service.fulfillDuoPayment(2);
  const items=await service.listDuoPurchases('buyer'), row=items.find(x=>x.id===2);
  assert.equal(row.buyerStatus,'delivered');assert.match(row.claimUrl,/redeem#[A-Za-z0-9_-]{43}$/);
  assert.equal((await query("SELECT * FROM vip_subscriptions WHERE source='purchase:2'")).rows.length,3);
  assert.equal((await query('SELECT * FROM duo_redemptions WHERE payment_id=2')).rows.length,1);
  await assert.rejects(service.inspectDuoToken('x'.repeat(43)),/inválido/);
});
test('inspection and buyer attempts do not consume a link',async()=>{
  const t=await token(2);await service.inspectDuoToken(t);await service.inspectDuoToken(t);
  await assert.rejects(service.redeemDuo(t,'buyer','76561190000000009'),/comprador/);
  await assert.rejects(service.redeemDuo(t,'duo','76561190000000001'),/comprador/);
  assert.equal((await service.inspectDuoToken(t)).status,'available');
});
test('simultaneous claims bind one duo and prevent reuse',async()=>{
  const t=await token(2);
  const attempts=await Promise.allSettled([service.redeemDuo(t,'duoA','76561190000000002'),service.redeemDuo(t,'duoB','76561190000000003')]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  const row=await service.inspectDuoToken(t);assert.equal(row.status,'redeemed');
  await assert.rejects(service.redeemDuo(t,row.duo_discord_id,row.duo_steam_id),/já foi resgatado/);
  assert.equal((await query("SELECT * FROM vip_subscriptions WHERE source='purchase:2'")).rows.length,6);
});
test('partial delivery remains bound and retries only missing tiers, even after expiry',async()=>{
  await purchase(3);await service.fulfillDuoPayment(3);const t=await token(3);
  failTier='prata';await assert.rejects(service.redeemDuo(t,'duoC','76561190000000004'),/outage/);failTier='';
  assert.equal((await service.inspectDuoToken(t)).status,'delivering');
  await assert.rejects(service.redeemDuo(t,'duoD','76561190000000005'),/outro duo/);
  await query("UPDATE duo_redemptions SET expires_at=now()-interval '1 day' WHERE payment_id=3");
  await service.redeemDuo(t,'duoC','76561190000000004');
  assert.equal(calls.filter(x=>x.paymentId===3&&x.steamId==='76561190000000004'&&x.tier==='bronze').length,1);
  assert.equal((await service.inspectDuoToken(t)).status,'redeemed');
});
test('unused expired links and refunded purchases cannot be redeemed',async()=>{
  await purchase(4);await service.fulfillDuoPayment(4);const t=await token(4);
  await query("UPDATE duo_redemptions SET expires_at=now()-interval '1 second' WHERE payment_id=4");
  await assert.rejects(service.redeemDuo(t,'duoE','76561190000000006'),/expirou/);
  await query("UPDATE payments SET status='refunded' WHERE id=4");
  await assert.rejects(service.redeemDuo(t,'duoE','76561190000000006'),/bloqueado/);
  assert.equal((await service.listDuoPurchases('buyer')).find(x=>x.id===4).claimUrl,null);
});
test('official Steam state is signed, user-bound and recorded separately',async()=>{
  const auth=await bundle('src/routes/storeSteamAuth.ts');const s=auth.steamState('duoA',true);
  assert.equal(auth.readSteamState(s,'duoA').duo,true);assert.equal(auth.readSteamState(s,'wrong'),null);
  assert.equal(auth.readSteamState(s+'x','duoA'),null);
  assert.equal(await auth.officialSteam('duoA','76561190000000002'),false);
  await query("INSERT INTO booster_links(discord_user_id,steam_id) VALUES('duoA','76561190000000002')");
  await auth.recordOfficialSteam('duoA','76561190000000002');
  assert.equal(await auth.officialSteam('duoA','76561190000000002'),true);
});
test('duo page preserves the token through login and requires verified Steam',async()=>{
  const {renderDuoPage}=await bundle('src/admin/duoPage.ts',false);
  const dom=new JSDOM(renderDuoPage(),{url:'https://www.guerrafriarust.com.br/api/store/duo/redeem#'+'a'.repeat(43),runScripts:'dangerously',beforeParse(w){
    w.fetch=async url=>({ok:true,json:async()=>url.includes('/me')?{username:'Duo',steamId:'76561190000000002',steamVerified:false}:{status:'available',expiresAt:new Date(Date.now()+10000).toISOString()}});
  }});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(dom.window.location.hash,'');assert.equal(dom.window.sessionStorage.getItem('gf_duo_token'),'a'.repeat(43));
  assert.equal(dom.window.document.getElementById('claim').disabled,true);
  assert.equal(dom.window.document.getElementById('steam').hidden,false);
  assert.equal(dom.window.document.getElementById('discord').hidden,true);dom.window.close();
});
test('real VIP product expansion retries components per recipient and preserves individual plans',async()=>{
  const rows=[],table={steamId:'steamId',discordUserId:'discordUserId',vipTier:'vipTier',source:'source'};
  let outage='';
  const mocks={
    'drizzle-orm':{eq:(key,value)=>({key,value}),and:(...conditions)=>conditions},
    '@workspace/db':{vipSubscriptionsTable:table,db:{select:()=>({from:()=>({where:conditions=>({limit:async()=>rows.filter(row=>conditions.every(c=>row[c.key]===c.value))})})})}},
    './vip.js':{VIP_TIERS:{bronze:products.bronze,prata:products.prata,ouro:products.ouro},grantVip:async opts=>{
      if(opts.tier===outage)throw new Error('partial');rows.push({steamId:opts.steamId,discordUserId:opts.discordUserId,vipTier:opts.tier,source:opts.source});
    }},
  };
  const exports={};const compiled=ts.transpileModule(readFileSync('src/bot/vipProducts.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(compiled,{exports,require:name=>mocks[name]});
  assert.equal(exports.VIP_PRODUCTS.duo.price,120);assert.equal(exports.VIP_PRODUCTS.combo.price,70);
  const opts={paymentId:100,discordUserId:'a',steamId:'s1',tier:'duo',durationDays:30,source:'purchase',client:{}};
  outage='prata';await assert.rejects(exports.grantVipProduct(opts),/partial/);outage='';
  await exports.grantVipProduct(opts);await exports.grantVipProduct(opts);
  await exports.grantVipProduct({...opts,discordUserId:'b',steamId:'s2'});
  assert.equal(rows.length,6);assert.equal(rows.filter(x=>x.steamId==='s1'&&x.vipTier==='bronze').length,1);
  await exports.grantVipProduct({...opts,tier:'bronze',paymentId:101});assert.equal(rows.length,7);
  await exports.grantVipProduct({...opts,tier:'combo',paymentId:102});assert.equal(rows.length,10);
});
test('store offers five products, validates checkout and recovers from network failure',async()=>{
  const {renderStorePage}=await bundle('src/admin/storePage.ts');const requests=[],errors=[];
  const dom=new JSDOM(renderStorePage('<Buyer>'),{url:'https://www.guerrafriarust.com.br/loja',runScripts:'dangerously',beforeParse(w){
    w.addEventListener('error',e=>errors.push(e.message));
    w.fetch=async(url,opts)=>{requests.push({url,body:opts?.body});if(url==='/api/store/me')return{ok:true,json:async()=>({steamId:'76561190000000001',steamVerified:true,stripeEnabled:true})};
      if(url==='/api/store/duo-purchases')return{ok:true,json:async()=>[{id:12,paymentStatus:'approved',buyerStatus:'delivered',claimStatus:'available',claimUrl:'https://www.guerrafriarust.com.br/api/store/duo/redeem#token',expiresAt:new Date(Date.now()+10000).toISOString()}]};
      throw new Error('network');};
  }});await new Promise(resolve=>setTimeout(resolve,30));
  const doc=dom.window.document;assert.equal(doc.querySelectorAll('.vipCard').length,5);
  assert.equal(doc.querySelector('[data-tier=duo]').dataset.price,'120');assert.equal(errors.length,0);
  assert.match(doc.getElementById('duoPurchases').textContent,/COPIAR LINK DO DUO/);
  doc.querySelector('[data-tier=duo]').click();doc.getElementById('email').value='invalid';doc.getElementById('pix').click();
  await new Promise(resolve=>setTimeout(resolve,10));assert.match(doc.getElementById('status').textContent,/e-mail válido/);
  doc.getElementById('email').value='buyer@example.com';doc.getElementById('pix').click();
  await new Promise(resolve=>setTimeout(resolve,20));assert.match(doc.getElementById('status').textContent,/Falha de conexão/);
  assert.equal(doc.getElementById('pix').disabled,false);assert.equal(JSON.parse(requests.find(r=>r.url==='/api/store/pix').body).tier,'duo');
  dom.window.close();
});
