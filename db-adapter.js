// db-adapter.js
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

let pgPool = null;
let sqliteDb = null;
let isPostgres = false;

function formatarData(data) {
  if (!data) return null;
  if (data instanceof Date) {
    const yyyy = data.getFullYear();
    const mm = String(data.getMonth() + 1).padStart(2, '0');
    const dd = String(data.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof data === 'string') {
    return data.split('T')[0].split(' ')[0];
  }
  return data;
}

function normalizarLinha(row) {
  if (!row) return row;
  const camposData = ['data_emissao', 'data_vencimento', 'data_pagamento'];
  for (const campo of camposData) {
    if (row[campo] !== undefined && row[campo] !== null) {
      row[campo] = formatarData(row[campo]);
    }
  }
  if (row.valor !== undefined && row.valor !== null) {
    row.valor = parseFloat(row.valor);
  }
  return row;
}

function translateSql(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

async function init() {
  // Reset estado para permitir re-inicialização (útil nos testes)
  isPostgres = false;
  pgPool = null;
  sqliteDb = null;

  if (process.env.DATABASE_URL) {
    try {
      console.log('🔄 Tentando conectar ao PostgreSQL...');
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      await pgPool.query('SELECT NOW()');
      isPostgres = true;
      console.log('✅ Conectado ao banco de dados PostgreSQL com sucesso.');
    } catch (err) {
      console.error('⚠️  Falha ao conectar ao PostgreSQL. Detalhes:', err.message);
      console.log('🔄 Fazendo fallback para o SQLite local...');
      isPostgres = false;
    }
  } else {
    console.log('ℹ️  DATABASE_URL não configurada. Usando SQLite local por padrão.');
  }

  if (!isPostgres) {
    // Usa DB_PATH env var (útil para testes com banco separado)
    const dbPath = process.env.DB_PATH || './database.db';
    await new Promise((resolve, reject) => {
      sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('❌ Erro ao conectar ao SQLite:', err);
          reject(err);
        } else {
          console.log(`✅ Conectado ao banco de dados SQLite (${dbPath}).`);
          resolve();
        }
      });
    });
  }

  // Inicializar estrutura do banco de dados
  await createTables();
  await createDefaultAdmin();
}

async function createTables() {
  if (isPostgres) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('administrador', 'operacao', 'financeiro')),
        ativo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS notas_fiscais (
        id SERIAL PRIMARY KEY,
        tipo_nota TEXT DEFAULT 'NF/AP',
        numero_nota TEXT NOT NULL,
        chave_acesso TEXT,
        cnpj_cpf TEXT,
        fornecedor TEXT NOT NULL,
        data_emissao DATE NOT NULL,
        data_vencimento DATE NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        descricao TEXT,
        centro_custo TEXT,
        status TEXT DEFAULT 'entrada',
        pdf_nota_url TEXT,
        pdf_comprovante_url TEXT,
        data_pagamento DATE,
        observacoes TEXT,
        origem TEXT DEFAULT 'manual',
        validado_empresa INTEGER DEFAULT 0,
        usuario_criador_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    await new Promise((resolve, reject) => {
      sqliteDb.serialize(() => {
        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            tipo TEXT NOT NULL CHECK(tipo IN ('administrador', 'operacao', 'financeiro')),
            ativo INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => { if (err) reject(err); });

        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS notas_fiscais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo_nota TEXT DEFAULT 'NF/AP',
            numero_nota TEXT NOT NULL,
            chave_acesso TEXT,
            cnpj_cpf TEXT,
            fornecedor TEXT NOT NULL,
            data_emissao DATE NOT NULL,
            data_vencimento DATE NOT NULL,
            valor REAL NOT NULL,
            descricao TEXT,
            centro_custo TEXT,
            status TEXT DEFAULT 'entrada',
            pdf_nota_url TEXT,
            pdf_comprovante_url TEXT,
            data_pagamento DATE,
            observacoes TEXT,
            origem TEXT DEFAULT 'manual',
            validado_empresa INTEGER DEFAULT 0,
            usuario_criador_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_criador_id) REFERENCES usuarios(id)
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
}

async function createDefaultAdmin() {
  const adminEmail = 'admin@sistema.com';
  const row = await get('SELECT * FROM usuarios WHERE email = ?', [adminEmail]);
  if (!row) {
    const hash = await bcrypt.hash('admin123', 10);
    await run(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
      ['Administrador', adminEmail, hash, 'administrador']
    );
    console.log('✅ Usuário admin padrão cadastrado: admin@sistema.com / admin123');
  } else {
    // Garante que o admin tem o tipo correto
    if (row.tipo !== 'administrador') {
      await run("UPDATE usuarios SET tipo = 'administrador' WHERE email = ?", [adminEmail]);
    }
  }
}

async function run(sql, params = []) {
  if (isPostgres) {
    let pgSql = translateSql(sql);
    const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
    const hasReturning = pgSql.toUpperCase().includes('RETURNING');
    if (isInsert && !hasReturning) {
      pgSql = pgSql.trim();
      if (pgSql.endsWith(';')) {
        pgSql = pgSql.slice(0, -1) + ' RETURNING id;';
      } else {
        pgSql += ' RETURNING id';
      }
    }
    const res = await pgPool.query(pgSql, params);
    const lastID = (isInsert || hasReturning) && res.rows[0] ? res.rows[0].id : null;
    return { lastID, changes: res.rowCount };
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
}

async function get(sql, params = []) {
  if (isPostgres) {
    const pgSql = translateSql(sql);
    const res = await pgPool.query(pgSql, params);
    return res.rows[0] ? normalizarLinha(res.rows[0]) : null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row ? normalizarLinha(row) : null);
      });
    });
  }
}

async function all(sql, params = []) {
  if (isPostgres) {
    const pgSql = translateSql(sql);
    const res = await pgPool.query(pgSql, params);
    return res.rows.map(normalizarLinha);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []).map(normalizarLinha));
      });
    });
  }
}

async function close() {
  if (isPostgres && pgPool) {
    await pgPool.end();
    pgPool = null;
  } else if (sqliteDb) {
    await new Promise((resolve, reject) => {
      sqliteDb.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    sqliteDb = null;
  }
}

module.exports = {
  init,
  run,
  get,
  all,
  close,
  getIsPostgres: () => isPostgres
};
