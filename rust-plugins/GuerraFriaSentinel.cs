using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Oxide.Core.Libraries.Covalence;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("GuerraFriaSentinel", "Guerra Fria", "1.0.0")]
    [Description("Server-side anticheat telemetry and population bridge for GF Admin.")]
    public class GuerraFriaSentinel : RustPlugin
    {
        private const string Prefix = "[GF_SENTINEL]";
        private readonly Dictionary<ulong, State> states = new Dictionary<ulong, State>();
        private readonly Dictionary<ulong, Queue<double>> hitTimes = new Dictionary<ulong, Queue<double>>();
        private Timer populationTimer;

        private class State { public Vector3 LastPos; public double LastAt; public int MoveScore; public int AimScore; public int FireScore; public int FlyScore; }
        private class Alert { public string kind; public string player; public string steamId; public string detail; public string severity; public int score; public long at; }
        private class Population { public string kind="population"; public int online; public int sleepers; public int queued; public int joining; public int maxPlayers; public string map; public long at; }

        void OnServerInitialized(bool initial)
        {
            foreach (var p in BasePlayer.activePlayerList) Seed(p);
            populationTimer = timer.Every(10f, EmitPopulation);
            EmitPopulation();
        }

        void Unload() { populationTimer?.Destroy(); }
        void OnPlayerConnected(BasePlayer player) { Seed(player); }
        void OnPlayerDisconnected(BasePlayer player, string reason) { if (player != null) states.Remove(player.userID); }

        private void Seed(BasePlayer p)
        {
            if (p == null) return;
            states[p.userID] = new State { LastPos=p.transform.position, LastAt=Now() };
        }

        private double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()/1000d;
        private void Emit(object payload) => Puts(Prefix + JsonConvert.SerializeObject(payload));
        private void Flag(BasePlayer p, string kind, string detail, string severity, int score)
        {
            if (p == null || p.IsAdmin || p.IsNpc) return;
            Emit(new Alert { kind=kind, player=p.displayName, steamId=p.UserIDString, detail=detail, severity=severity, score=score, at=DateTimeOffset.UtcNow.ToUnixTimeSeconds() });
        }

        private void EmitPopulation()
        {
            var q = ServerMgr.Instance?.connectionQueue;
            Emit(new Population {
                online=BasePlayer.activePlayerList.Count,
                sleepers=BasePlayer.sleepingPlayerList.Count,
                queued=q?.Queued ?? 0,
                joining=q?.Joining ?? 0,
                maxPlayers=ConVar.Server.maxplayers,
                map=ConVar.Server.level,
                at=DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            });
        }

        void OnPlayerTick(BasePlayer player, PlayerTick msg, bool wasPlayerStalled)
        {
            if (player == null || !player.IsConnected || player.IsAdmin || player.IsNpc || player.IsSleeping() || player.isMounted) return;
            State s; if (!states.TryGetValue(player.userID, out s)) { Seed(player); return; }
            double now=Now(), dt=now-s.LastAt; if (dt < .35) return;
            Vector3 pos=player.transform.position; float dist=Vector3.Distance(pos,s.LastPos); float speed=(float)(dist/dt);
            bool grounded=player.IsOnGround() || player.IsSwimming();
            if (speed > 18f && dist > 8f) { s.MoveScore++; if (s.MoveScore>=3) { Flag(player,"movement","Deslocamento incompatível: "+speed.ToString("0.0")+" m/s ("+dist.ToString("0.0")+" m)",s.MoveScore>=6?"critical":"warning",s.MoveScore); s.MoveScore=0; } } else s.MoveScore=Math.Max(0,s.MoveScore-1);
            if (!grounded && pos.y > s.LastPos.y + 4.5f && dist > 5f) { s.FlyScore++; if(s.FlyScore>=3){Flag(player,"fly","Subida aérea anormal sem veículo/montaria.","critical",s.FlyScore);s.FlyScore=0;} } else s.FlyScore=Math.Max(0,s.FlyScore-1);
            s.LastPos=pos; s.LastAt=now;
        }

        void OnWeaponFired(BaseProjectile projectile, BasePlayer player, ItemModProjectile mod, ProtoBuf.ProjectileShoot shoot)
        {
            if(player==null || player.IsAdmin || player.IsNpc) return;
            Queue<double> q; if(!hitTimes.TryGetValue(player.userID,out q)){q=new Queue<double>();hitTimes[player.userID]=q;}
            double now=Now(); q.Enqueue(now); while(q.Count>0 && now-q.Peek()>1.0) q.Dequeue();
            if(q.Count>=14){ Flag(player,"fire_rate","Cadência extrema detectada: "+q.Count+" disparos/s.","critical",q.Count); q.Clear(); }
        }

        void OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            var victim=entity as BasePlayer; var attacker=info?.InitiatorPlayer; if(victim==null || attacker==null || attacker==victim || attacker.IsAdmin || attacker.IsNpc) return;
            float distance=Vector3.Distance(attacker.transform.position,victim.transform.position);
            bool head=info.isHeadshot;
            if(distance>350f && head) Flag(attacker,"longshot","Headshot a distância extrema: "+distance.ToString("0")+" m.","warning",2);
        }

        void OnPlayerViolation(BasePlayer player, AntiHackType type, float amount)
        {
            if(player==null || player.IsAdmin || player.IsNpc) return;
            string sev=amount>=10f?"critical":"warning";
            Flag(player,"native_antihack","Rust AntiHack: "+type+" (nível "+amount.ToString("0.0")+").",sev,(int)Math.Ceiling(amount));
        }
    }
}
