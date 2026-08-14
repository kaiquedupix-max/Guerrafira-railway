import type { Request } from "express";
import { safeAdminHtml } from "./safeHtml.js";
import { adminExtraJs } from "./extra.js";
import { memberPickerJs } from "./memberPicker.js";
import { getAdminSession } from "./sessionCookie.js";

const basePage = safeAdminHtml.replace("</body>", `<script>${adminExtraJs}</script><script>${memberPickerJs}</script></body>`);

export function renderAdminPage(req: Request): string {
  const session = getAdminSession(req);
  if (!session) return basePage;

  const username = String(session.username ?? "Administrador")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return basePage
    .replace('id="login" class="login" style="display:block"', 'id="login" class="login" style="display:none"')
    .replace('id="app" class="shell" style="display:none"', 'id="app" class="shell" style="display:grid"')
    .replace('<span id="username">Administrador</span>', `<span id="username">${username}</span>`);
}
