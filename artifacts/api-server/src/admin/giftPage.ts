import { renderDuoPage } from "./duoPage.js";
export function renderGiftPage(){return renderDuoPage()
  .replaceAll('Super Combo Duo','Presente VIP').replaceAll('👥','🎁')
  .replaceAll('VIP Bronze + Prata + Ouro por 30 dias','o VIP recebido por 30 dias')
  .replaceAll('/api/store/duo/','/api/store/gift/').replaceAll('gf_duo_token','gf_gift_token')
  .replaceAll('target=duo','target=gift').replaceAll('login?duo=1','login?gift=1')
  .replaceAll('RESGATAR OS TRÊS VIPs','RESGATAR MEU PRESENTE')
  .replaceAll('Os VIPs foram entregues.','O presente foi entregue.')
  .replaceAll('Bronze, Prata e Ouro ativados por 30 dias na sua conta!','Seu presente VIP foi ativado por 30 dias na sua conta!');}
