export const panelMobileFixJs = String.raw`
(function(){
  'use strict';
  const css=document.createElement('style');
  css.textContent=`
  @media(max-width:980px){
    :root{--gf-global-nav-h:76px;--gf-admin-nav-h:64px}
    body{overflow-x:hidden}
    .main{padding-bottom:calc(var(--gf-global-nav-h) + var(--gf-admin-nav-h) + 34px + env(safe-area-inset-bottom))!important}
    .mobileNav{position:fixed!important;left:8px!important;right:8px!important;bottom:calc(var(--gf-global-nav-h) + 8px + env(safe-area-inset-bottom))!important;top:auto!important;z-index:1400!important;display:flex!important;overflow-x:auto!important;overflow-y:hidden!important;gap:6px!important;padding:7px!important;border:1px solid #38264a!important;border-radius:16px!important;background:#0b0810f2!important;backdrop-filter:blur(18px)!important;box-shadow:0 -10px 30px #0007!important;max-width:calc(100vw - 16px)!important}
    .mobileNav button{flex:0 0 auto!important;min-width:max-content!important;white-space:nowrap!important;padding:10px 14px!important}
    .drawerBackdrop{padding-bottom:0!important;align-items:stretch!important}
    .drawer{padding-bottom:calc(28px + env(safe-area-inset-bottom))!important;max-width:100vw!important;overflow-x:hidden!important}
    .drawerHead{padding-right:4px!important}
    .drawer input,.drawer select,.drawer textarea,.drawer .stateCard,.drawer .section,.drawer .actionGrid{max-width:100%!important;min-width:0!important}
    .drawer .actionGrid{grid-template-columns:1fr!important}
    body.gf-drawer-open .mobileNav{display:none!important}
    body.gf-drawer-open [data-gf-global-nav],body.gf-drawer-open .gf-global-nav,body.gf-drawer-open .appNav,body.gf-drawer-open .bottomNav{display:none!important}
    .tableWrap{max-width:100%;overflow-x:auto!important}
    .section,.card,.body,.top{max-width:100%;min-width:0}
    #username{max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  }
  @media(max-width:560px){
    .main{padding-left:10px!important;padding-right:10px!important}
    .top{gap:8px!important}
    .top h1{font-size:28px!important;line-height:1.05!important}
    .drawer{padding:10px!important;padding-bottom:calc(26px + env(safe-area-inset-bottom))!important}
    .drawerHead h2{font-size:22px!important}
    .drawer .btn{width:100%!important;min-height:48px!important}
  }`;
  document.head.appendChild(css);

  function markGlobalNav(){
    const candidates=[...document.querySelectorAll('nav,div')];
    for(const el of candidates){
      if(el.id==='mobileNav'||el.closest('#mobileNav')) continue;
      const txt=(el.textContent||'').replace(/\s+/g,' ').trim();
      if(txt.includes('Portal')&&txt.includes('Ranking')&&txt.includes('Integridade')&&txt.includes('Controle')){
        el.setAttribute('data-gf-global-nav','1');
        if(matchMedia('(max-width:980px)').matches){
          const s=el.style;
          s.position='fixed';s.left='8px';s.right='8px';s.bottom='calc(8px + env(safe-area-inset-bottom))';s.top='auto';s.zIndex='1390';s.maxWidth='calc(100vw - 16px)';
        }
        break;
      }
    }
  }
  function drawerState(){document.body.classList.toggle('gf-drawer-open',!!document.querySelector('.drawerBackdrop'))}
  const obs=new MutationObserver(()=>{markGlobalNav();drawerState()});
  obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>{markGlobalNav();drawerState()},100);
  setTimeout(markGlobalNav,800);
})();
`;
