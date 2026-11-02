import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';import {setTimeout as wait} from 'node:timers/promises';
const built=await build({entryPoints:['src/admin/appRenderShim.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'session',setup(b){b.onResolve({filter:/sessionBearer\.js/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const getAdminSessionV3=()=>null;'}));}}]});
const {renderAdmin}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('full panel boots with Trio headers, bounded requests and separate chat views without observer loops',async()=>{
 const dom=new JSDOM(renderAdmin({}),{url:'https://guerrafriarust.com.br/painel',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,calls=[],errors=[];
 Object.assign(w,{Headers,Request,Response,AbortSignal});w.localStorage.setItem('gf_admin_server','trio');w.confirm=()=>true;w.addEventListener('error',e=>{errors.push(String(e.error));e.preventDefault()});w.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 const Original=w.MutationObserver;let mutations=0;w.MutationObserver=class extends Original{constructor(cb){super((records,o)=>{if(++mutations>1000){o.disconnect();errors.push('observer loop');return;}cb(records,o)})}};
 w.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,w.location.href),headers=new Headers(init.headers),server=headers.get('X-GF-Server');calls.push({path:url.pathname,server,method:init.method||'GET'});
  let data={};if(url.pathname.endsWith('/me'))data={user:{username:'Admin'},capabilities:{canViewFinance:false}};
  else if(url.pathname.endsWith('/overview'))data={server:{players:12,maxPlayers:300,queued:0,joining:1},summary:{knownPlayers:300,activeBoosters:2,activeVips:3},recentModeration:[]};
  else if(url.pathname.endsWith('/players'))data={players:[{steamId:'76561190000000001',playerName:'Trio Player',isOnline:true}],total:1};
  else if(url.pathname.endsWith('/server/chat'))data={messages:[{id:1,at:new Date().toISOString(),type:'Chat',player:server==='trio'?'TRIO PLAYER':'DUO PLAYER',message:'Olá'}]};
  else if(url.pathname.includes('/player-state/'))data={booster:{active:false},vip:{active:false},verified:false,warnings:0};
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  for(const script of w.document.querySelectorAll('script'))w.eval(script.textContent);
  await wait(500);
  assert.ok(!w.document.getElementById('app').classList.contains('hidden'));
  assert.equal(w.document.getElementById('ovOnline').textContent,'12');
  assert.equal(w.document.getElementById('ovKnown').textContent,'300');
  assert.ok(calls.filter(c=>c.path.startsWith('/api/admin/')).every(c=>c.server==='trio'));
  w.document.querySelector('[data-view="chat"]').click();await wait(100);
  assert.match(w.document.getElementById('chatBox').textContent,/DUO PLAYER/);
  assert.match(w.document.getElementById('trioChatBox').textContent,/TRIO PLAYER/);
  assert.ok(calls.some(c=>c.path.endsWith('/server/chat')&&c.server==='solo-duo'));
  w.document.getElementById('chatTarget').value='trio';w.document.getElementById('chatInput').value='Admin Trio';w.document.getElementById('sendChat').click();await wait(50);
  assert.equal(calls.findLast(c=>c.path.endsWith('/server/chat')&&c.method==='POST').server,'trio');
  assert.ok(calls.length<35,'too many initial requests: '+calls.length);
  assert.deepEqual(errors,[]);assert.ok(mutations<500,'unexpected repeated DOM mutations: '+mutations);
 }finally{w.close();}
});
test('Duo overview fills on first open after delayed authentication and keeps updating without tab clicks',async()=>{
 const dom=new JSDOM(renderAdmin({}),{url:'https://guerrafriarust.com.br/painel',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,intervals=[];let online=23,clock=0;
 Object.assign(w,{Headers,Request,Response,AbortSignal});const now=w.Date.now.bind(w.Date);w.Date.now=()=>now()+clock;
 const originalInterval=w.setInterval.bind(w);w.setInterval=(fn,ms)=>{if(ms===10000)intervals.push(fn);return originalInterval(fn,ms)};
 w.fetch=async(input,init={})=>{const path=new URL(typeof input==='string'?input:input.url,w.location.href).pathname;let data={};
  if(path.endsWith('/me')){await wait(120);data={user:{username:'Duo Admin'},capabilities:{canViewFinance:false}};}
  else if(path.endsWith('/overview')){assert.equal(new Headers(init.headers).get('X-GF-Server'),'solo-duo');data={server:{players:online,maxPlayers:300,queued:2,sleepers:8,joining:5,map:'Procedural Map'},summary:{knownPlayers:1000,activeBoosters:7,activeVips:9},recentModeration:[{action:'TEST',playerName:'Player',adminName:'Admin'}]};}
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  for(const script of w.document.querySelectorAll('script'))w.eval(script.textContent);
  await wait(400);
  assert.equal(w.document.getElementById('sendAnnouncement'),null,'legacy form must be removed before initial data load');
  assert.equal(w.document.getElementById('financeDays'),null,'restricted finance controls are optional');
  for(const [id,value]of Object.entries({ovOnline:'23',ovQueue:'2',ovSleepers:'8',ovSlots:'300',ovMap:'Procedural Map',ovKnown:'1000',ovBoosters:'7',ovVips:'9'}))assert.equal(w.document.getElementById(id).textContent,value,id);
  assert.match(w.document.getElementById('overviewLogs').textContent,/TEST/);
  assert.equal(w.document.querySelector('.view.active').id,'overview');
  online=31;clock+=2000;await Promise.all(intervals.map(fn=>fn()));await wait(20);assert.equal(w.document.getElementById('ovOnline').textContent,'31');
  online=32;clock+=2000;w.document.dispatchEvent(new w.Event('visibilitychange'));await wait(20);assert.equal(w.document.getElementById('ovOnline').textContent,'32');
 }finally{w.close();}
});
test('authentication recovery starts the entire overview after a temporary initial auth failure',async()=>{
 const dom=new JSDOM(renderAdmin({}),{url:'https://guerrafriarust.com.br/painel',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let authenticated=false;
 Object.assign(w,{Headers,Request,Response,AbortSignal});w.console.error=()=>{};
 w.fetch=async(input)=>{const path=new URL(typeof input==='string'?input:input.url,w.location.href).pathname;
  if(path.endsWith('/me')&&!authenticated)return new Response(JSON.stringify({error:'temporary'}),{status:401});
  const data=path.endsWith('/me')?{user:{username:'Recovered'},capabilities:{canViewFinance:false}}:path.endsWith('/overview')?{server:{players:44,maxPlayers:300},summary:{knownPlayers:800,activeVips:2,activeBoosters:1},recentModeration:[]}:{};
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  for(const script of w.document.querySelectorAll('script'))w.eval(script.textContent);
  await wait(50);assert.equal(w.document.getElementById('ovOnline').textContent,'—');
  authenticated=true;w.dispatchEvent(new w.Event('focus'));await wait(100);
  assert.equal(w.document.getElementById('ovOnline').textContent,'44');assert.equal(w.document.querySelector('.view.active').id,'overview');assert.equal(w.document.getElementById('app').classList.contains('hidden'),false);
 }finally{w.close();}
});

test('panel unban accepts an empty reason and blocks duplicate actions while awaiting confirmation',async()=>{
 const dom=new JSDOM(renderAdmin({}),{url:'https://guerrafriarust.com.br/painel',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];let release,states=0;
 Object.assign(w,{Headers,Request,Response,AbortSignal});w.confirm=()=>true;w.localStorage.setItem('gf_admin_server','trio');
 w.fetch=async(input,init={})=>{const path=new URL(typeof input==='string'?input:input.url,w.location.href).pathname;let data={};
  if(path.endsWith('/me'))data={user:{username:'Admin'},capabilities:{canViewFinance:false}};
  if(path.endsWith('/overview'))data={summary:{},recentModeration:[]};
  if(path.endsWith('/players'))data={players:[{steamId:'76561190000000002',playerName:'Tester',isOnline:true}],total:1};
  if(path.includes('/player-state/')){states++;data={banned:true,warnings:0,ban:{duration:'3d',reason:'Teste'},vip:{active:false},booster:{active:false}};}
  if(path.endsWith('/mute-durations'))data={durations:[{name:'10 minutos',value:'10m'}]};
  if(path.endsWith('/unban')){calls.push({body:JSON.parse(init.body),server:new Headers(init.headers).get('X-GF-Server')});await new Promise(resolve=>{release=resolve});data={ok:true};}
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  for(const script of w.document.querySelectorAll('script'))w.eval(script.textContent);await wait(100);
  w.document.querySelector('[data-view="players"]').click();await wait(30);w.document.querySelector('#playersRows tr').click();await wait(30);
  const button=w.document.getElementById('actBan');assert.match(button.textContent,/Desbanir/);assert.equal(states,1,'the drawer state must not be fetched twice');
  assert.equal(w.document.getElementById('actReason').value,'');button.click();button.click();await wait(10);
  assert.equal(calls.length,1);assert.equal(calls[0].server,'trio');assert.equal(calls[0].body.reason,'');
  w.document.getElementById('drawerBackdrop').click();assert.ok(w.document.getElementById('actBan'),'drawer cannot close while an action is pending');
  release();await wait(30);assert.equal(w.document.getElementById('actBan'),null);
 }finally{release?.();w.close();}
});

test('panel mute uses the shared duration list and dispatches to the selected server',async()=>{
 const dom=new JSDOM(renderAdmin({}),{url:'https://guerrafriarust.com.br/painel',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 Object.assign(w,{Headers,Request,Response,AbortSignal});w.confirm=()=>true;w.localStorage.setItem('gf_admin_server','trio');
 w.fetch=async(input,init={})=>{const path=new URL(typeof input==='string'?input:input.url,w.location.href).pathname;let data={};
  if(path.endsWith('/me'))data={user:{username:'Admin'},capabilities:{canViewFinance:false}};
  if(path.endsWith('/overview'))data={summary:{},recentModeration:[]};
  if(path.endsWith('/players'))data={players:[{steamId:'76561190000000002',playerName:'Tester',isOnline:true}],total:1};
  if(path.includes('/player-state/'))data={banned:false,muted:false,warnings:0,vip:{active:false},booster:{active:false}};
  if(path.endsWith('/mute-durations'))data={durations:[{name:'10 minutos',value:'10m'},{name:'1 hora',value:'1h'}]};
  if(path.endsWith('/mute')&&init.method==='POST'){calls.push({body:JSON.parse(init.body),server:new Headers(init.headers).get('X-GF-Server')});data={ok:true};}
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  for(const script of w.document.querySelectorAll('script'))w.eval(script.textContent);await wait(100);
  w.document.querySelector('[data-view="players"]').click();await wait(30);w.document.querySelector('#playersRows tr').click();await wait(30);
  assert.equal(w.document.querySelectorAll('#muteDuration option').length,2);w.document.getElementById('actMute').click();await wait(10);assert.equal(calls.length,0,'a mute still requires its reason');
  w.document.getElementById('actReason').value='Flood';w.document.getElementById('muteDuration').value='1h';w.document.getElementById('actMute').click();await wait(30);
  assert.equal(calls.length,1);assert.equal(calls[0].server,'trio');assert.equal(calls[0].body.duration,'1h');assert.equal(calls[0].body.reason,'Flood');
 }finally{w.close();}
});
