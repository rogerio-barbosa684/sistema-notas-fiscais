require('dotenv').config();
const db = require('./db');

(async () => {
  try {
    const r = await db.query('SELECT NOW() as agora');
    console.log('✅ Conectou no Postgres. Hora do servidor:', r.rows[0].agora);
  } catch (err) {
    console.error('❌ Erro ao conectar no Postgres:', err);
  } finally {
    process.exit(0);
  }
})();
