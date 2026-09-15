import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/**
 * A home possui identidade visual própria e não deve receber os overrides
 * globais do publicMilitaryTheme, pois eles limitavam a largura e alteravam
 * as proporções do layout aprovado.
 */
export function renderHome(req: Request): string {
  return renderBaseHome(req);
}
