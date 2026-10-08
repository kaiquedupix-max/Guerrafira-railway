import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const DUO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export function duoSecret(): string {
  const secret = process.env.DUO_TOKEN_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET;
  if (!secret?.trim()) throw new Error("Configure DUO_TOKEN_SECRET ou ADMIN_SESSION_SECRET para habilitar o Super Combo Duo.");
  return secret.trim();
}
export function duoToken(id: number, nonce: string): string {
  return createHmac("sha256", duoSecret()).update(`duo:${id}:${nonce}`).digest("base64url");
}
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function tokenMatches(token: string, hash: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token) && /^[a-f0-9]{64}$/.test(hash) &&
    timingSafeEqual(Buffer.from(tokenHash(token), "hex"), Buffer.from(hash, "hex"));
}
export function claimProblem(row: { status: string; expires_at: Date; duo_discord_id: string | null; duo_steam_id: string | null },
  buyerDiscord: string, buyerSteam: string, discord: string, steam: string, now = Date.now()): string | null {
  if (buyerDiscord === discord || buyerSteam === steam) return "O comprador não pode resgatar a vaga do duo.";
  if (row.duo_discord_id && (row.duo_discord_id !== discord || row.duo_steam_id !== steam)) return "Este link já foi utilizado por outro duo.";
  if (row.status === "redeemed") return "Este combo já foi resgatado.";
  // A bound claim survives expiration so partial delivery can be retried safely.
  if (!row.duo_discord_id && new Date(row.expires_at).getTime() <= now) return "Este link de resgate expirou.";
  return null;
}
