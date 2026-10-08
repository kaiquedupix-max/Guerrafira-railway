import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base=(process.env.ELGAE_PANEL_URL||'').replace(/\/$/,''),server=process.env.ELGAE_SERVER_ID,key=process.env.ELGAE_API_KEY;
if(!base||!server||!key)throw Error('Pterodactyl integration is incomplete');
const api=async(path,options={})=>{const r=await fetch(base+'/api/client/servers/'+server+path,{...options,headers:{Authorization:'Bearer '+key,Accept:'Application/vnd.pterodactyl.v1+json',...options.headers},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Pterodactyl returned '+r.status);return r;};
const list=async dir=>(await(await api('/files/list?directory='+encodeURIComponent(dir))).json()).data.map(x=>x.attributes.name);
const read=async file=>(await api('/files/contents?file='+encodeURIComponent(file))).text();
const write=async(file,text)=>api('/files/write?file='+encodeURIComponent(file),{method:'POST',headers:{'Content-Type':'text/plain'},body:text});
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const source=readFileSync(new URL('./VipKits.cs',import.meta.url),'utf8');
const root=await list('/');const framework=root.includes('carbon')?'carbon':root.includes('oxide')?'oxide':null;
if(!framework)throw Error('No supported plugin directory found');
const file='/'+framework+'/plugins/VipKits.cs';const current=await read(file);
if(hash(current)===hash(source)){console.log('VipKits already updated');process.exit(0);}
if(hash(current)!=='b8e57611cfb1b4913b2b41ad6e15ce5368bbddeaf242cb3505ba6319b32aeab5')throw Error('Live plugin differs from supplied source; refusing to overwrite');
const backup='/'+framework+'/data/VipKits-before-store-v2.txt';
const files=await list('/'+framework+'/data');
if(files.includes('VipKits-before-store-v2.txt')){if(hash(await read(backup))!==hash(current))throw Error('Existing backup differs');}else{await write(backup,current);}
if(hash(await read(backup))!==hash(current))throw Error('Backup verification failed');
await write(file,source);
if(hash(await read(file))!==hash(source)){await write(file,current);throw Error('Upload verification failed; source restored');}
console.log('VipKits uploaded with verified backup. Existing configuration and player data preserved. Check plugin compile and vipkits.catalog before declaring installation complete.');
