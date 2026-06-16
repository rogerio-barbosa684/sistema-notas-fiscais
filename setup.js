// Configurações de ambiente para os testes
// Garante que os testes NUNCA usem o banco de produção

// Desativa PostgreSQL nos testes (força SQLite)
process.env.DATABASE_URL = '';

// Usa um banco de dados separado e temporário para testes
process.env.DB_PATH = './database.test.db';
