import { Router, type IRouter } from "express";

const router: IRouter = Router();

type RankAsset = { title: string; accent: string; accent2: string; marks: string };

const assets: Record<string, RankAsset> = {
  soldado: {
    title: "Soldado",
    accent: "#8b949e",
    accent2: "#3f4852",
    marks: `<path d="M96 214h128l-22 26H118z" fill="#c7ccd1"/><path d="M112 248h96l-18 22h-60z" fill="#8b949e"/>`,
  },
  tenente: {
    title: "Tenente",
    accent: "#d5d9de",
    accent2: "#737b85",
    marks: `<path d="M160 88l22 35 41 10-28 31 3 42-38-17-38 17 3-42-28-31 41-10z" fill="#f2f4f6" stroke="#858e98" stroke-width="5"/><path d="M92 230h136l-20 27H112z" fill="#d5d9de"/><path d="M111 266h98l-16 22h-66z" fill="#929aa4"/>`,
  },
  major: {
    title: "Major",
    accent: "#d59b3a",
    accent2: "#70451c",
    marks: `<circle cx="160" cy="142" r="54" fill="#291b0d" stroke="#f0bd58" stroke-width="6"/><path d="M160 99l13 27 30 4-22 21 5 30-26-14-26 14 5-30-22-21 30-4z" fill="#f7d477"/><path d="M86 232h148l-21 29H107z" fill="#d59b3a"/><path d="M105 270h110l-17 23h-76z" fill="#9f6725"/>`,
  },
  marechal: {
    title: "Marechal",
    accent: "#cf3f35",
    accent2: "#6d1515",
    marks: `<path d="M94 131l37 9 29-25 29 25 37-9-13 36 22 31-38 1-21 32-16-35-16 35-21-32-38-1 22-31z" fill="#f0c05b" stroke="#7d241d" stroke-width="5"/><path d="M77 238h166l-23 31H100z" fill="#cf3f35"/><path d="M103 279h114l-18 25h-78z" fill="#8f201c"/>`,
  },
  "general-frio": {
    title: "General Frio",
    accent: "#7dd3fc",
    accent2: "#0b5f88",
    marks: `<g stroke="#dff6ff" stroke-linecap="round"><path d="M160 73v145" stroke-width="9"/><path d="M100 109l120 73" stroke-width="9"/><path d="M220 109l-120 73" stroke-width="9"/></g><path d="M160 85l16 33 37 5-27 26 7 37-33-18-33 18 7-37-27-26 37-5z" fill="#f6fdff" stroke="#7dd3fc" stroke-width="5"/><path d="M73 235h174l-24 32H97z" fill="#7dd3fc"/><path d="M100 278h120l-19 26h-82z" fill="#dff6ff"/>`,
  },
};

function svg(a: RankAsset): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 360" role="img" aria-label="Patente ${a.title}"><defs><linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#282d33"/><stop offset=".48" stop-color="#111419"/><stop offset="1" stop-color="#06080b"/></linearGradient><linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a.accent}"/><stop offset="1" stop-color="${a.accent2}"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity=".72"/></filter></defs><g filter="url(#shadow)"><path d="M160 14 282 61l-16 179-106 105L54 240 38 61z" fill="url(#metal)" stroke="url(#edge)" stroke-width="8"/><path d="M160 27 267 68l-15 161-92 92-92-92L53 68z" fill="none" stroke="#ffffff18" stroke-width="3"/>${a.marks}</g></svg>`;
}

router.get("/ranks/:name.svg", (req, res) => {
  const asset = assets[String(req.params.name || "").toLowerCase()];
  if (!asset) return void res.status(404).end();
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  return void res.status(200).send(svg(asset));
});

export default router;
