const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const requireWorkspace = createRequire(path.join(root, 'package.json'));
const ts = requireWorkspace('typescript');
const discord = createRequire(path.join(root, 'artifacts/api-server/package.json'))('discord.js');
function load(file, mocks, extra = '') {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'artifacts/api-server/src/bot', file), 'utf8') + extra,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, URL, Map, Buffer, process: { env: { VIP_BRONZE_PRICE: '29.90' } },
    require: name => { if (name in mocks) return mocks[name]; throw new Error(`Missing mock: ${name}`); } });
  return exports;
}
(async () => {
  const records = [], requests = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: row => { records.push(row); const result = Promise.resolve(); result.returning = async () => [{ id: records.length }]; return result; } }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  const logger = { info() {}, warn() {}, error() {} };
  const vips = load('vip.ts', { 'discord.js': discord, 'drizzle-orm': {}, '@workspace/db': { db }, './utils/rcon.js': {}, '../lib/logger.js': { logger } });
  assert.equal(vips.VIP_TIERS.bronze.price, 15, 'Bronze must be R$15 even with an old environment override');
  const products = load('vipProducts.ts', { 'drizzle-orm': {}, '@workspace/db': { db }, './vip.js': vips });
  assert.equal(products.VIP_PRODUCTS.combo.price, 70);
  const mp = {
    createPixPayment: async input => { requests.push(input); return { paymentId: 'pix-test', qrCode: 'pix-code' }; },
    createCardPreference: async input => { requests.push(input); return { preferenceId: 'card-test', checkoutUrl: 'https://mercadopago.com/checkout' }; },
  };
  const stripe = { isStripeConfigured: () => true, createStripeCheckout: async input => { requests.push(input); return { sessionId: 'stripe-test', checkoutUrl: 'https://checkout.stripe.com/test' }; } };
  const common = { 'discord.js': discord, '@workspace/db': { db, paymentsTable: {}, boosterLinksTable: {} }, './vipProducts.js': products,
    './mp.js': mp, './utils/qrcode.js': { generateQrCodeBuffer: async () => Buffer.from('qr') }, '../lib/logger.js': { logger } };
  const tickets = load('tickets.ts', common);
  const steam = load('vipSteamLink.ts', { ...common, 'drizzle-orm': { eq() {} }, './stripe.js': stripe, './tickets.js': tickets });
  const linked = load('ticketsLinked.ts', { ...common, 'drizzle-orm': { eq() {} }, './stripe.js': stripe, './tickets.js': tickets,
    './utils/linkedSteamV2.js': { getLinkedSteamV2: async () => null, saveLinkedSteamV2: async () => ({ ok: true, row: { steamId: '76561198000000000' } }) } });
  const server = { name: 'Guerra Fria Solo/Duo', shortName: 'Solo/Duo', enabled: true };
  const purchase = load('vipStorePurchase.ts', { ...common, '../core/servers.js': { GUERRA_FRIA_SERVERS: { 'solo-duo': server, trio: { enabled: false, comingSoon: true } } } });
  const artwork = load('vipArtwork.ts', {});
  const shop = load('vipStore.ts', { ...common, './vipArtwork.js': artwork, './vipStorePurchase.js': purchase,
    './ticketsLinked.js': linked, './booster.js': {}, './moderation.js': {} }, '\nexport { buildCard, VIP_CARDS };');
  const comboCard = shop.buildCard(shop.VIP_CARDS.find(card => card.tier === 'combo'));
  assert.equal(comboCard.row.toJSON().components[0].custom_id, 'vip_store_buy_combo');
  assert.equal(comboCard.row.toJSON().components[0].url, undefined);
  assert.equal(comboCard.embed.toJSON().image.url, artwork.VIP_COMBO_IMAGE_URL);
  let selection;
  await purchase.handleVipStoreBuy({ customId: 'vip_store_buy_combo', reply: async payload => { selection = payload; } });
  assert.equal(selection.components[0].toJSON().components[0].custom_id, 'vip_store_buy_combo_solo-duo');
  let ticketMessage, deferred = false;
  await purchase.handleVipStoreBuy({ customId: 'vip_store_buy_combo_solo-duo', user: { id: 'user', username: 'Tester', tag: 'Tester' },
    client: { user: { id: 'bot' } }, deferReply: async () => { deferred = true; }, editReply: async () => {},
    guild: { roles: { everyone: { id: 'everyone' }, fetch: async () => {}, cache: new discord.Collection() },
      channels: { cache: new discord.Collection(), create: async () => { assert.equal(deferred, true); return { id: 'ticket', send: async payload => { ticketMessage = payload; } }; } } } });
  assert.equal(ticketMessage.components[0].toJSON().components[0].custom_id, 'vip_select_combo');
  for (const [tier, amount] of [['combo', 70], ['bronze', 15]]) {
    for (const flow of [steam, { openVipModal: linked.handleVipSelect, submitVipModal: linked.handleVipModal }]) {
      let modal;
      await flow.openVipModal({ customId: `vip_select_${tier}`, user: { id: 'user' }, showModal: async value => { modal = value.toJSON(); } });
      assert.equal(modal.custom_id, `vip_modal_${tier}`);
      assert.ok(modal.title.length <= 45);
      assert.ok(modal.title.includes(amount.toFixed(2)));
      const interaction = { customId: `vip_modal_${tier}`, channelId: `ticket-${tier}`, user: { id: 'user' },
        fields: { getTextInputValue: id => id === 'steam_id' ? '76561198000000000' : 'player@example.com' },
        reply: async value => { assert.ok(value.components); }, editReply: async () => {} };
      await flow.submitVipModal(interaction);
      const handlers = flow === steam ? tickets : linked;
      for (const handler of [handlers.handleVipPayPix, handlers.handleVipPayCard]) {
        await flow.submitVipModal(interaction);
        await handler({ channelId: interaction.channelId, deferReply: async () => {}, editReply: async payload => { assert.equal(typeof payload, 'object'); } });
        assert.equal(requests.at(-1).amount, amount);
        assert.equal(requests.at(-1).vipTier, tier);
        assert.equal(records.at(-1).vipTier, tier);
        assert.equal(Number(records.at(-1).amount), amount);
      }
      if (flow !== steam) {
        await flow.submitVipModal(interaction);
        await linked.handleVipPayStripe({ channelId: interaction.channelId, deferReply: async () => {}, editReply: async () => {} });
        assert.equal(requests.at(-1).amount, amount);
        assert.equal(requests.at(-1).vipTier, tier);
      }
    }
  }
  console.log('PASS: Bronze R$15, combo R$70, image preserved, Discord selection and ticket, both modal flows, PIX, Mercado Pago and Stripe.');
})().catch(error => { console.error(error); process.exitCode = 1; });

