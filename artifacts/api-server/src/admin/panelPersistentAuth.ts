export const panelPersistentAuthJs = String.raw`
(function(){'use strict';
  const KEY='gf_admin_token';
  try{
    const params=new URLSearchParams(location.search);
    const incoming=params.get('auth')||'';
    if(incoming){
      localStorage.setItem(KEY,incoming);
      sessionStorage.setItem(KEY,incoming);
      params.delete('auth');
      history.replaceState(null,'',location.pathname+(params.toString()?'?'+params.toString():''));
    }else{
      const persistent=localStorage.getItem(KEY)||'';
      const session=sessionStorage.getItem(KEY)||'';
      if(persistent&&!session)sessionStorage.setItem(KEY,persistent);
      else if(session&&!persistent)localStorage.setItem(KEY,session);
    }
  }catch{}
})();
`;