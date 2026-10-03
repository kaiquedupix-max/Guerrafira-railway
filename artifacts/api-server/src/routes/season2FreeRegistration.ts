import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { getCommunitySession } from "../admin/communitySession.js";
import { getLinkedSteamV2 } from "../bot/utils/linkedSteamV2.js";
import { seasonRegistrationKey } from "./seasonRanks.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const KEY = seasonRegistrationKey(2);
const DEADLINE = new Date("2026-10-20T23:59:59-03:00");

const clean = (value: unknown, max = 180) => String(value ?? "").trim().slice(0, max);
const registrationOpen = () => Date.now() <= DEADLINE.getTime();

async function ensureTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_official_registrations (
    season_key INTEGER NOT NULL, discord_id TEXT NOT NULL, discord_name TEXT NOT NULL, steam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    mp_payment_id TEXT, mp_preference_id TEXT, full_name TEXT, contact_email TEXT,
    prize_pix_type TEXT, prize_pix_key TEXT, entry_type TEXT, accepted_terms_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(season_key,discord_id)
  )`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS entry_type TEXT`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ`);
}

router.post("/season/2/inscricao-oficial/free", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ error: "Entre com Discord para continuar." });
  if (!registrationOpen()) return void res.status(410).json({ error: "As inscrições da Season 2 foram encerradas." });

  try {
    await ensureTable();
    const linked = await getLinkedSteamV2(session.userId);
    if (!linked?.steamId) return void res.status(409).json({ error: "Vincule sua Steam antes de confirmar a inscrição." });

    const fullName = clean(req.body?.fullName, 120);
    const contactEmail = clean(req.body?.contactEmail, 180).toLowerCase();
    const accepted = req.body?.accept === true;
    if (fullName.split(/\s+/).length < 2) return void res.status(400).json({ error: "Informe seu nome completo." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) return void res.status(400).json({ error: "Informe um e-mail válido." });
    if (!accepted) return void res.status(400).json({ error: "Aceite o regulamento da Season 2 para continuar." });

    const duplicate: any = await db.execute(sql`
      SELECT discord_id FROM season_official_registrations
      WHERE season_key=${KEY} AND steam_id=${linked.steamId} AND status='active' AND discord_id<>${session.userId}
      LIMIT 1
    `);
    if (duplicate?.rows?.[0]) return void res.status(409).json({ error: "Esta Steam já está inscrita na Season 2 por outra conta Discord." });

    await db.execute(sql`
      INSERT INTO season_official_registrations(
        season_key,discord_id,discord_name,steam_id,status,amount,full_name,contact_email,
        prize_pix_type,prize_pix_key,entry_type,accepted_terms_at,mp_payment_id,mp_preference_id,paid_at,updated_at
      ) VALUES(
        ${KEY},${session.userId},${session.username},${linked.steamId},'active',0,${fullName},${contactEmail},
        NULL,NULL,'free',now(),NULL,NULL,NULL,now()
      ) ON CONFLICT(season_key,discord_id) DO UPDATE SET
        discord_name=EXCLUDED.discord_name,steam_id=EXCLUDED.steam_id,status='active',amount=0,
        full_name=EXCLUDED.full_name,contact_email=EXCLUDED.contact_email,prize_pix_type=NULL,prize_pix_key=NULL,
        entry_type='free',accepted_terms_at=now(),mp_payment_id=NULL,mp_preference_id=NULL,paid_at=NULL,updated_at=now()
    `);

    logger.info({ discordId: session.userId, steamId: linked.steamId }, "Season 2 free registration activated");
    return void res.json({ ok: true, registered: true, entryType: "free", amount: 0 });
  } catch (error) {
    logger.error({ error }, "Season 2 free registration failed");
    return void res.status(500).json({ error: error instanceof Error ? error.message : "Falha ao concluir inscrição gratuita." });
  }
});

export function season2FreeRegistrationUi(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || (req.path !== "/season/2/inscricao-oficial" && req.path !== "/season/2/regras")) return next();
  const originalSend = res.send.bind(res);
  res.send = ((body?: any) => {
    if (typeof body !== "string" || !/<html/i.test(body)) return originalSend(body);
    let html = body;

    if (req.path === "/season/2/inscricao-oficial") {
      html = html
        .replace("As inscrições pagas já estão abertas por <b>R$ 20</b>.", "Escolha entre <b>inscrição gratuita</b> ou <b>inscrição paga por R$ 20</b>.")
        .replace("<small>INSCRIÇÃO</small><b>R$ 20</b>", "<small>INSCRIÇÃO</small><b>GRÁTIS / R$ 20</b>")
        .replace("Depois você volta automaticamente para concluir a inscrição e o pagamento.", "Depois você volta automaticamente para escolher entre a inscrição gratuita e a paga.")
        .replace("<h2>Inscrição paga • R$ 20</h2>", "<h2>Escolha sua modalidade</h2><div style=\"display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 18px\"><div style=\"border:1px solid #256f82;background:#0b1b20;border-radius:14px;padding:14px\"><b style=\"color:#8be9ff\">🆓 GRATUITA</b><p style=\"margin:6px 0 0\">Participa oficialmente da Season e do ranking, sem cobrança.</p></div><div style=\"border:1px solid #80611f;background:#191408;border-radius:14px;padding:14px\"><b style=\"color:#fde68a\">💰 PAGA • R$ 20</b><p style=\"margin:6px 0 0\">Modalidade premiada, com pagamento via PIX ou cartão.</p></div></div><h2 style=\"font-size:17px\">Seus dados</h2>")
        .replace("Li e aceito o <a href=\"/api/season/2/regras\" style=\"color:#86efac\">regulamento da Season 2</a> e a cobrança única de R$ 20.", "Li e aceito o <a href=\"/api/season/2/regras\" style=\"color:#86efac\">regulamento da Season 2</a>. A cobrança de R$ 20 acontece somente se eu escolher a modalidade paga.")
        .replace("<div class=\"grid\"><button class=\"btn\" id=\"payPix\">PAGAR R$ 20 COM PIX</button><button class=\"btn\" id=\"payCard\">PAGAR R$ 20 COM CARTÃO</button></div>", "<button class=\"btn\" id=\"joinFree\" type=\"button\" style=\"margin-bottom:10px;background:linear-gradient(135deg,#0e7490,#155e75);border-color:#22d3ee\">INSCREVER-SE GRATUITAMENTE</button><div class=\"grid\"><button class=\"btn\" id=\"payPix\">PAGAR R$ 20 COM PIX</button><button class=\"btn\" id=\"payCard\">PAGAR R$ 20 COM CARTÃO</button></div>");

      if (html.includes('id="joinFree"')) {
        html = html.replace("</body>", `<script>
