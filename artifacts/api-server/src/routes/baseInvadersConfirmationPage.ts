export function renderBaseInvadersConfirmationPage(): string {
  return String.raw`<!doctype html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Inscrição confirmada | Guerra Fria Invaders</title>
<style>
:root{color-scheme:dark;font-family:Inter,Arial,Helvetica,sans-serif;background:#080d0e;color:#f2f4f2}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 65% 15%,#66502555,transparent 42%),#080d0e}
.bi-confirm-wrap{width:min(740px,calc(100% - 32px));margin:75px auto;padding:clamp(24px,6vw,58px);border:1px solid #8b6d31;border-radius:16px;background:#131b1c;box-shadow:0 25px 90px #0007}
.bi-confirm-tag{display:inline-block;color:#ffd478;font-weight:900;letter-spacing:.14em;font-size:11px}
.bi-confirm-wrap h1{font-size:clamp(36px,6vw,64px);letter-spacing:-.05em;line-height:1.05;margin:20px 0}
.bi-confirm-wrap h1 em{color:#f5c154;font-style:normal}
.bi-confirm-wrap p{line-height:1.7;color:#c4cdca}
.bi-confirm-details{padding:18px 22px;margin:25px 0;background:#0b1112;border:1px solid #354440;border-radius:10px}
.bi-confirm-details p{margin:8px 0}
.bi-confirm-wrap a{display:inline-block;padding:14px 19px;background:#f3bc4e;color:#16120a;text-decoration:none;font-weight:900;border-radius:7px;font-size:12px}
</style></head><body>
<main class="bi-confirm-wrap">
  <span class="bi-confirm-tag">GUERRA FRIA RUST • GUERRA FRIA INVADERS</span>
  <h1>Inscrição <em>confirmada!</em></h1>
  <p>Recebemos seu cadastro gratuitamente. A participação ainda está sujeita à aprovação da organização.</p>
  <div id="bi-confirm-details" class="bi-confirm-details" role="status" aria-live="polite">Consultando os dados da sua inscrição...</div>
  <a href="/base-invaders">VOLTAR AO EVENTO ↗</a>
</main>
<script>
(()=>{
  const el=document.getElementById('bi-confirm-details');
  fetch('/api/base-invaders/minha-inscricao',{credentials:'same-origin'})
    .then(r=>{if(!r.ok)throw Error('Não foi possível consultar a inscrição.');return r.json()})
    .then(d=>{
      el.replaceChildren();
      const reg=d.registration;
      if(!reg){el.textContent='Nenhuma inscrição ativa encontrada nesta conta. Volte à página do evento para se inscrever.';return}
      const random=reg.registration_mode==='random';
      const lines=[
        random?'Modalidade: inscrição aleatória (individual)':'Modalidade: trio fechado',
        random?'O sorteio e a montagem do seu trio serão realizados pela organização no dia do evento.':'Equipe: '+reg.team_name,
        'Situação: '+(reg.status==='approved'?'inscrição aprovada':'aguardando aprovação')
      ];
      for(const line of lines){const p=document.createElement('p');p.textContent=line;el.append(p)}
    })
    .catch(e=>{el.textContent=e.message||'Erro ao consultar a inscrição.'});
})();
</script>
</body></html>`;
}
