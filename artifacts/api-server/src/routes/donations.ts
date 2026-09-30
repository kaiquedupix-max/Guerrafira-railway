import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createPixPayment } from "../bot/mp.js";
import { getCommunitySession } from "../admin/communitySession.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function ensureDonationTable(){
  await db.execute(sql`CREATE TABLE IF NOT EXISTS server_donations (
    id TEXT PRIMARY KEY,
    discord_id TEXT,
    donor_name TEXT,
    contact_email TEXT NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    mp_payment_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS server_donations_status_idx ON server_donations(status,approved_at DESC)`);
}

function amountValue(value:unknown){
  const amount=Math.round(Number(value)*100)/100;
  return Number.isFinite(amount)?amount:0;
}

function emailValue(value:unknown){return String(value??"").trim().toLowerCase().slice(0,180);}
function nameValue(value:unknown){return String(value??"").trim().slice(0,100);}

router.get("/donations/stats",async(_req,res)=>{
  try{
    await ensureDonationTable();
    const result:any=await db.execute(sql`SELECT COUNT(*)::int donations,COALESCE(SUM(amount),0)::numeric total FROM server_donations WHERE status='approved'`);
    const row=result?.rows?.[0]||{};
    res.setHeader("Cache-Control","no-store");
    return void res.json({ok:true,donations:Number(row.donations||0),total:Number(row.total||0)});
  }catch(error){logger.error({error},"donation stats failed");return void res.status(500).json({error:"Falha ao carregar doações."});}
});

router.post("/donations/pix",async(req,res)=>{
  try{
    await ensureDonationTable();
    const amount=amountValue(req.body?.amount);
    const email=emailValue(req.body?.email);
    const donorName=nameValue(req.body?.name);
    if(amount<5||amount>1000)return void res.status(400).json({error:"Escolha um valor entre R$ 5 e R$ 1.000."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))return void res.status(400).json({error:"Informe um e-mail válido para gerar o PIX."});
    const session=getCommunitySession(req);
    const id=randomUUID();
    await db.execute(sql`INSERT INTO server_donations(id,discord_id,donor_name,contact_email,amount,status,updated_at)
      VALUES(${id},${session?.userId||null},${donorName||null},${email},${amount},'creating',now())`);
    const payment=await createPixPayment({
      amount,
      description:"Doação voluntária • Guerra Fria Rust",
      email,
      discordUserId:`donation:${id}`,
      steamId:"0",
      vipTier:"server_donation",
    });
    if("error"in payment){
      await db.execute(sql`UPDATE server_donations SET status='failed',updated_at=now() WHERE id=${id}`);
      return void res.status(502).json({error:payment.error});
    }
    await db.execute(sql`UPDATE server_donations SET status='pending',mp_payment_id=${payment.paymentId},updated_at=now() WHERE id=${id}`);
    return void res.json({ok:true,paymentId:payment.paymentId,qrCode:payment.qrCode,qrCodeBase64:payment.qrCodeBase64,expiresAt:payment.expiresAt,amount});
  }catch(error){logger.error({error},"donation PIX failed");return void res.status(500).json({error:"Não foi possível gerar a doação agora."});}
});

export async function processDonationPayment(payment:Record<string,unknown>):Promise<boolean>{
  const metadata=(payment?.metadata??{}) as Record<string,unknown>;
  if(String(metadata.vip_tier??"")!=="server_donation")return false;
  try{
    await ensureDonationTable();
    const paymentId=String(payment.id??"").trim();
    const status=String(payment.status??"pending").trim();
    const donorRef=String(metadata.discord_user_id??"").trim();
    const donationId=donorRef.startsWith("donation:")?donorRef.slice("donation:".length):"";
    if(!paymentId&&!donationId)return true;
    if(status==="approved"){
      await db.execute(sql`UPDATE server_donations SET status='approved',mp_payment_id=COALESCE(mp_payment_id,${paymentId||null}),approved_at=COALESCE(approved_at,now()),updated_at=now() WHERE mp_payment_id=${paymentId} OR id=${donationId}`);
      logger.info({paymentId,donationId,amount:payment.transaction_amount},"Server donation approved");
    }else{
      await db.execute(sql`UPDATE server_donations SET status=${status},mp_payment_id=COALESCE(mp_payment_id,${paymentId||null}),updated_at=now() WHERE mp_payment_id=${paymentId} OR id=${donationId}`);
    }
    return true;
  }catch(error){
    logger.error({error,paymentId:payment?.id},"Donation reconciliation failed");
    return true;
  }
}

