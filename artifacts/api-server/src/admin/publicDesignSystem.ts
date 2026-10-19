/** Shared public surfaces use the storefront palette; checkout retains its own styles. */
export const publicDesignSystemCss = `<style id="gf-public-design">
:root{color-scheme:dark;--gf-bg:#090c10;--gf-panel:#141820;--gf-line:#323c47;--gf-gold:#e4b64e}
body{background:radial-gradient(ellipse at 85% 0,#92621320,transparent 48%),#090c10!important;color:#f4f5f6!important;font-family:Inter,Arial,Helvetica,sans-serif!important}
body .hero,body .card,body .panel,body .stat,body .pod,body .table,body .box,body .infoCard,body .featureCard,body .communityCard,body .pCard{background:linear-gradient(145deg,#171d25,#10151b)!important;border:1px solid #323c47!important;border-radius:24px!important;box-shadow:inset 0 1px 0 #ffffff07,0 16px 42px #0003}
body .hero{border-color:#665020!important;background:radial-gradient(ellipse at 85% 0,#92621344,transparent 68%),#10151b!important}
body .hero h1,body .hero h2{letter-spacing:-.035em;line-height:1.1}body .hero h2 span{color:#e4b64e!important}
body button,body input,body select,body textarea,body .tab{border-radius:16px!important}body input:focus-visible,body select:focus-visible,body textarea:focus-visible,body button:focus-visible,body a:focus-visible{outline:2px solid #e4b64e;outline-offset:4px}
body .tab.active,body .gfNavItem.active{background:#b68b2826!important;border-color:#b68b28!important;color:#ffe2a0!important;box-shadow:0 8px 24px #bd8e1716!important}
body .mut,body .subtitle{color:#aab4c0}body .stat,body .pod{transition:transform .2s,border-color .2s}body .stat:hover,body .pod:hover{transform:translateY(-3px);border-color:#80632b!important}
.gfServerPicker{display:flex;gap:10px;margin:18px 0;flex-wrap:wrap}.gfServerPicker a{display:inline-flex;padding:12px 26px;border:1px solid #323c47;border-radius:16px;background:#141820;color:#f4f5f6;text-decoration:none;font-weight:700}.gfServerPicker a[aria-current=page]{border-color:#d2a63e;background:#b68b2826;color:#ffe2a0}
@media(max-width:600px){body .hero{padding:24px!important}body .hero h2{font-size:clamp(28px,9vw,44px)!important}.gfServerPicker a{flex:1;justify-content:center}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
</style>`;
