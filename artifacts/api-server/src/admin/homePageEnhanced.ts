import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";
import { publicMilitaryThemeCss } from "./publicMilitaryTheme.js";

export function renderHome(req: Request): string {
  return renderBaseHome(req).replace("</head>", `${publicMilitaryThemeCss}</head>`);
}
