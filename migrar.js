require('dotenv').config();

const sqlite3 = require('sqlite3').verbose();
const db_postgres = require('./db');

const db_sqlite = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao SQLite:', err);
        process.exit(1);
    }
    console.log('✅ Conectado ao SQLite');
});

async function migrar() {
    try {
        console.log('\n🔄 Iniciando migração do SQLite para PostgreSQL...\n');

        // 1. Criar tabelas no Postgres (se ainda não existirem)
        await db_postgres.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL,
                tipo TEXT DEFAULT 'usuario',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db_postgres.query(`
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Tabelas criadas no PostgreSQL\n');

        // 2. Migrar usuários
        const usuarios = await new Promise((resolve, reject) => {
            db_sqlite.all('SELECT * FROM usuarios', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        console.log(`📋 Encontrados ${usuarios.length} usuários no SQLite`);

        for (const u of usuarios) {
            try {
                await db_postgres.query(
                    `INSERT INTO usuarios (nome, email, senha, tipo, created_at) 
                     VALUES ($1, $2, $3, $4, $5) 
                     ON CONFLICT (email) DO NOTHING`,
                    [u.nome, u.email, u.senha, u.tipo || 'usuario', u.created_at]
                );
                console.log(`  ✅ Usuário migrado: ${u.email}`);
            } catch (err) {
                console.log(`  ⚠️  Usuário ${u.email} já existe no Postgres, pulando...`);
            }
        }

        // 3. Migrar notas fiscais
        const notas = await new Promise((resolve, reject) => {
            db_sqlite.all('SELECT * FROM notas_fiscais', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        console.log(`\n📋 Encontradas ${notas.length} notas fiscais no SQLite`);

        for (const n of notas) {
            await db_postgres.query(
                `INSERT INTO notas_fiscais 
                (tipo_nota, numero_nota, chave_acesso, cnpj_cpf, fornecedor, data_emissao, data_vencimento, 
                 valor, descricao, centro_custo, status, pdf_nota_url, pdf_comprovante_url, data_pagamento, 
                 observacoes, origem, validado_empresa, created_at) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                [
                    n.tipo_nota, n.numero_nota, n.chave_acesso, n.cnpj_cpf, n.fornecedor,
                    n.data_emissao, n.data_vencimento, n.valor, n.descricao, n.centro_custo,
                    n.status, n.pdf_nota_url, n.pdf_comprovante_url, n.data_pagamento,
                    n.observacoes, n.origem, n.validado_empresa, n.created_at
                ]
            );
            console.log(`  ✅ Nota migrada: ${n.numero_nota}`);
        }

        console.log('\n🎉 Migração concluída com sucesso!\n');
        process.exit(0);

    } catch (err) {
        console.error('\n❌ Erro durante a migração:', err);
        process.exit(1);
    }
}

migrar();
