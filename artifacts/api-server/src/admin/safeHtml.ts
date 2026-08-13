import { adminHtml } from "./html.js";

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
    if (params.get('admin_logout') === '1') sessionStorage.removeItem('gf_admin_token');
  } catch (_) {}
})();
</script>`;

const originalApi = "async function api(url,opt){const r=await fetch(url,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));";
const patchedApi = "async function api(url,opt){const token=sessionStorage.getItem('gf_admin_token')||'';const cfg=Object.assign({},opt||{});cfg.headers=Object.assign({'Content-Type':'application/json'},(opt&&opt.headers)||{});if(token)cfg.headers.Authorization='Bearer '+token;const r=await fetch(url,cfg);if(r.status===401)sessionStorage.removeItem('gf_admin_token');";

const fallbackScript = `<script>
(function () {
  function showLoginFallback(message) {
    var login = document.getElementById('login');
    var app = document.getElementById('app');
    if (app) app.style.display = 'none';
    if (login) {
      login.style.display = 'block';
      var p = login.querySelector('p');
      if (p && message) p.textContent = message;
    }
  }
  setTimeout(function(){
    var token=''; try{token=sessionStorage.getItem('gf_admin_token')||'';}catch(_){}
    if(!token)return;
    fetch('/api/admin/me',{headers:{Authorization:'Bearer '+token}}).then(function(r){
      if(!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(function(data){
      var login=document.getElementById('login'); var app=document.getElementById('app');
      if(login)login.style.display='none'; if(app)app.style.display='grid';
      var u=document.getElementById('username'); if(u&&data&&data.user)u.textContent=data.user.username||'Administrador';
    }).catch(function(){showLoginFallback('Sua sessão administrativa expirou. Entre novamente com o Discord.');});
  },250);
})();
</script>`;

export const safeAdminHtml = adminHtml
  .replace('<head>', `<head>${authBootstrap}`)
  .replace(originalApi, patchedApi)
  .replace('id="login" class="login" style="display:none"', 'id="login" class="login" style="display:block"')
  .replace('</body>', `${fallbackScript}</body>`);