export function renderDonationPage(username=""):string{
  const who=username?`<span class="who">Discord: <b>${String(username).replace(/[&<>"']/g,"")}</b></span>`:"";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#080a0d"><title>Doar • Guerra Fria</title><style>
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#4b32132b,transparent 35%),#080a0d;color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh}.w{width:min(1000px,calc(100% - 24px));margin:auto;padding:38px 0 90px}.hero{text-align:center;max-width:780px;margin:auto}.ey{display:inline-flex;border:1px solid #d49a3760;background:#d49a3712;color:#f8cf83;border-radius:999px;padding:8px 11px;font-size:9px;font-weight:1000;letter-spacing:.15em}.hero h1{font-size:clamp(42px,8vw,72px);line-height:.94;letter-spacing:-.055em;margin:15px 0 10px}.hero h1 span{color:#fbbf24}.hero p{color:#aab2bd;line-height:1.7;font-size:13px}.who{display:inline-flex;margin-top:10px;color:#9ca3af;font-size:10px}.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:650px;margin:22px auto}.stat{border:1px solid #41351f;background:#121008;border-radius:16px;padding:15px;text-align:center}.stat small{display:block;color:#807969;font-size:8px;letter-spacing:.1em}.stat b{display:block;color:#fde68a;font-size:24px;margin-top:5px}.card{max-width:720px;margin:12px auto;border:1px solid #303640;background:linear-gradient(180deg,#10141a,#0b0e12);border-radius:22px;padding:22px}.notice{border-color:#315d43;background:linear-gradient(145deg,#0d2016,#0b1010)}.notice b{color:#86efac}.amounts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:15px 0}.amt{height:48px;border:1px solid #57431e;background:#181307;color:#fde68a;border-radius:12px;font-weight:1000;cursor:pointer}.amt.active{border-color:#fbbf24;background:#3a2908;color:#fff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field label{display:block;color:#8f98a5;font-size:9px;font-weight:900;margin-bottom:6px}.field input{width:100%;height:48px;border:1px solid #343b45;border-radius:11px;background:#080b0f;color:#fff;padding:0 12px}.btn{width:100%;height:52px;margin-top:13px;border:1px solid #f59e0b;border-radius:13px;background:linear-gradient(135deg,#d18a18,#7c4708);color:#fff;font-weight:1000;cursor:pointer}.msg{margin-top:10px;color:#fca5a5;font-size:11px;text-align:center}.qr{display:none;text-align:center;margin-top:16px}.qr.show{display:block}.qr img{width:220px;height:220px;background:#fff;border-radius:14px;padding:9px}.code{margin-top:9px;border:1px solid #343b45;background:#080b0f;border-radius:10px;padding:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:9px}.copy{height:40px;margin-top:8px;border:1px solid #4a515a;background:#15191f;color:#fff;border-radius:10px;font-weight:900}.fine{color:#777f89;font-size:9px;line-height:1.55;margin-top:13px}@media(max-width:650px){.amounts,.grid,.stats{grid-template-columns:1fr 1fr}.card{padding:17px}}@media(max-width:420px){.grid{grid-template-columns:1fr}}
</style></head><body><main class="w"><section class="hero"><span class="ey">💛 APOIE O GUERRA FRIA</span><h1>Ajude o servidor a <span>continuar crescendo.</span></h1><p>A doação é voluntária e ajuda com dedicado, infraestrutura, proteção, desenvolvimento, eventos e operação do Guerra Fria.</p>${who}</section><div class="stats"><div class="stat"><small>DOAÇÕES CONFIRMADAS</small><b id="count">—</b></div><div class="stat"><small>TOTAL APOIADO</small><b id="total">—</b></div></div><section class="card notice"><b>Competição continua justa.</b><p>Doar não concede XP, patente, posição no ranking ou qualquer vantagem competitiva. A premiação de <b>R$ 500 da Season 2 é garantida</b> e não depende das doações.</p></section><section class="card"><h2>Fazer uma doação via PIX</h2><p style="color:#9ca3af;font-size:11px;line-height:1.6">Escolha um valor ou digite quanto deseja apoiar. O QR Code é gerado pelo Mercado Pago.</p><div class="amounts"><button class="amt" data-v="10">R$ 10</button><button class="amt" data-v="20">R$ 20</button><button class="amt" data-v="50">R$ 50</button><button class="amt" data-v="100">R$ 100</button></div><div class="grid"><div class="field"><label>VALOR PERSONALIZADO</label><input id="amount" type="number" min="5" max="1000" step="1" placeholder="Ex.: 25"></div><div class="field"><label>NOME / APELIDO (OPCIONAL)</label><input id="name" maxlength="100" placeholder="Como quer ser identificado"></div><div class="field" style="grid-column:1/-1"><label>E-MAIL PARA O PAGAMENTO</label><input id="email" type="email" placeholder="voce@email.com"></div></div><button class="btn" id="pay">GERAR PIX PARA DOAÇÃO</button><div class="msg" id="msg"></div><div class="qr" id="qr"><img id="qrImg" alt="QR Code PIX"><div class="code" id="code"></div><button class="copy" id="copy">COPIAR PIX</button></div><div class="fine">Doações são voluntárias e destinadas ao custeio e evolução do servidor. Nenhuma recompensa competitiva é vinculada ao valor doado.</div></section></main><script>
(function(){const amount=document.getElementById('amount'),msg=document.getElementById('msg'),qr=document.getElementById('qr');document.querySelectorAll('.amt').forEach(b=>b.onclick=()=>{document.querySelectorAll('.amt').forEach(x=>x.classList.remove('active'));b.classList.add('active');amount.value=b.dataset.v});fetch('/api/donations/stats',{cache:'no-store'}).then(r=>r.json()).then(d=>{document.getElementById('count').textContent=Number(d.donations||0).toLocaleString('pt-BR');document.getElementById('total').textContent='R$ '+Number(d.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}).catch(()=>{});document.getElementById('pay').onclick=async function(){this.disabled=true;msg.style.color='#fbbf24';msg.textContent='Gerando seu PIX...';qr.className='qr';try{const r=await fetch('/api/donations/pix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amount.value,name:document.getElementById('name').value,email:document.getElementById('email').value})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Falha ao gerar PIX');document.getElementById('qrImg').src='data:image/png;base64,'+d.qrCodeBase64;document.getElementById('code').textContent=d.qrCode;qr.className='qr show';msg.style.color='#86efac';msg.textContent='PIX gerado. Obrigado por apoiar o Guerra Fria 💛'}catch(e){msg.style.color='#fca5a5';msg.textContent=e.message}finally{this.disabled=false}};document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById('code').textContent||'');msg.style.color='#86efac';msg.textContent='PIX copiado ✓'}catch{}}})();
</script></body></html>`;
}

export default router;
