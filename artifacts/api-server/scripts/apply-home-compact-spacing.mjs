import fs from "node:fs";

const file = new URL("../src/admin/homePageEnhanced.ts", import.meta.url);

if (!fs.existsSync(file)) {
  throw new Error("homePageEnhanced.ts not found");
}

let src = fs.readFileSync(file, "utf8");

const replacements = [
  [
    ".wrap{width:min(1240px,calc(100% - 64px))!important}",
    ".wrap{width:min(1320px,calc(100% - 48px))!important}",
  ],
  [
    ".heroInner{width:min(1060px,100%)!important;padding:126px 0 116px!important}",
    ".heroInner{width:min(1180px,100%)!important;padding:58px 0 54px!important}",
  ],
  [
    ".ey{font-size:9px!important;margin:22px 0 16px!important}",
    ".ey{font-size:9px!important;margin:16px 0 12px!important}",
  ],
  [
    ".hero p{max-width:720px!important;font-size:14px!important;line-height:1.7!important;margin-top:24px!important}",
    ".hero p{max-width:820px!important;font-size:14px!important;line-height:1.7!important;margin-top:18px!important}",
  ],
  [
    ".quickOptions{max-width:940px!important;margin-top:34px!important;gap:12px!important}",
    ".quickOptions{max-width:1080px!important;margin-top:22px!important;gap:14px!important}",
  ],
  [
    ".facts{max-width:860px!important;margin-top:42px!important}",
    ".facts{max-width:1000px!important;margin-top:24px!important}",
  ],
  [
    ".fact{padding:18px 10px 0!important}",
    ".fact{padding:14px 16px 0!important}",
  ],
  [
    ".section{padding:118px 0!important}",
    ".section{padding:44px 0!important}",
  ],
  [
    ".section h2{font-size:clamp(56px,4.4vw,78px)!important;margin-top:20px!important}",
    ".section h2{font-size:clamp(56px,4.4vw,78px)!important;margin-top:14px!important}",
  ],
  [
    ".lead{max-width:760px!important;font-size:13px!important;line-height:1.7!important;margin-top:18px!important}",
    ".lead{max-width:860px!important;font-size:13px!important;line-height:1.7!important;margin-top:12px!important}",
  ],
  [
    ".prize,.modes,.wipe,.linksGrid{max-width:1080px!important}",
    ".prize,.modes,.wipe,.linksGrid{max-width:1180px!important}",
  ],
  [
    ".prize{min-height:168px!important;margin-top:42px!important}",
    ".prize{min-height:168px!important;margin-top:26px!important}",
  ],
  [
    ".linksGrid{gap:14px!important;margin-top:38px!important}",
    ".linksGrid{gap:16px!important;margin-top:26px!important}",
  ],
];

let changed = 0;
for (const [from, to] of replacements) {
  if (src.includes(to)) continue;
  if (!src.includes(from)) {
    console.warn(`Home spacing target not found: ${from.slice(0, 80)}`);
    continue;
  }
  src = src.replace(from, to);
  changed++;
}

if (changed > 0) {
  fs.writeFileSync(file, src);
  console.log(`Home desktop spacing adjusted (${changed} replacements).`);
} else {
  console.log("Home desktop spacing already adjusted.");
}
