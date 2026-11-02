export const panelTransportJs = String.raw`
(function(){'use strict';
 const native=window.fetch.bind(window),pending=new Map(),cache=new Map();
 let revision=0;
 const selected=()=>window.GF_ADMIN_SERVER||localStorage.getItem('gf_admin_server')||'solo-duo';
 window.GF_ADMIN_SERVER=selected()==='trio'?'trio':'solo-duo';
 window.fetch=async function(input,init){
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.origin!==location.origin||!url.pathname.startsWith('/api/admin/'))return native(input,init);
   const cfg=Object.assign({},init),h=new Headers(input instanceof Request?input.headers:undefined);
   new Headers(cfg.headers).forEach((v,k)=>h.set(k,v));
   if(!h.has('X-GF-Server'))h.set('X-GF-Server',window.GF_ADMIN_SERVER);
   const token=sessionStorage.getItem('gf_admin_token')||localStorage.getItem('gf_admin_token');
   if(token&&!h.has('Authorization'))h.set('Authorization','Bearer '+token);
   cfg.headers=h;cfg.credentials='same-origin';cfg.cache='no-store';
   const method=String(cfg.method||(input instanceof Request?input.method:'GET')).toUpperCase(),read=method==='GET';
   if(!read){revision++;cache.clear();}
   const startedAtRevision=revision;
   const key=startedAtRevision+':'+h.get('X-GF-Server')+':'+url.href+':'+h.get('Authorization');
   const cached=cache.get(key);if(read&&cached&&Date.now()-cached.at<1500)return cached.response.clone();
   if(read&&pending.has(key))return(await pending.get(key)).clone();
   const run=async()=>{
     if(!read)window.dispatchEvent(new Event('gf-action-start'));
     try{
       for(let attempt=0;;attempt++){
         const timeout=AbortSignal.timeout(read?15000:120000);
         const signal=cfg.signal&&AbortSignal.any?AbortSignal.any([cfg.signal,timeout]):cfg.signal||timeout;
         try{
           const response=await native(input,Object.assign({},cfg,{signal}));
           if(read&&attempt===0&&[502,503,504].includes(response.status)){await new Promise(r=>setTimeout(r,300));continue;}
           if(read&&response.ok&&revision===startedAtRevision){if(cache.size>150)cache.clear();cache.set(key,{at:Date.now(),response:response.clone()});}
           if(!read)cache.clear();
           return response;
         }catch(error){if(!read||attempt||cfg.signal?.aborted)throw error;}
       }
     }finally{if(!read){revision++;cache.clear();window.dispatchEvent(new Event('gf-action-end'));}}
   };
   const task=run();if(read)pending.set(key,task);
   try{return(await task).clone();}finally{if(read&&pending.get(key)===task)pending.delete(key);}
 };
 let actions=0;const locked=new Map();
 window.addEventListener('gf-action-start',()=>{actions++;window.GF_ADMIN_ACTIONS_PENDING=actions;document.querySelectorAll('#drawerHost button,#gfServerSelect').forEach(b=>{if(!locked.has(b))locked.set(b,b.disabled);b.disabled=true;});});
 window.addEventListener('gf-action-end',()=>{window.GF_ADMIN_ACTIONS_PENDING=Math.max(0,--actions);if(actions>0)return;actions=0;locked.forEach((disabled,b)=>{if(b.isConnected)b.disabled=disabled});locked.clear();});
})();`;
