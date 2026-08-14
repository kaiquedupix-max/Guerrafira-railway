export const panelAuthRecoveryJs = String.raw`
(function(){
  async function recoverAdmin(){
    try{
      const r=await fetch('/api/admin/me',{cache:'no-store',credentials:'same-origin',headers:{'Cache-Control':'no-cache'}});
      if(!r.ok) return;
      const j=await r.json().catch(()=>({}));
      const login=document.getElementById('login');
      const app=document.getElementById('app');
      const username=document.getElementById('username');
      if(username && j?.user?.username) username.textContent=j.user.username;
      if(login) login.classList.add('hidden');
      if(app) app.classList.remove('hidden');
    }catch{}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    recoverAdmin();
    setTimeout(recoverAdmin,400);
    setTimeout(recoverAdmin,1200);
  });
  window.addEventListener('pageshow',recoverAdmin);
})();
`;