import pg from 'pg';

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

(async () => {
  try {
    await client.connect();
    console.log('✓ Conectado ao banco production\n');

    // BEFORE
    console.log('=== BEFORE RESET ===\n');
    let r = await client.query('SELECT COUNT(*) as c FROM season_transactions WHERE season_number = 1');
    const txBefore = r.rows[0].c;
    console.log(`Season 1 Transactions: ${txBefore}`);

    r = await client.query('SELECT COUNT(*) as c FROM season_players WHERE season_number = 1');
    const playersBefore = r.rows[0].c;
    console.log(`Season 1 Players: ${playersBefore}`);

    r = await client.query('SELECT COUNT(*) as c FROM season_registrations WHERE season_number = 1');
    const regsBefore = r.rows[0].c;
    console.log(`Season 1 Registrations: ${regsBefore}`);

    r = await client.query('SELECT ROUND(AVG(mmr)::numeric, 2) as m FROM season_players WHERE season_number = 1');
    const mmrBefore = r.rows[0].m || 0;
    console.log(`Avg Season 1 MMR: ${mmrBefore}\n`);

    // DELETE transactions
    console.log('Deletando transações Season 1...');
    r = await client.query('DELETE FROM season_transactions WHERE season_number = 1');
    console.log(`✓ ${r.rowCount} transações deletadas\n`);

    // RESET
    console.log('Resetando stats Season 1...');
    r = await client.query(`UPDATE season_players SET mmr=1000,pvp_raid_mmr=0,farm_mmr=0,building_mmr=0,event_mmr=0,other_mmr=0,kills=0,deaths=0,headshots=0,assists=0,wood=0,stone=0,metal_ore=0,sulfur_ore=0,hqm_ore=0,build_wood=0,build_stone=0,build_metal=0,build_armored=0,rockets_used=0,c4_used=0,satchels_used=0,raid_structures_destroyed=0,tcs_destroyed=0,raids_participated=0,raids_defended=0,bradley_participations=0,heli_participations=0,crates_hacked=0,updated_at=NOW() WHERE season_number=1`);
    const playersReset = r.rowCount;
    console.log(`✓ ${playersReset} jogadores resetados\n`);

    // AFTER
    console.log('=== AFTER RESET ===\n');
    r = await client.query('SELECT COUNT(*) as c FROM season_transactions WHERE season_number = 1');
    const txAfter = r.rows[0].c;
    console.log(`Season 1 Transactions: ${txAfter}`);

    r = await client.query('SELECT COUNT(*) as c FROM season_players WHERE season_number = 1');
    const playersAfter = r.rows[0].c;
    console.log(`Season 1 Players: ${playersAfter}`);

    r = await client.query('SELECT COUNT(*) as c FROM season_registrations WHERE season_number = 1');
    const regsAfter = r.rows[0].c;
    console.log(`Season 1 Registrations: ${regsAfter}`);

    r = await client.query('SELECT ROUND(AVG(mmr)::numeric, 2) as m FROM season_players WHERE season_number = 1');
    const mmrAfter = r.rows[0].m || 0;
    console.log(`Avg Season 1 MMR: ${mmrAfter}\n`);

    // VALIDATION
    console.log('=== VALIDATION ===\n');
    r = await client.query('SELECT COUNT(*) as c FROM season_players WHERE season_number = 1 AND mmr = 1000 AND kills = 0 AND deaths = 0');
    console.log(`✓ Jogadores no baseline: ${r.rows[0].c}`);

    r = await client.query('SELECT COUNT(*) as c FROM season_registrations WHERE season_number = 1');
    console.log(`✓ Inscrições preservadas: ${r.rows[0].c}`);

    r = await client.query('SELECT season_number, COUNT(*) as c FROM season_transactions WHERE season_number > 1 GROUP BY season_number ORDER BY season_number');
    if (r.rows.length > 0) {
      console.log(`✓ Outras seasons intactas:`);
      r.rows.forEach(row => console.log(`  Season ${row.season_number}: ${row.c} transações`));
    }

    console.log('\n✓ Reset completado com sucesso');
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('✗ Erro:', error.message);
    process.exit(1);
  }
})();
