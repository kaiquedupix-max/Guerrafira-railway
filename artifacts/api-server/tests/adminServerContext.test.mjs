import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
const built=await build({entryPoints:[resolve('src/core/adminServerContext.ts')],bundle:true,platform:'node',format:'esm',write:false});
const ctx=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('concurrent Duo and Trio requests retain isolated server context, while background tasks remain Duo',async()=>{
 let release;const pause=new Promise(r=>release=r);const trio=ctx.withAdminServer('trio',async()=>{assert.equal(ctx.adminServer(),'trio');await pause;assert.equal(ctx.adminServer(),'trio');return ctx.hostSettings().serverId});
 assert.equal(ctx.adminServer(),'solo-duo');assert.equal(await ctx.withAdminServer('solo-duo',async()=>{await Promise.resolve();return ctx.adminServer()}),'solo-duo');release();assert.equal(await trio,'ad506a79');assert.equal(ctx.adminServer(),'solo-duo');
});
test('invalid server input rejects requests before command dispatch',()=>{
 let called=false,status;ctx.adminServerMiddleware({get:()=> 'other',query:{}},{status:n=>{status=n;return{json(){}}}},()=>called=true);assert.equal(status,400);assert.equal(called,false);
});
