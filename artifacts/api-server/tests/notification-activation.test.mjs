import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const r=await build({entryPoints:['src/admin/panelAlerts.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {panelAlertsJs}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function setup(ios=false){
 const dom=new JSDOM('<nav id="nav"><button>Inicial</button></nav><main class="main"><h1 id="pageTitle"></h1></main>',{url:'https://www.guerrafriarust.com.br/painel',runScripts:'outside-only'}),w=dom.window;
 const events=[];let saved=false,current=null;
 const intervals=[];w.matchMedia=()=>({matches:false});w.setInterval=fn=>{intervals.push(fn);return 1;};w.setTimeout=()=>1;
 w.PushManager=function(){};w.Notification={permission:'default',requestPermission:async()=>{events.push('permission');w.Notification.permission='granted';return 'granted';}};
 const reg={active:{},pushManager:{getSubscription:async()=>current,subscribe:async()=>{events.push('subscribe');return current={endpoint:'endpoint',toJSON:()=>({endpoint:'endpoint',keys:{p256dh:'key',auth:'auth'}}),unsubscribe:async()=>true};}}};
 let readyAccesses=0;
 const worker={getRegistration:async()=>current?reg:undefined,register:async()=>{events.push('register');return reg;},get ready(){readyAccesses++;return Promise.resolve(reg);}};
 Object.defineProperty(w.navigator,'serviceWorker',{value:worker});if(ios)Object.defineProperty(w.navigator,'userAgent',{value:'iPhone'});
 w.fetch=async(url,opt)=>{events.push(opt?.method==='POST'?'save':url);if(opt?.method==='POST')saved=true;return {ok:true,json:async()=>url.includes('/web-push')?{enabled:saved,publicKey:'AQID'}:url.includes('/discord')?{enabled:false}:{alerts:[]}};};
 w.eval(panelAlertsJs);intervals[0]();w.document.querySelector('[data-alerts-page]').click();
 return {dom,w,events,readyAccesses:()=>readyAccesses};
}
test('opening settings never waits for an unregistered service worker',async()=>{
 const s=setup();try{await tick();assert.match(s.w.document.getElementById('appNotifyState').textContent,/desativado/);assert.equal(s.readyAccesses(),0);}finally{s.dom.window.close();}
});
test('activation requests permission in click, registers worker, saves and shows enabled state',async()=>{
 const s=setup();try{await tick();s.events.length=0;s.w.document.getElementById('toggleAppNotify').click();await tick();assert.equal(s.events[0],'permission');assert.ok(s.events.indexOf('register')<s.events.indexOf('subscribe'));assert.ok(s.events.includes('save'));assert.match(s.w.document.getElementById('appNotifyState').textContent,/ativado/);assert.equal(s.w.document.getElementById('toggleAppNotify').disabled,false);}finally{s.dom.window.close();}
});
test('iPhone outside installed app gets instructions without waiting or permission requests',async()=>{
 const s=setup(true);try{await tick();s.events.length=0;s.w.document.getElementById('toggleAppNotify').click();await tick();assert.match(s.w.document.getElementById('pushHint').textContent,/Tela de Início/);assert.equal(s.events.includes('permission'),false);assert.equal(s.readyAccesses(),0);}finally{s.dom.window.close();}
});
