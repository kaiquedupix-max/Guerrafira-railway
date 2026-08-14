export const panelBrandingJs = String.raw`
(function(){
  function apply(){
    document.querySelectorAll('.version').forEach(el=>{el.textContent='Atualização automática • Desenvolvido por Maciota';});
    document.querySelectorAll('.brand small').forEach(el=>{el.textContent='CENTRAL DE CONTROLE • POR MACIOTA';});
    const login=document.getElementById('login');
    if(login&&!login.querySelector('.maciotaCredit')){
      const c=document.createElement('div');c.className='subtitle maciotaCredit';c.style.marginTop='18px';c.textContent='Sistema desenvolvido por Maciota';login.appendChild(c);
    }
    const app=document.getElementById('app');
    if(app&&!document.getElementById('maciotaFooter')){
      const f=document.createElement('div');f.id='maciotaFooter';f.textContent='Guerra Fria • Desenvolvido por Maciota';f.style.cssText='position:fixed;right:14px;bottom:10px;z-index:80;font-size:9px;color:#756a82;pointer-events:none';document.body.appendChild(f);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();
  setTimeout(apply,800);
})();
`;