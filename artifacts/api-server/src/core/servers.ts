export type GuerraFriaServerId = "solo-duo" | "trio";

export type GuerraFriaServerConfig = {
  id: GuerraFriaServerId;
  name: string;
  shortName: string;
  teamSize: string;
  enabled: boolean;
  comingSoon: boolean;
  hostEnv: string;
  portEnv: string;
  rconHostEnv: string;
  rconPortEnv: string;
  rconPasswordEnv: string;
  botTokenEnv: string;
  botClientIdEnv: string;
};

export const GUERRA_FRIA_SERVERS: Record<GuerraFriaServerId, GuerraFriaServerConfig> = {
  "solo-duo": {
    id: "solo-duo",
    name: "Guerra Fria Solo/Duo",
    shortName: "Solo/Duo",
    teamSize: "Máximo 2 jogadores",
    enabled: true,
    comingSoon: false,
    hostEnv: "RUST_SERVER_HOST",
    portEnv: "RUST_SERVER_PORT",
    rconHostEnv: "RCON_HOST",
    rconPortEnv: "RCON_PORT",
    rconPasswordEnv: "RCON_PASSWORD",
    botTokenEnv: "DISCORD_BOT_TOKEN",
    botClientIdEnv: "DISCORD_CLIENT_ID",
  },
  trio: {
    id: "trio",
    name: "Guerra Fria Trio",
    shortName: "Trio",
    teamSize: "Máximo 3 jogadores",
    enabled: process.env.STORE_TRIO_ENABLED === "true" && Boolean(process.env.TRIO_RCON_HOST && process.env.TRIO_RCON_PORT && process.env.TRIO_RCON_PASSWORD) && ["BRONZE","PRATA","OURO"].every(t => Boolean(process.env[`TRIO_VIP_${t}_GRANT_CMD`] && process.env[`TRIO_VIP_${t}_REVOKE_CMD`])),
    comingSoon: process.env.STORE_TRIO_ENABLED !== "true",
    hostEnv: "TRIO_RUST_SERVER_HOST",
    portEnv: "TRIO_RUST_SERVER_PORT",
    rconHostEnv: "TRIO_RCON_HOST",
    rconPortEnv: "TRIO_RCON_PORT",
    rconPasswordEnv: "TRIO_RCON_PASSWORD",
    botTokenEnv: "TRIO_DISCORD_BOT_TOKEN",
    botClientIdEnv: "TRIO_DISCORD_CLIENT_ID",
  },
};

export function parseServerId(value: unknown): GuerraFriaServerId | null {
  return value === "solo-duo" || value === "trio" ? value : null;
}

export function getServerConfig(value: unknown): GuerraFriaServerConfig | null {
  const id = parseServerId(value);
  return id ? GUERRA_FRIA_SERVERS[id] : null;
}

export function isServerPurchasable(value: unknown): value is GuerraFriaServerId {
  const server = getServerConfig(value);
  return Boolean(server?.enabled && !server?.comingSoon);
}
