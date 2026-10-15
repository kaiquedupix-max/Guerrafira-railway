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
