import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

try {
  await client.connect();
  console.log('✓ Conectado ao banco production\n');

  // BEFORE
  console.log('=== BEFORE RESET ===\n');
  let result = await client.query('SELECT COUNT(*) as count FROM season_transactions WHERE season_number = 1');
  console.log(`Season 1 Transactions: ${result.rows[0].count}`);

  result = await client.query('SELECT COUNT(*) as count FROM season_players WHERE season_number = 1');
  console.log(`Season 1 Players: ${result.rows[0].count}`);

  result = await client.query('SELECT COUNT(*) as count FROM season_registrations WHERE season_number = 1');
  console.log(`Season 1 Registrations: ${result.rows[0].count}`);

  result = await client.query('SELECT ROUND(AVG(mmr)::numeric, 2) as avg_mmr FROM season_players WHERE season_number = 1');
  console.log(`Avg Season 1 MMR: ${result.rows[0].avg_mmr}\n`);

  // DELETE transactions
  console.log('Deletando transações Season 1...');
  result = await client.query('DELETE FROM season_transactions WHERE season_number = 1');
  console.log(`✓ ${result.rowCount} transações deletadas\n`);

  // RESET stats
  console.log('Resetando stats Season 1 para baseline...');
  result = await client.query(`
    UPDATE season_players 
    SET mmr = 1000,
        pvp_raid_mmr = 0,
        farm_mmr = 0,
        building_mmr = 0,
        event_mmr = 0,
        other_mmr = 0,
        kills = 0,
        deaths = 0,
        headshots = 0,
        assists = 0,
        wood = 0,
        stone = 0,
        metal_ore = 0,
        sulfur_ore = 0,
        hqm_ore = 0,
        build_wood = 0,
        build_stone = 0,
        build_metal = 0,
        build_armored = 0,
        rockets_used = 0,
        c4_used = 0,
        satchels_used = 0,
        raid_structures_destroyed = 0,
        tcs_destroyed = 0,
        raids_participated = 0,
        raids_defended = 0,
        bradley_participations = 0,
        heli_participations = 0,
        crates_hacked = 0,
        updated_at = NOW()
    WHERE season_number = 1
  `);
  console.log(`✓ ${result.rowCount} jogadores resetados\n`);

  // AFTER
  console.log('=== AFTER RESET ===\n');
  result = await client.query('SELECT COUNT(*) as count FROM season_transactions WHERE season_number = 1');
  console.log(`Season 1 Transactions: ${result.rows[0].count}`);

  result = await client.query('SELECT COUNT(*) as count FROM season_players WHERE season_number = 1');
  console.log(`Season 1 Players: ${result.rows[0].count}`);

  result = await client.query('SELECT COUNT(*) as count FROM season_registrations WHERE season_number = 1');
  console.log(`Season 1 Registrations: ${result.rows[0].count}`);

  result = await client.query('SELECT ROUND(AVG(mmr)::numeric, 2) as avg_mmr FROM season_players WHERE season_number = 1');
  console.log(`Avg Season 1 MMR: ${result.rows[0].avg_mmr}\n`);

  // VALIDATION
  console.log('=== VALIDATION ===\n');
  result = await client.query('SELECT COUNT(*) as count FROM season_players WHERE season_number = 1 AND mmr = 1000 AND kills = 0 AND deaths = 0');
  console.log(`✓ Season 1 - Jogadores no baseline: ${result.rows[0].count}`);

  result = await client.query('SELECT COUNT(*) as count FROM season_registrations WHERE season_number = 1');
  console.log(`✓ Season 1 - Inscrições preservadas: ${result.rows[0].count}`);

  result = await client.query('SELECT season_number, COUNT(*) as transaction_count FROM season_transactions WHERE season_number > 1 GROUP BY season_number ORDER BY season_number');
  if (result.rows.length > 0) {
    console.log(`✓ Outras seasons - Transações preservadas:`);
    result.rows.forEach(row => console.log(`  Season ${row.season_number}: ${row.transaction_count} transações`));
  }

  await client.end();
  console.log('\n✓ Reset Season 1 completado com sucesso');
  process.exit(0);
} catch (error) {
  console.error('✗ Erro:', error.message);
  process.exit(1);
}

