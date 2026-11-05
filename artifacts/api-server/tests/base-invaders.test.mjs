import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const built = await build({
  entryPoints: ["src/routes/baseInvadersPage.ts"],
  bundle: true, platform: "node", format: "esm", write: false,
});
const page = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));

test("Base Invaders shows a free trio event of five hours with an unannounced Saturday", () => {
  const dom = new JSDOM(page.renderBaseInvadersPage(null));
  const text = dom.window.document.body.textContent;
  assert.match(text, /BASE\s*INVADERS/i);
  assert.match(text, /5 HORAS/);
  assert.match(text, /SÁBADO/);
  assert.match(text, /Data e horário a definir/);
  assert.match(text, /TRIOS • GRÁTIS/);
  assert.equal(dom.window.document.querySelectorAll(".phase").length, 3);
  assert.match(text, /Build/);
  assert.match(text, /Attack/);
  assert.match(text, /Raid/);
  assert.ok(dom.window.document.querySelector('a[href*="target=base-invaders"]'));
  assert.equal(dom.window.document.querySelector("#bi-form"), null);
  dom.window.close();
});

test("Discord-authenticated captain receives exactly three SteamID64 fields and a free signup", () => {
  const session = { userId:"123", username:"Capitão", isAdmin:false, exp: Date.now() + 1000 };
  const dom = new JSDOM(page.renderBaseInvadersPage(session));
  const doc = dom.window.document;
  assert.ok(doc.querySelector("#bi-form"));
  assert.equal(doc.querySelectorAll(".player").length, 3);
  assert.equal(doc.querySelectorAll('input[name^="steam"]').length, 3);
  assert.ok(doc.querySelector('input[name="teamName"]'));
  assert.ok(doc.querySelector('input[name="accept"][required]'));
  assert.match(doc.querySelector("#bi-submit").textContent, /GRATUITA/);
  assert.equal(doc.querySelector(".adminTeams"), null);
  dom.window.close();
});

test("Retired Season synchronizers are not started and registrations are persistent", async () => {
  const routes = await readFile("src/routes/index.ts", "utf8");
  const bot = await readFile("src/bot/index.ts", "utf8");
  const registration = await readFile("src/routes/baseInvaders.ts", "utf8");
  assert.doesNotMatch(routes, /startSeason2GameRankSync\s*\(/);
  assert.doesNotMatch(bot, /startSeason2DiscordRankSync\s*\(/);
  assert.match(routes, /startSeasonGameRetirement\s*\(/);
  assert.match(bot, /startSeasonDiscordRetirement\s*\(/);
  assert.match(registration, /CREATE TABLE IF NOT EXISTS base_invaders_teams/);
  assert.match(registration, /Array\.isArray\(input\).*input\.length !== 3/);
});
