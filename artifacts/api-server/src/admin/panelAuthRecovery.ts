export const panelAuthRecoveryJs = String.raw`
(function(){
  const TOKEN_KEY='gf_admin_token';
  let verified=false;

  // O painel V5 usava sessionStorage, que é descartado quando o PWA/iOS é fechado.
  // Mantemos a mesma sessão assinada também no localStorage e restauramos ao reabrir.
  try{
    const sessionToken=sessionStorage.getItem(TOKEN_KEY)||'';
    const persistentToken=localStorage.getItem(TOKEN_KEY)||'';
    if(sessionToken){
      localStorage.setItem(TOKEN_KEY,sessionToken);
    }else if(persistentToken){
      sessionStorage.setItem(TOKEN_KEY,persistentToken);
    }
  }catch{}

  function clearSavedToken(){
    try{sessionStorage.removeItem(TOKEN_KEY)}catch{}
    try{localStorage.removeItem(TOKEN_KEY)}catch{}
  }

  async function recoverAdmin(){
    try{
      // Sincroniza novamente caso o token tenha chegado pelo ?auth= depois deste script iniciar.
      const sessionToken=sessionStorage.getItem(TOKEN_KEY)||'';
      if(sessionToken && localStorage.getItem(TOKEN_KEY)!==sessionToken){
        localStorage.setItem(TOKEN_KEY,sessionToken);
      }

      const r=await fetch('/api/admin/me',{cache:'no-store',credentials:'same-origin',headers:{'Cache-Control':'no-cache'}});
      if(!r.ok){
        if(r.status===401||r.status===403) clearSavedToken();
        return;
      }
      const j=await r.json().catch(()=>({}));
      verified=true;
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
    setTimeout(recoverAdmin,250);
    setTimeout(recoverAdmin,800);
    setTimeout(recoverAdmin,1800);
    setInterval(()=>{ if(verified) recoverAdmin(); },4000);
  });
  window.addEventListener('pageshow',recoverAdmin);
  window.addEventListener('focus',recoverAdmin);
})();
`;
