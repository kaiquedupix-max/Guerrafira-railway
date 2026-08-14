import { Router } from "express";
import { discordClient } from "../bot/client.js";
import { createRaffle } from "../bot/raffle.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.get("/members", async (req, res) => {
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  const q = clean(req.query.q, 60);
  if (!client || !guildId) return res.status(503).json({ error: "Discord indisponível." });

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return res.status(404).json({ error: "Servidor do Discord não encontrado." });

  let members;
  try {
    members = q
      ? await guild.members.search({ query: q, limit: 25 })
      : await guild.members.fetch({ limit: 25 });
  } catch {
    members = guild.members.cache;
  }

  const query = q.toLowerCase();
  const rows = Array.from(members.values())
    .filter(m => !m.user.bot)
    .filter(m => !query || m.displayName.toLowerCase().includes(query) || m.user.username.toLowerCase().includes(query) || m.id.includes(query))
    .slice(0, 25)
    .map(m => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName,
      avatar: m.displayAvatarURL({ size: 64 }),
    }));

  res.json({ members: rows });
});

router.post("/raffle", async (req, res) => {
  const client = discordClient();
  if (!client) return res.status(503).json({ error: "Bot do Discord ainda não está pronto." });
  const tier = clean(req.body?.tier, 16) as "bronze" | "prata" | "ouro";
  const vipDays = Number(req.body?.vipDays);
  const hours = Number(req.body?.hours);
  if (!["bronze","prata","ouro"].includes(tier) || ![3,7,30].includes(vipDays) || ![1,6,12,24,72,168].includes(hours)) return res.status(400).json({ error: "Configuração inválida." });
  const admin = res.locals.admin as { userId: string };
  await createRaffle({ client, tier, vipDurationDays: vipDays, raffleHours: hours, createdBy: admin.userId });
  await executeRconCommand(`say [SORTEIO] Novo sorteio de VIP ${tier.toUpperCase()} no Discord! Acesse discord.gg/guerrafria para participar.`).catch(() => {});
  res.json({ ok: true });
});

router.post("/message", async (req, res) => {
  const client = discordClient();
  const channelId = clean(req.body?.channelId, 32);
  const message = clean(req.body?.message, 1800);
  if (!client || !channelId || !message) return res.status(400).json({ error: "Canal ou mensagem inválidos." });
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return res.status(404).json({ error: "Canal não encontrado." });
  await channel.send(message);
  res.json({ ok: true });
});

export default router;
