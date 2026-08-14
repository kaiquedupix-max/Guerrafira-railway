import type { Request } from "express";
import { cleanAdminHtml } from "./panelClean.js";
import { cleanAdminJs } from "./panelCleanJs.js";
import { getAdminSession } from "./sessionCookie.js";

const page = cleanAdminHtml.replace("</body>", `<script>${cleanAdminJs}</script></body>`);

export function renderAdmin(req: Request): string {
  const session = getAdminSession(req);
  if (!session) return page;
  const username = String(session.username ?? "Administrador")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return page.replace('<div id="username" class="user">Administrador</div>', `<div id="username" class="user">${username}</div>`);
}
