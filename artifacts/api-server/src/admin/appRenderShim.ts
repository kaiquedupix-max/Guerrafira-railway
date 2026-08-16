import type { Request } from "express";
import { panelV5Html } from "./panelV5.js";
import { panelV5Js } from "./panelV5Js.js";
import { panelV5PolishJs } from "./panelV5Polish.js";
import { panelAuthRecoveryJs } from "./panelAuthRecovery.js";
import { panelOverviewFastJs } from "./panelOverviewFast.js";
import { panelModerationParityJs } from "./panelModerationParity.js";
import { panelIntegrityManagerJs } from "./panelIntegrityManager.js";
import { panelAlertsJs } from "./panelAlerts.js";
import { panelSlotControlJs } from "./panelSlotControl.js";
import { panelBrandingJs } from "./panelBranding.js";
import { panelMobileFixJs } from "./panelMobileFix.js";
import { panelFinanceLabelsJs } from "./panelFinanceLabels.js";
import { getAdminSessionV3 } from "./sessionBearer.js";

const page = panelV5Html.replace("</body>", `<script>${panelV5Js}</script><script>${panelV5PolishJs}</script><script>${panelAuthRecoveryJs}</script><script>${panelOverviewFastJs}</script><script>${panelModerationParityJs}</script><script>${panelIntegrityManagerJs}</script><script>${panelAlertsJs}</script><script>${panelSlotControlJs}</script><script>${panelBrandingJs}</script><script>${panelMobileFixJs}</script><script>${panelFinanceLabelsJs}</script></body>`);

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
