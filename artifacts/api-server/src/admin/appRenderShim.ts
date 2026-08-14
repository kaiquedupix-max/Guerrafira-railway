import type { Request } from "express";
import { panelV5Html } from "./panelV5.js";
import { panelV5Js } from "./panelV5Js.js";
import { panelV5PolishJs } from "./panelV5Polish.js";
import { panelAuthRecoveryJs } from "./panelAuthRecovery.js";
import { panelOverviewFastJs } from "./panelOverviewFast.js";
import { panelModerationParityJs } from "./panelModerationParity.js";
import { getAdminSessionV3 } from "./sessionBearer.js";

const page = panelV5Html.replace("</body>", `<script>${panelV5Js}</script><script>${panelV5PolishJs}</script><script>${panelAuthRecoveryJs}</script><script>${panelOverviewFastJs}</script><script>${panelModerationParityJs}</script></body>`);

export function renderAdmin(req: Request): string {
  const session = getAdminSessionV3(req);
  if (!session) return page;
  const username = String(session.username ?? "Administrador")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return page.replace('<div id="username">Administrador</div>', `<div id="username">${username}</div>`);
}
