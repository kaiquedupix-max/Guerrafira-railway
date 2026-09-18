import { executeRconCommand } from "./rcon.js";

const CUSTOM_ANNOUNCE_OK = "GFANNOUNCE_OK";

function customAnnouncementSucceeded(response: string | null): boolean {
  return typeof response === "string" && response.includes(CUSTOM_ANNOUNCE_OK);
}

export async function sendGameAnnouncement(tag: string, message: string, color = "#ffd65a"): Promise<void> {
  const safeTag = String(tag).replace(/["\r\n]/g, "").slice(0, 40);
  const safeMessage = String(message).replace(/["\r\n]/g, "'").slice(0, 350);
  const formatted = `<color=#ff8c00>[${safeTag}]</color> <color=${color}>${safeMessage}</color>`;

  // O plugin customizado usa chat.add diretamente e evita o prefixo vanilla "[SERVER]".
  const encoded = Buffer.from(formatted, "utf8").toString("base64");
  const customResult = await executeRconCommand(`guerrafria.announce ${encoded}`).catch(() => null);
  if (customAnnouncementSucceeded(customResult)) return;

  // Fallback para não perder avisos caso o plugin esteja indisponível durante reload.
  let result = await executeRconCommand(`say "${formatted}"`).catch(() => null);
  if (result === null) result = await executeRconCommand(`global.say "${formatted}"`).catch(() => null);
  if (result === null) throw new Error("O RCON não confirmou a mensagem no chat do jogo.");
}
