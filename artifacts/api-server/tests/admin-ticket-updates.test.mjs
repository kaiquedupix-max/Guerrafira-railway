import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
async function moduleAt(path,mocks={}){
 const r=await build({entryPoints:[path],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'mock',setup(b){b.onResolve({filter:/.*/},a=>{const key=Object.keys(mocks).find(k=>a.path===k||a.path.endsWith('/'+k));return key?{path:key,namespace:'mock'}:null;});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{}};new Function('require','module','exports',r.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('buyer names prefer server nickname, then display name, never account username',async()=>{
 const api=await moduleAt('src/admin/paymentBuyerNames.ts',{'@workspace/db':'export const pool={};','client.js':'export const discordClient=()=>null;','steamProfiles.js':'export const getSteamProfileSummaries=async()=>new Map();'});
 assert.equal(api.discordBuyerDisplayName({nickname:'Marcelo',user:{globalName:'Nome global',username:'CleycePP'}},null),'Marcelo');
 assert.equal(api.discordBuyerDisplayName(null,{globalName:'Marcelo',username:'CleycePP'}),'Marcelo');
 assert.equal(api.discordBuyerDisplayName(null,{username:'CleycePP'}),'Nome de exibição indisponível');
});
test('selector is in main page flow with a label and mobile touch sizing',async()=>{
 const {panelMultiServerSeasonAddonJs:js}=await moduleAt('src/admin/panelMultiServerSeasonAddon.ts');
 const dom=new JSDOM('<aside class="sidebar"></aside><main class="main"><div class="top">Painel</div></main>',{url:'https://www.guerrafriarust.com.br/painel',runScripts:'outside-only'});
 try{const w=dom.window;w.fetch=async()=>({ok:true,json:async()=>({summary:{},registrations:[]})});w.setInterval=fn=>{fn();return 1;};w.eval(js);const box=w.document.getElementById('gfServerSelector');assert.equal(box.parentElement.className,'main');assert.equal(box.style.position,'relative');assert.equal(box.style.top,'');assert.equal(w.document.querySelector('label[for="gfServerSelect"]').textContent,'SERVIDOR ADMINISTRADO');assert.match(w.document.head.textContent,/min-height:48px/);assert.equal(w.document.querySelectorAll('#gfServerSelect option').length,2);
 }finally{dom.window.close();}
});
test('ticket alert goes only to enabled subscribers with direct ticket URL',async()=>{
 const sent=[],push=[];
 globalThis.__alerts={sent,push};
 const api=await moduleAt('src/admin/adminNotifications.ts',{'@workspace/db':`export const adminNotificationSubscriptionsTable={enabled:'enabled'};export const adminWebPushSubscriptionsTable={enabled:'enabled'};export const db={select:()=>({from:()=>({where:async()=>[{discordUserId:'123456789012345678'}]})})};`,
 'client.js':`export const discordClient=()=>({users:{fetch:async id=>({send:async data=>globalThis.__alerts.sent.push({id,data})})}});`,
 'logger.js':'export const logger={warn(){}};'});
 await api.notifySubscribedAdmins({kind:'ticket',title:'Novo ticket',message:'Ticket aberto',severity:'info',url:'https://discord.com/channels/1/2'});
 assert.equal(sent.length,1);assert.equal(sent[0].data.embeds[0].data.url,'https://discord.com/channels/1/2');delete globalThis.__alerts;
});
test('ticket API validates access and selected admin; close requires explicit matching confirmation',async()=>{
 const routes={},sent=[],closed=[];const member={id:'111111111111111111',user:{bot:false,globalName:'Marcelo'},permissions:{has:()=>true},roles:{cache:new Map()}};
 const target={...member,id:'222222222222222222'};
 const channel={id:'333333333333333333',type:0,name:'ticket-suporte',parentId:'cat',permissionsFor:()=>({has:()=>true}),send:async m=>sent.push(m)};
 globalThis.__ticketApi={routes,closed,guild:{channels:{fetch:async()=>channel},members:{fetch:async id=>id===target.id?target:member}}};
 process.env.DISCORD_GUILD_ID='guild';process.env.DISCORD_TICKETS_CATEGORY_ID='cat';
 await moduleAt('src/admin/routesTickets.ts',{'express':`export const Router=()=>({use(){},get(p,h){globalThis.__ticketApi.routes['GET '+p]=h},post(p,h){globalThis.__ticketApi.routes['POST '+p]=h}});`,
 'client.js':`export const discordClient=()=>({guilds:{fetch:async()=>globalThis.__ticketApi.guild}});`,
 'guard.js':'export const requireAdmin=()=>{};',
 'tickets.js':`export const closeTicketFromPanel=async(c,id)=>globalThis.__ticketApi.closed.push({c,id});`});
 const response=()=>({locals:{admin:{userId:member.id}},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
 let res=response();await routes['POST /:id/assign']({params:{id:channel.id},body:{adminId:target.id}},res);assert.equal(sent.length,1);assert.deepEqual(sent[0].allowedMentions,{parse:[],users:[target.id]});
 res=response();await routes['POST /:id/close']({params:{id:channel.id},body:{confirmation:'wrong'}},res);assert.equal(res.code,400);assert.equal(closed.length,0);
 res=response();await routes['POST /:id/close']({params:{id:channel.id},body:{confirmation:channel.id}},res);assert.equal(res.body.ok,true);assert.equal(closed.length,1);
 channel.permissionsFor=()=>({has:()=>false});res=response();await routes['POST /:id/assign']({params:{id:channel.id},body:{adminId:target.id}},res);assert.equal(res.code,403);assert.equal(sent.length,1);delete globalThis.__ticketApi;
});
test('ticket is retained if transcript storage fails',async()=>{
 let deleted=false;const api=await moduleAt('src/bot/tickets.ts',{'@workspace/db':`export const ticketLogsTable={};export const db={insert:()=>({values:()=>({onConflictDoNothing:async()=>{throw Error('db unavailable')}})})};`,
 'logger.js':'export const logger={info(){},warn(){},error(){}};',
 'adminNotifications.js':'export const notifySubscribedAdmins=async()=>{};',
 'vipArtwork.js':`export const VIP_STORE_URL='https://www.guerrafriarust.com.br/loja';`,
 'vipWebLinks.js':'export const redirectVipToWebsite=()=>{};'});
 const channel={id:'ticket',name:'ticket-suporte',topic:'',messages:{fetch:async()=>new Map()},client:{users:{fetch:async id=>({id,username:'admin'})}},delete:async()=>{deleted=true;}};
 await assert.rejects(api.closeTicketFromPanel(channel,'admin'),/db unavailable/);assert.equal(deleted,false);
});
