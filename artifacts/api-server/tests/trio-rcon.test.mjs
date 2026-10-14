import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const sockets=[],timers=[];
class Socket extends EventEmitter {
 static OPEN=1;
 constructor(url){super();this.url=url;this.readyState=0;this.sent=[];sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open')});}
 send(raw,done){this.sent.push(JSON.parse(raw));done?.();}
 terminate(){this.readyState=3;}
 reply(request,message){this.emit('message',JSON.stringify({Identifier:request.Identifier,Message:message}));}
}
globalThis.__trioTransport={Socket,duoCalls:[]};
const output=await build({entryPoints:['src/bot/utils/serverRcon.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(p){
 p.onResolve({filter:/^ws$|^\.\/rcon\.js$|lib\/logger\.js$/},a=>({path:a.path,namespace:'mock'}));
 p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='ws'?'export default globalThis.__trioTransport.Socket;':a.path.includes('rcon')?'export const executeDuoRconCommand=async command=>{globalThis.__trioTransport.duoCalls.push(command);return "duo";};':'export const logger={warn(){}};'}));
}}]});
const mod={exports:{}};new Function('require','module','exports','setTimeout','clearTimeout',output.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports,fn=>{const t={fn,cleared:false};timers.push(t);return t;},t=>t.cleared=true);
process.env.TRIO_RCON_HOST='trio.example';process.env.TRIO_RCON_PORT='28116';process.env.TRIO_RCON_PASSWORD='test';
const run=mod.exports.executeServerRcon;
const flushed=()=>new Promise(resolve=>setImmediate(resolve));
test('concurrent status, slot and Booster calls reuse one socket with independent response identifiers',async()=>{
 const requests=['serverinfo','server.maxplayers 100','c.usergroup add 76561199653021937 bs'].map(c=>run('trio',c));
 await flushed();assert.equal(sockets.length,1);const socket=sockets[0];assert.equal(socket.sent.length,3);
 assert.equal(new Set(socket.sent.map(x=>x.Identifier)).size,3);
 socket.reply({Identifier:0},'broadcast');
 for(const request of [...socket.sent].reverse())socket.reply(request,request.Message);
 assert.deepEqual(await Promise.all(requests),['serverinfo','server.maxplayers 100','c.usergroup add 76561199653021937 bs']);
 assert.equal(await run('solo-duo','serverinfo'),'duo');assert.equal(sockets.length,1);
});
test('a lost connection recovers on the next cycle and old close events cannot kill its replacement',async()=>{
 const first=run('trio','serverinfo');await flushed();const old=sockets[0];old.emit('close');assert.equal(await first,null);
 const second=run('trio','serverinfo');await flushed();assert.equal(sockets.length,2);old.emit('close');
 sockets[1].reply(sockets[1].sent[0],'current');assert.equal(await second,'current');
});
test('timeouts reset the connection without replaying a mutation; the next status query reconnects',async()=>{
 const mutation=run('trio','server.maxplayers 120');await flushed();const old=sockets[1];
 const active=timers.findLast(t=>!t.cleared);active.fn();assert.equal(await mutation,null);
 assert.equal(old.sent.filter(x=>x.Message==='server.maxplayers 120').length,1);
 const query=run('trio','serverinfo');await flushed();assert.equal(sockets.length,3);
 sockets[2].reply(sockets[2].sent[0],'recovered');assert.equal(await query,'recovered');
});
