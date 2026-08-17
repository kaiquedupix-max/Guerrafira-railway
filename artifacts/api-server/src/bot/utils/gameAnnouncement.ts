import { executeRconCommand } from "./rcon.js";

export async function sendGameAnnouncement(tag: string, message: string, color = "#ffd65a"): Promise<void> {
  const safeTag = String(tag).replace(/["\r\n]/g, "").slice(0, 40);
  const safeMessage = String(message).replace(/["\r\n]/g, "'").slice(0, 350);
  const formatted = `<color=#ff8c00>[${safeTag}]</color> <color=${color}>${safeMessage}</color>`;
  let result = await executeRconCommand(`say "${formatted}"`).catch(() => null);
  if (result === null) result = await executeRconCommand(`global.say "${formatted}"`).catch(() => null);
  if (result === null) throw new Error("O RCON não confirmou a mensagem no chat do jogo.");
}
