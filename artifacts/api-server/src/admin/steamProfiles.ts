import { logger } from "../lib/logger.js";

export interface SteamProfileSummary {
  steamId: string;
  profileUrl: string;
  avatarUrl: string | null;
  personaName: string | null;
}

const cache = new Map<string, { value: SteamProfileSummary; expiresAt: number }>();
const TTL = 6 * 60 * 60 * 1000;
const validSteamId = (value: string): boolean => /^7656119\d{10}$/.test(value);

function baseProfile(steamId: string): SteamProfileSummary {
  return {
    steamId,
    profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
    avatarUrl: null,
    personaName: null,
  };
}

function fromCache(steamId: string): SteamProfileSummary | null {
  const entry = cache.get(steamId);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

function save(value: SteamProfileSummary): void {
  cache.set(value.steamId, { value, expiresAt: Date.now() + TTL });
}

async function fetchWithSteamApi(steamIds: string[], apiKey: string): Promise<SteamProfileSummary[]> {
  const results: SteamProfileSummary[] = [];
  for (let index = 0; index < steamIds.length; index += 100) {
    const chunk = steamIds.slice(index, index + 100);
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${chunk.join(",")}`,
    );
    if (!response.ok) throw new Error(`Steam API respondeu ${response.status}`);
    const data = await response.json() as {
      response?: { players?: Array<{ steamid: string; profileurl?: string; avatarfull?: string; personaname?: string }> };
    };
    for (const player of data.response?.players ?? []) {
      results.push({
        steamId: player.steamid,
        profileUrl: player.profileurl || `https://steamcommunity.com/profiles/${player.steamid}`,
        avatarUrl: player.avatarfull || null,
        personaName: player.personaname || null,
      });
    }
  }
  return results;
}

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function fetchPublicProfile(steamId: string): Promise<SteamProfileSummary> {
  const fallback = baseProfile(steamId);
  try {
    const response = await fetch(`${fallback.profileUrl}?xml=1`, {
      headers: { "User-Agent": "GuerraFria-Audit/1.0" },
    });
    if (!response.ok) return fallback;
    const xml = await response.text();
    const avatar = xml.match(/<avatarFull><!\[CDATA\[([^\]]+)\]\]><\/avatarFull>/i)?.[1] ?? null;
    const name = xml.match(/<steamID><!\[CDATA\[([^\]]+)\]\]><\/steamID>/i)?.[1] ?? null;
    return { ...fallback, avatarUrl: avatar ? decodeXml(avatar) : null, personaName: name ? decodeXml(name) : null };
  } catch {
    return fallback;
  }
}

export async function getSteamProfileSummaries(rawIds: string[]): Promise<Map<string, SteamProfileSummary>> {
  const ids = [...new Set(rawIds.map(String).filter(validSteamId))];
  const output = new Map<string, SteamProfileSummary>();
  const missing: string[] = [];

  for (const id of ids) {
    const cached = fromCache(id);
    if (cached) output.set(id, cached);
    else missing.push(id);
  }
  if (!missing.length) return output;

  const apiKey = process.env.STEAM_API_KEY?.trim() || process.env.STEAM_WEB_API_KEY?.trim() || "";
  let loaded: SteamProfileSummary[] = [];
  if (apiKey) {
    try {
      loaded = await fetchWithSteamApi(missing, apiKey);
    } catch (err) {
      logger.warn({ err }, "Steam Web API failed; using public profile fallback");
    }
  }

  const loadedIds = new Set(loaded.map(profile => profile.steamId));
  const fallbackIds = missing.filter(id => !loadedIds.has(id));
  for (let index = 0; index < fallbackIds.length; index += 8) {
    const chunk = fallbackIds.slice(index, index + 8);
    loaded.push(...await Promise.all(chunk.map(fetchPublicProfile)));
  }

  for (const profile of loaded) {
    save(profile);
    output.set(profile.steamId, profile);
  }
  for (const id of ids) {
    if (!output.has(id)) {
      const fallback = baseProfile(id);
      save(fallback);
      output.set(id, fallback);
    }
  }
  return output;
}
