import { rankIconData } from "./seasonRankIcons.js";

export type SeasonRank = {
  name: string;
  short: string;
  level: number;
  xp: number;
  icon: "soldado" | "tenente" | "major" | "marechal" | "general";
  group: string;
  top1_only?: boolean;
};

const SEASON_1_RANKS: SeasonRank[] = [
  { name: "Soldado", short: "SLD", level: 1, xp: 0, icon: "soldado", group: "season_soldado" },
  { name: "Tenente", short: "TEN", level: 2, xp: 600, icon: "tenente", group: "season_tenente" },
  { name: "Major", short: "MJR", level: 3, xp: 1200, icon: "major", group: "season_major" },
  { name: "Marechal", short: "MAR", level: 4, xp: 1800, icon: "marechal", group: "season_marechal" },
  { name: "General Frio", short: "GFR", level: 5, xp: 1800, icon: "general", group: "season_generalfrio", top1_only: true },
];

const SEASON_2_RANKS: SeasonRank[] = [
  { name: "Recruta", short: "RCT", level: 1, xp: 0, icon: "soldado", group: "season2_recruta" },
  { name: "Soldado I", short: "SL1", level: 2, xp: 300, icon: "soldado", group: "season2_soldado1" },
  { name: "Soldado II", short: "SL2", level: 3, xp: 600, icon: "soldado", group: "season2_soldado2" },
  { name: "Soldado III", short: "SL3", level: 4, xp: 900, icon: "soldado", group: "season2_soldado3" },
  { name: "Sargento I", short: "SG1", level: 5, xp: 1200, icon: "tenente", group: "season2_sargento1" },
  { name: "Sargento II", short: "SG2", level: 6, xp: 1500, icon: "tenente", group: "season2_sargento2" },
  { name: "Sargento III", short: "SG3", level: 7, xp: 1800, icon: "tenente", group: "season2_sargento3" },
  { name: "Tenente I", short: "TN1", level: 8, xp: 2200, icon: "major", group: "season2_tenente1" },
  { name: "Tenente II", short: "TN2", level: 9, xp: 2600, icon: "major", group: "season2_tenente2" },
  { name: "Tenente III", short: "TN3", level: 10, xp: 3000, icon: "major", group: "season2_tenente3" },
  { name: "Coronel I", short: "CL1", level: 11, xp: 3500, icon: "marechal", group: "season2_coronel1" },
  { name: "Coronel II", short: "CL2", level: 12, xp: 4000, icon: "marechal", group: "season2_coronel2" },
  { name: "Coronel III", short: "CL3", level: 13, xp: 4500, icon: "marechal", group: "season2_coronel3" },
  { name: "Marechal", short: "MAR", level: 14, xp: 5200, icon: "marechal", group: "season2_marechal" },
  { name: "General Frio", short: "GFR", level: 15, xp: 5200, icon: "general", group: "season2_generalfrio", top1_only: true },
];

export const SEASON_2_PRIZE = {
  total: 500,
  first: 250,
  second: 150,
  third: "VIP Ouro",
} as const;

export const SEASON_1_END_AT = "2026-10-01T02:59:59.000Z";
export const SEASON_2_START_AT = "2026-10-09T21:30:00.000Z";
export const SEASON_2_END_AT = "2026-11-01T02:59:59.000Z";
export const SEASON_2_START = "09/10/2026 às 18:30";
export const SEASON_2_END = "31/10/2026 às 23:59";
export const SEASON_2_REGISTRATION_DEADLINE = "20/10/2026 às 23:59";

export function ranksForSeason(seasonNumber: number): SeasonRank[] {
  return seasonNumber >= 2 ? SEASON_2_RANKS : SEASON_1_RANKS;
}

export function xpFromMmr(value: unknown, startingMmr = 1000): number {
  const mmr = Number(value);
  const safe = Number.isFinite(mmr) ? mmr : startingMmr;
  return Math.max(0, Math.round((safe - startingMmr) * 9));
}

export function rankForSeason(seasonNumber: number, xpValue: unknown, positionValue: unknown): SeasonRank {
  const ranks = ranksForSeason(seasonNumber);
  const xp = Math.max(0, Math.trunc(Number(xpValue) || 0));
  const position = Math.max(0, Math.trunc(Number(positionValue) || 0));
  const ordinary = ranks.filter(rank => !rank.top1_only);
  const top = ranks.find(rank => rank.top1_only);
  const finalOrdinary = ordinary[ordinary.length - 1];

  if (top && position === 1 && xp >= top.xp) return top;
  return [...ordinary].reverse().find(rank => xp >= rank.xp) || finalOrdinary || ranks[0]!;
}

export function rankProgressForSeason(seasonNumber: number, xpValue: unknown, positionValue: unknown) {
  const xp = Math.max(0, Math.trunc(Number(xpValue) || 0));
  const position = Math.max(0, Math.trunc(Number(positionValue) || 0));
  const ranks = ranksForSeason(seasonNumber);
  const rank = rankForSeason(seasonNumber, xp, position);
  const ordinary = ranks.filter(item => !item.top1_only);
  const top = ranks.find(item => item.top1_only);
  const isTopRank = Boolean(rank.top1_only);
  const ordinaryIndex = ordinary.findIndex(item => item.level === rank.level);
  const next = !isTopRank && ordinaryIndex >= 0 && ordinaryIndex < ordinary.length - 1
    ? ordinary[ordinaryIndex + 1]
    : null;

  let progress = 100;
  if (next) {
    const span = Math.max(1, next.xp - rank.xp);
    progress = Math.max(0, Math.min(100, Math.round(((xp - rank.xp) / span) * 100)));
  }

  const nextCondition = isTopRank
    ? null
    : next
      ? null
      : top
        ? `Você alcançou ${rank.name}. Para conquistar ${top.name}, assuma o Top 1 do ranking.`
        : null;

  return {
    rank,
    next,
    isTopRank,
    progress,
    xpMissing: next ? Math.max(0, next.xp - xp) : 0,
    nextCondition,
  };
}

export function rankImage(rank: SeasonRank): string {
  return rankIconData(rank.icon);
}

export function seasonRegistrationKey(seasonNumber: number): number {
  return 100 + Math.max(1, Math.trunc(Number(seasonNumber) || 1));
}
