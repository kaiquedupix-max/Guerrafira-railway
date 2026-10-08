import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
let calls=0;
const raw=JSON.stringify({version:2,kits:[{id:'bronze',name:'Bronze',tier:'bronze',cooldownSeconds:86400,items:[{shortname:'wood',name:'Wood',amount:1000,skin:'0',itemId:-151838493}]}]});
globalThis.__catalogRcon=async (server,command)=>{assert.equal(command,'vipkits.catalog');calls++;return raw;};
const b=await build({entryPoints:[resolve('src/routes/storeCatalog.ts')],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'rcon',setup(p){p.onResolve({filter:/\/utils\/serverRcon\.js$/},()=>({path:'rcon',namespace:'mock'}));p.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const executeServerRcon=globalThis.__catalogRcon;'}));}}]});
const catalog=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
test('catalog exposes configured quantities and safe shortname icon URLs',()=>{
 const kits=catalog.parseKitCatalog(raw);assert.equal(kits[0].items[0].amount,1000);
 assert.equal(kits[0].items[0].icon,'https://cdn.rusthelp.com/images/256/wood.png');
 const legacy=JSON.parse(raw);legacy.kits[0].items[0].shortname='legacy bow';
 assert.equal(catalog.parseKitCatalog(JSON.stringify(legacy))[0].items[0].icon,'https://cdn.rusthelp.com/images/256/legacy%20bow.png');
 const invalid=JSON.parse(raw);invalid.kits[0].items[0].shortname='../../secret';assert.throws(()=>catalog.parseKitCatalog(JSON.stringify(invalid)),/Item inválido/);
 invalid.kits[0].items[0].shortname='wood';invalid.kits[0].items[0].amount=-1;assert.throws(()=>catalog.parseKitCatalog(JSON.stringify(invalid)),/Item inválido/);
 assert.throws(()=>catalog.parseKitCatalog('{"version":1,"kits":[]}'),/incompatível/);
});
test('catalog shares live reads and does not invent absent kit tiers',async()=>{
 const [bronze,duo]=await Promise.all([catalog.storeKitCatalog('bronze'),catalog.storeKitCatalog('duo')]);
 assert.equal(calls,1);assert.equal(bronze.complete,true);assert.equal(duo.complete,false);assert.equal(duo.kits.length,1);
});
test('server catalogs have isolated caches',async()=>{
 const trio=await catalog.storeKitCatalog('bronze','trio');
 const solo=await catalog.storeKitCatalog('bronze','solo-duo');
 assert.equal(trio.serverId,'trio');assert.equal(solo.serverId,'solo-duo');assert.equal(calls,2);
});
