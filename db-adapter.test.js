const db = require('../db-adapter');
const fs = require('fs');
const path = require('path');

describe('Testes do Adaptador de Banco de Dados (SQLite)', () => {
  let insertedUserId;
  let insertedNotaId;

  beforeAll(async () => {
    // Usa o banco de teste isolado (database.test.db via setup.js)
    await db.init();
  });

  afterAll(async () => {
    // Limpa os dados inseridos nos testes
    if (insertedUserId) {
      await db.run('DELETE FROM usuarios WHERE id = ?', [insertedUserId]);
    }
    if (insertedNotaId) {
      await db.run('DELETE FROM notas_fiscais WHERE id = ?', [insertedNotaId]);
    }
    await db.close();

    // Remove o banco de dados de teste após todos os testes concluírem
    const testDbPath = path.join(__dirname, '../database.test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log('🧹 Banco de dados de teste removido.');
    }
  });

  // ─── TESTES DE USUÁRIOS ─────────────────────────────────────────────────────

  test('Deve inserir um usuário e recuperá-lo corretamente', async () => {
    const email = `teste-${Date.now()}@teste.com`;
    const nome = 'Usuário de Teste';
    const senha = 'hash_senha_teste';
    const tipo = 'operacao';

    const resultado = await db.run(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
      [nome, email, senha, tipo]
    );

    expect(resultado.lastID).toBeDefined();
    expect(resultado.lastID).toBeGreaterThan(0);
    insertedUserId = resultado.lastID;

    const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', [resultado.lastID]);
    expect(usuario).toBeDefined();
    expect(usuario.nome).toBe(nome);
    expect(usuario.email).toBe(email);
    expect(usuario.tipo).toBe(tipo);
  });

  test('Deve rejeitar inserção de usuário com tipo inválido', async () => {
    await expect(
      db.run(
        'INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
        ['Inválido', `invalido-${Date.now()}@teste.com`, 'hash', 'usuario']
      )
    ).rejects.toThrow();
  });

  test('Deve rejeitar email duplicado', async () => {
    const email = `dup-${Date.now()}@teste.com`;
    await db.run(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
      ['Primeiro', email, 'hash', 'financeiro']
    );
    await expect(
      db.run(
        'INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
        ['Segundo', email, 'hash', 'operacao']
      )
    ).rejects.toThrow();
  });

  test('Deve listar todos os usuários com db.all()', async () => {
    const usuarios = await db.all('SELECT * FROM usuarios ORDER BY created_at DESC');
    expect(Array.isArray(usuarios)).toBe(true);
    expect(usuarios.length).toBeGreaterThan(0);
    // Admin padrão deve existir
    const admin = usuarios.find(u => u.email === 'admin@sistema.com');
    expect(admin).toBeDefined();
    expect(admin.tipo).toBe('administrador');
  });

  test('Deve retornar null ao buscar usuário inexistente', async () => {
    const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', [999999]);
    expect(usuario).toBeNull();
  });

  test('Deve atualizar um usuário corretamente', async () => {
    const resultado = await db.run(
      'UPDATE usuarios SET nome = ? WHERE id = ?',
      ['Nome Atualizado', insertedUserId]
    );
    expect(resultado.changes).toBe(1);

    const usuario = await db.get('SELECT nome FROM usuarios WHERE id = ?', [insertedUserId]);
    expect(usuario.nome).toBe('Nome Atualizado');
  });

  // ─── TESTES DE NOTAS FISCAIS ────────────────────────────────────────────────

  test('Deve inserir uma nota fiscal e normalizar datas e floats', async () => {
    const numero_nota = `NF-${Date.now()}`;
    const valor = 1250.75;
    const data_emissao = '2026-05-27T12:00:00.000Z'; // formato ISO
    const data_vencimento = '2026-06-30';

    const resultado = await db.run(
      `INSERT INTO notas_fiscais 
       (tipo_nota, numero_nota, fornecedor, data_emissao, data_vencimento, valor, pdf_nota_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['NF/AP', numero_nota, 'Fornecedor XYZ', data_emissao, data_vencimento, valor, 'pdf-teste.pdf']
    );

    expect(resultado.lastID).toBeDefined();
    expect(resultado.lastID).toBeGreaterThan(0);
    insertedNotaId = resultado.lastID;

    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id = ?', [resultado.lastID]);
    expect(nota).toBeDefined();

    // Datas devem ser normalizadas para 'YYYY-MM-DD'
    expect(nota.data_emissao).toBe('2026-05-27');
    expect(nota.data_vencimento).toBe('2026-06-30');

    // Valor deve ser número JavaScript
    expect(typeof nota.valor).toBe('number');
    expect(nota.valor).toBe(valor);
  });

  test('Deve ter status padrão "entrada" ao criar nota fiscal', async () => {
    const nota = await db.get('SELECT status FROM notas_fiscais WHERE id = ?', [insertedNotaId]);
    expect(nota.status).toBe('entrada');
  });

  test('Deve atualizar o status da nota fiscal', async () => {
    await db.run(
      'UPDATE notas_fiscais SET status = ? WHERE id = ?',
      ['financeiro', insertedNotaId]
    );
    const nota = await db.get('SELECT status FROM notas_fiscais WHERE id = ?', [insertedNotaId]);
    expect(nota.status).toBe('financeiro');
  });

  test('Deve excluir uma nota fiscal corretamente', async () => {
    await db.run('DELETE FROM notas_fiscais WHERE id = ?', [insertedNotaId]);
    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id = ?', [insertedNotaId]);
    expect(nota).toBeNull();
    insertedNotaId = null; // Já limpo
  });

  // ─── TESTES DA FUNÇÃO translateSql (indiretamente) ─────────────────────────

  test('db.all() deve retornar array vazio quando não há resultados', async () => {
    const notas = await db.all(
      'SELECT * FROM notas_fiscais WHERE numero_nota = ?',
      ['NOTA-INEXISTENTE-XYZ']
    );
    expect(Array.isArray(notas)).toBe(true);
    expect(notas.length).toBe(0);
  });
});
