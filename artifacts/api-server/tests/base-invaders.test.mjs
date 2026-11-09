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


test("Main navigation shows Base Invaders instead of Season and points to the actual event", async () => {
  const builtHome = await build({ entryPoints: ["src/admin/homePage.ts"], bundle: true, platform: "node", format: "esm", write: false });
  const home = await import("data:text/javascript;base64," + Buffer.from(builtHome.outputFiles[0].text).toString("base64"));
  const dom = new JSDOM(home.renderHome({ cookies: {} }));
  const link = dom.window.document.querySelector('nav.menu a[href="/base-invaders"]');
  assert.ok(link, "O menu deve apontar para a página Base Invaders");
  assert.equal(link.textContent.trim(), "BASE INVADERS");
  assert.equal(dom.window.document.querySelector('nav.menu a[href="/season2"]'), null);
  assert.match(dom.window.document.querySelector(".heroActions").textContent, /BASE INVADERS/);
  dom.window.close();
});

test("Base Invaders copy mentions only Guerra Fria, never third-party event organizers", () => {
  const dom = new JSDOM(page.renderBaseInvadersPage(null));
  const text = dom.window.document.querySelector("main").textContent;
  assert.match(text, /Base Invaders da Guerra Fria/);
  assert.doesNotMatch(text, /Rustoria|Twitch Rivals|inspirado|inspirada/i);
  dom.window.close();
});

test("Legacy Season inscription links navigate to the new event rather than returning a broken page", async () => {
  const apiRoutes = await readFile("src/routes/index.ts", "utf8");
  const homeRoutes = await readFile("src/appSafe.ts", "utf8");
  assert.match(apiRoutes, /res\.redirect\(302,"\/base-invaders#inscricao"\)/);
  assert.match(homeRoutes, /app\.get\("\/base-invaders"/);
  assert.match(homeRoutes, /res\.redirect\(301,"\/base-invaders"\)/);
});

test("Registration offers closed trio and individual random draw on event day", async () => {
  const session = { userId: "123", username: "Participante", isAdmin: false, exp: Date.now() + 1000 };
  const dom = new JSDOM(page.renderBaseInvadersPage(session));
  const doc = dom.window.document;
  assert.ok(doc.querySelector('input[name="registrationMode"][value="trio"]'));
  assert.ok(doc.querySelector('input[name="registrationMode"][value="random"]'));
  assert.ok(doc.querySelector("#bi-trio-fields"));
  assert.ok(doc.querySelector("#bi-random-fields[hidden][disabled]"));
  assert.ok(doc.querySelector('input[name="soloName"]'));
  assert.ok(doc.querySelector('input[name="soloSteamId"]'));
  assert.match(doc.body.textContent, /dia do evento/i);
  assert.match(doc.body.textContent, /sorteio/i);
  const code = await readFile("src/routes/baseInvaders.ts", "utf8");
  assert.ok(code.includes("ADD COLUMN IF NOT EXISTS registration_mode"));
  assert.ok(code.includes("parseSinglePlayer"));
  assert.ok(code.includes('registrationMode === "random"'));
  assert.ok(code.includes("players[1]?.steamId"));
  assert.ok(code.includes("SELECT id,team_name,registration_mode,players,status,created_at"));
  dom.window.close();
});

test("Registration confirmation has a dedicated protected page", async () => {
  const confirmationCode = await readFile("src/routes/baseInvadersConfirmationPage.ts", "utf8");
  const app = await readFile("src/appSafe.ts", "utf8");
  assert.ok(confirmationCode.includes("Inscrição <em>confirmada!</em>"));
  assert.ok(confirmationCode.includes("aguardando aprovação"));
  assert.ok(confirmationCode.includes("no dia do evento"));
  assert.ok(confirmationCode.includes("/api/base-invaders/minha-inscricao"));
  assert.ok(app.includes('app.get("/base-invaders/inscricao-confirmada"'));
  assert.ok(app.includes("renderBaseInvadersConfirmationPage()"));
});
