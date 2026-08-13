import { adminPanelEs } from "./panelEs.js";

const authBootstrap = `<script>
(function(){
  try {
    var params = new URLSearchParams(window.location.search);
    var token = params.get('auth');
    if (token) {
      sessionStorage.setItem('gf_admin_token', token);
      params.delete('auth');
      var qs = params.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    }
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      var cfg = Object.assign({}, init || {});
      var headers = new Headers(cfg.headers || {});
      var saved = sessionStorage.getItem('gf_admin_token') || '';
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (saved && (url.indexOf('/api/admin') === 0 || url.indexOf(window.location.origin + '/api/admin') === 0)) headers.set('Authorization', 'Bearer ' + saved);
      cfg.headers = headers;
      return nativeFetch(input, cfg).then(function(r){ if (r.status === 401 && url.indexOf('/api/admin') >= 0) sessionStorage.removeItem('gf_admin_token'); return r; });
    };
  } catch (_) {}
})();
</script>`;

const fallbackScript = `<script>
(function () {
  function showLoginFallback(message) {
    var login=document.getElementById('login'),app=document.getElementById('app');
    if(app)app.style.display='none';
    if(login){login.style.display='block';var p=login.querySelector('p');if(p&&message)p.textContent=message;}
  }
  setTimeout(function(){
    var login=document.getElementById('login'),app=document.getElementById('app');if(!login||!app)return;
    fetch('/api/admin/me').then(function(r){if(!r.ok)throw new Error(String(r.status));return r.json();}).then(function(data){
      login.style.display='none';app.style.display='grid';var u=document.getElementById('username');if(u&&data&&data.user)u.textContent=data.user.username||'Administrador';
      if(document.getElementById('nav')&&!document.getElementById('nav').children.length&&typeof window.nav==='function')try{window.nav()}catch(_){}
      if(typeof window.loadOverview==='function')try{Promise.resolve(window.loadOverview()).catch(function(){})}catch(_){}
    }).catch(function(){showLoginFallback('Tu sesión administrativa expiró. Inicia sesión nuevamente con Discord.');});
  },350);
})();
</script>`;

export const safeAdminHtml = adminPanelEs
  .replace('<head>', `<head>${authBootstrap}`)
  .replace('id="login" class="login" style="display:none"', 'id="login" class="login" style="display:block"')
  .replace('</body>', `${fallbackScript}</body>`);
