import type { Request } from "express";
import { renderAdminPage } from "./renderAdminPage2.js";
export function renderAdmin(req: Request): string { return renderAdminPage(req); }
