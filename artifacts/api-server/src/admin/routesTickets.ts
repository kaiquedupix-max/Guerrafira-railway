import { Router } from "express";
import { ChannelType, PermissionFlagsBits, type TextChannel } from "discord.js";
import { discordClient } from "../bot/client.js";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);

const ticketCategory = () => String(process.env.DISCORD_TICKETS_CATEGORY_ID || "").trim();
const guildId = () => String(process.env.DISCORD_GUILD_ID || "").trim();
const validId = (value: unknown) => /^\d{15,22}$/.test(String(value || ""));
const isTicket = (channel: any): channel is TextChannel =>
  channel?.type === ChannelType.GuildText &&
  /^ticket[-_]/i.test(channel.name || "") &&
  Boolean(ticketCategory()) &&
  channel.parentId === ticketCategory();

async function getGuild() {
  const client = discordClient();
  if (!client || !guildId() || !ticketCategory()) return null;
  return client.guilds.fetch(guildId()).catch(() => null);
}

router.get("/", async (_req, res) => {
  try {
    const guild = await getGuild();
    if (!guild) return res.status(503).json({ error: "Configure DISCORD_GUILD_ID e DISCORD_TICKETS_CATEGORY_ID e conecte o bot." });
    const channels = await guild.channels.fetch();
    const tickets = [...channels.values()].filter(isTicket).map(c => ({
      id: c.id, name: c.name, topic: c.topic, createdAt: c.createdAt?.toISOString() || null,
      url: `https://discord.com/channels/${guild.id}/${c.id}`,
    })).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ tickets });
  } catch { return res.status(502).json({ error: "Não foi possível carregar tickets do Discord." }); }
});

router.get("/:id/messages", async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  try {
    const guild = await getGuild();
    if (!guild) return res.status(503).json({ error: "Discord indisponível ou categoria não configurada." });
    const channel = await guild.channels.fetch(String(req.params.id)).catch(() => null);
    if (!isTicket(channel)) return res.status(404).json({ error: "Ticket não encontrado." });
    const before = validId(req.query.before) ? String(req.query.before) : undefined;
    const items = await channel.messages.fetch({ limit: 50, ...(before ? { before } : {}) });
    return res.json({ messages: [...items.values()].reverse().map(m => ({
      id: m.id, author: m.author?.username || "Desconhecido", authorId: m.author?.id,
      avatar: m.author?.displayAvatarURL({ size: 64 }) || null,
      content: m.content, createdAt: m.createdAt.toISOString(), bot: Boolean(m.author?.bot),
      attachments: [...m.attachments.values()].map(a => ({ name: a.name, url: a.url })),
    })) });
  } catch { return res.status(502).json({ error: "Falha ao buscar mensagens." }); }
});

router.post("/:id/reply", async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const content = String(req.body?.content || "").trim();
  if (!content || content.length > 1800) return res.status(400).json({ error: "Mensagem deve conter de 1 a 1800 caracteres." });
  try {
    const guild = await getGuild();
    if (!guild) return res.status(503).json({ error: "Discord indisponível ou categoria não configurada." });
    const channel = await guild.channels.fetch(String(req.params.id)).catch(() => null);
    if (!isTicket(channel)) return res.status(404).json({ error: "Ticket não encontrado." });
    const admin = res.locals.admin as { username?: string; userId?: string };
    const memberId = String(admin?.userId || "");
    // Somente administradores com acesso ao ticket podem escrever pelo painel.
    const member = validId(memberId) ? await guild.members.fetch(memberId).catch(() => null) : null;
    if (!member || !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))
      return res.status(403).json({ error: "Você não possui acesso a este ticket." });
    const sent = await channel.send({
      content: "**Equipe Guerra Fria • " + String(admin?.username || "Admin").replace(/[@*_|]/g, "").slice(0, 60) + ":**\n" + content,
      allowedMentions: { parse: [] },
    });
    return res.json({ ok: true, id: sent.id });
  } catch { return res.status(502).json({ error: "Não foi possível enviar a resposta." }); }
});

export default router;
