import WebSocket from 'ws';
import {executeRconCommand} from './rcon.js';
import type {GuerraFriaServerId} from '../../core/servers.js';

// The Trio has an isolated connection: never retarget the existing Solo/Duo socket.
export async function executeServerRcon(server:GuerraFriaServerId,command:string):Promise<string|null>{
 if(server==='solo-duo')return executeRconCommand(command);
 const host=process.env.TRIO_RCON_HOST,port=process.env.TRIO_RCON_PORT,password=process.env.TRIO_RCON_PASSWORD;
 if(!host||!port||!password)return null;
 return new Promise(resolve=>{
  const socket=new WebSocket(`ws://${host}:${port}/${password}`);let done=false;
  const finish=(value:string|null)=>{if(done)return;done=true;clearTimeout(timer);socket.terminate();resolve(value);};
  const timer=setTimeout(()=>finish(null),12000);
  socket.on('open',()=>socket.send(JSON.stringify({Identifier:1,Message:command,Name:'Guerra Fria Store Trio'})));
  socket.on('message',data=>{try{const r=JSON.parse(data.toString());if(r.Identifier===1)finish(String(r.Message??''));}catch{}});
  socket.on('error',()=>finish(null));socket.on('close',()=>finish(null));
 });
}
