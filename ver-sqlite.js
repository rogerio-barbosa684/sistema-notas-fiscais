const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Erro ao abrir SQLite:', err);
    process.exit(1);
  }
  console.log('✅ Conectado ao SQLite\n');

  db.all('SELECT id, nome, email, tipo FROM usuarios', (err, rows) => {
    if (err) {
      console.error('Erro ao ler usuários:', err);
    } else {
      console.log('Usuários no SQLite:');
      console.log(rows);
    }
    db.close();
  });
});
