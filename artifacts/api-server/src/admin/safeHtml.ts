import { adminHtml } from "./html.js";

const fallbackScript = `
<script>
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

  window.addEventListener('error', function () {
    showLoginFallback('O painel encontrou um erro ao carregar. Entre novamente com o Discord ou recarregue a página.');
  });
  window.addEventListener('unhandledrejection', function () {
    var login = document.getElementById('login');
    var app = document.getElementById('app');
    if (login && app && getComputedStyle(login).display === 'none' && getComputedStyle(app).display === 'none') {
      showLoginFallback('Não foi possível carregar sua sessão administrativa. Entre novamente com o Discord.');
    }
  });

  setTimeout(function () {
    var login = document.getElementById('login');
    var app = document.getElementById('app');
    if (!login || !app) return;

    var loginHidden = getComputedStyle(login).display === 'none';
    var appHidden = getComputedStyle(app).display === 'none';

    if (loginHidden && appHidden) {
      if (typeof window.boot === 'function') {
        Promise.resolve(window.boot()).catch(function () {
          showLoginFallback('Sua sessão não pôde ser carregada. Entre novamente com o Discord.');
        });
      } else {
        showLoginFallback('O painel não conseguiu iniciar. Recarregue a página ou entre novamente com o Discord.');
      }
    }
  }, 400);
})();
</script>`;

export const safeAdminHtml = adminHtml
  .replace('id="login" class="login" style="display:none"', 'id="login" class="login" style="display:block"')
  .replace('</body>', `${fallbackScript}</body>`);