(function(){
  const btn=document.getElementById('joinFree');if(!btn)return;
  btn.addEventListener('click',async function(){
    const name=document.getElementById('name')?.value||'';
    const email=document.getElementById('email')?.value||'';
    const accept=Boolean(document.getElementById('accept')?.checked);
    const msg=document.getElementById('msg');
    if(!accept){if(msg)msg.textContent='Aceite o regulamento para continuar.';return;}
    btn.disabled=true;if(msg){msg.style.color='#cbd5e1';msg.textContent='Confirmando inscrição gratuita...';}
    try{
      const r=await fetch('/api/season/2/inscricao-oficial/free',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:name,contactEmail:email,accept})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Falha ao concluir inscrição');
      if(msg){msg.style.color='#86efac';msg.textContent='✓ Inscrição gratuita confirmada!';}
      setTimeout(()=>location.reload(),700);
    }catch(e){if(msg){msg.style.color='#fca5a5';msg.textContent='❌ '+e.message;}btn.disabled=false;}
  });
})();
</script></body>`);
      }
    }

    if (req.path === "/season/2/regras") {
      html = html.replace(
        "A inscrição custa <b>R$ 20</b> e fica aberta até <b>",
        "A inscrição pode ser <b>gratuita</b> ou <b>paga por R$ 20</b> e fica aberta até <b>"
      );
      html = html.replace(
        "A vaga só é confirmada após aprovação do pagamento.",
        "Na modalidade gratuita, a vaga é confirmada imediatamente após a aceitação do regulamento. Na modalidade paga, a confirmação ocorre após a aprovação do pagamento."
      );
      html = html.replace(
        "<section class=\"card prize\"><h2>2. Premiação garantida",
        "<section class=\"card\"><h2>Modalidades de inscrição</h2><p><b>Gratuita:</b> participa oficialmente do ranking sem cobrança. <b>Paga:</b> custa R$ 20 e mantém a elegibilidade à premiação principal descrita abaixo. A modalidade escolhida fica registrada no painel administrativo.</p></section><section class=\"card prize\"><h2>2. Premiação garantida"
      );
    }

    return originalSend(html);
  }) as any;
  next();
}

export default router;
