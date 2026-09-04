import { Router, type IRouter } from "express";

const router: IRouter = Router();

// PostgreSQL is the authoritative source for Season state.
// Full snapshots originate from the Rust server's local plugin state and can be
// rolled back by restoring a game-server backup. Accepting them would allow an
// old backup to overwrite newer Season progress in PostgreSQL.
for (const path of ["/season/snapshot", "/season/snapshot-fast"]) {
  router.post(path, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return void res.status(202).json({
      ok: true,
      ignored: true,
      saved: 0,
      database_authoritative: true,
      message: "Snapshot do servidor ignorado. PostgreSQL e a fonte de verdade da Season; somente eventos transacionais podem alterar a pontuacao.",
    });
  });
}

export default router;
