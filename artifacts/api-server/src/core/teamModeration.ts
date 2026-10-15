import { banPlayer, ActionError, type ActionActor, type BanDuration } from "./systemActions.js";
import { getTeamMembers } from "../bot/commands/duo.js";
export async function resolveBanTeam(steamId:string) {
  if(!/^7656119\d{10}$/.test(steamId))throw new ActionError("SteamID inválido.");
  const team=await getTeamMembers(steamId);
  const members=new Map(team.map(p=>[p.steamId,p]));
  if(!members.has(steamId))members.set(steamId,{steamId,name:steamId});
  return [...members.values()];
}
export async function banWithAssociation(input:{steamId:string;duration:BanDuration;reason:string;actor:ActionActor;association:boolean;associationDuration?:BanDuration;expectedTeam?:string[]}) {
  const roster=input.association?await resolveBanTeam(input.steamId):[{steamId:input.steamId,name:input.steamId}];
  if(input.association&&input.expectedTeam&&roster.map(p=>p.steamId).sort().join()!==[...input.expectedTeam].sort().join())throw new ActionError("O time mudou. Revise os nomes antes de confirmar novamente.",409);
  const ipUnknown:string[]=[],succeeded:string[]=[],failed:{steamId:string;error:string}[]=[];
  for(const member of roster){
    try{const result=await banPlayer({steamId:member.steamId,duration:member.steamId===input.steamId?input.duration:input.associationDuration||input.duration,
      reason:member.steamId===input.steamId?input.reason:`Associação ao time de ${input.steamId}: ${input.reason}`,
      actor:input.actor,playerName:member.name===member.steamId?undefined:member.name,
      association:member.steamId===input.steamId?undefined:{steamId:input.steamId,playerName:input.steamId}});succeeded.push(member.steamId);if(!result.ipProtected)ipUnknown.push(member.steamId);
    }catch(error){failed.push({steamId:member.steamId,error:error instanceof Error?error.message:"Falha na operação"});}
  }
  return {roster,succeeded,failed,ipUnknown,total:roster.length,ok:failed.length===0};
}
