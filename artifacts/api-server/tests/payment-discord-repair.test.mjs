import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const built=await build({entryPoints:['src/admin/panelFinanceRepair.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {panelFinanceRepairJs}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('correction targets only selected payment and changes only the Discord ID',async()=>{
 const calls=[];const data={payments:[{id:'454',steamId:'76561199234347785',discordUserId:'570637473336786988',status:'approved',amount:40}]};
 const dom=new JSDOM('<section id="finance"><table><tbody id="financeRows"></tbody></table></section>',{url:'https://www.guerrafriarust.com.br/painel',runScripts:'outside-only'});
 try{const w=dom.window;w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true}),clone:()=>({json:async()=>data})};};w.prompt=()=> '746936547953213450';w.confirm=()=>true;w.alert=()=>{};w.eval(panelFinanceRepairJs);await w.fetch('/api/admin/finance/live');await new Promise(r=>setTimeout(r,0));w.document.getElementById('financeRows').innerHTML='<tr><td>base renderer</td></tr>';await new Promise(r=>setTimeout(r,0));assert.ok(w.document.querySelector('[data-payment-discord="454"]'));w.document.querySelector('[data-payment-discord="454"]').click();w.document.querySelector('[data-discord-input]').value='746936547953213450';w.document.querySelector('[data-payment-save="454"]').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls[1].url,'/api/admin/finance/454');assert.equal(calls[1].options.method,'PATCH');assert.deepEqual(JSON.parse(calls[1].options.body),{discordUserId:'746936547953213450'});assert.match(w.document.getElementById('financeRows').textContent,/Discord corrigido/);
 }finally{dom.window.close();}
});
