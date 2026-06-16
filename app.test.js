const request = require('supertest');
const app = require('../server');
const db = require('../db-adapter');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

describe('Integration Tests - App Routes', () => {
  let adminCookie;
  let operacaoCookie;
  let testUserId;
  let testNotaId;

  beforeAll(async () => {
    // Inicializa banco de dados de teste (database.test.db via setup.js)
    await db.init();

    const operacaoEmail = 'operador@sistema.com';

    // Cria usuário operador para testes
    const hashOp = await bcrypt.hash('operador123', 10);
    await db.run(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
      ['Operador Teste', operacaoEmail, hashOp, 'operacao']
    );

    // Busca o ID do operador criado
    const opUser = await db.get('SELECT id FROM usuarios WHERE email = ?', [operacaoEmail]);
    testUserId = opUser ? opUser.id : null;
  });

  afterAll(async () => {
    // Limpa registros criados durante o teste
    if (testNotaId) {
      // Busca o arquivo PDF associado antes de deletar
      const nota = await db.get('SELECT pdf_nota_url, pdf_comprovante_url FROM notas_fiscais WHERE id = ?', [testNotaId]);
      if (nota) {
        if (nota.pdf_nota_url) {
          const p = path.join(__dirname, '../uploads', nota.pdf_nota_url);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
        if (nota.pdf_comprovante_url) {
          const p = path.join(__dirname, '../uploads', nota.pdf_comprovante_url);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      }
      await db.run('DELETE FROM notas_fiscais WHERE id = ?', [testNotaId]);
    }
    if (testUserId) {
      await db.run('DELETE FROM usuarios WHERE id = ?', [testUserId]);
    }
    await db.close();
  });

  // ─── AUTENTICAÇÃO ───────────────────────────────────────────────────────────

  test('Deve redirecionar para /login ao acessar rota protegida sem autenticação', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('Deve rejeitar login com credenciais inválidas', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'admin@sistema.com', senha: 'senhaerrada' });
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('incorretos');
  });

  test('Deve rejeitar login sem email ou senha', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: '', senha: '' });
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('obrigatórios');
  });

  test('Deve fazer login com admin com sucesso e receber cookie de sessão', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'admin@sistema.com', senha: 'admin123' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.headers['set-cookie']).toBeDefined();
    adminCookie = res.headers['set-cookie'];
  });

  test('Deve fazer login como operador com sucesso', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'operador@sistema.com', senha: 'operador123' });

    expect(res.statusCode).toBe(302);
    expect(res.headers['set-cookie']).toBeDefined();
    operacaoCookie = res.headers['set-cookie'];
  });

  test('Deve acessar o dashboard autenticado como admin', async () => {
    const res = await request(app)
      .get('/')
      .set('Cookie', adminCookie);

    expect(res.statusCode).toBe(200);
  });

  test('Deve fazer logout com sucesso', async () => {
    const res = await request(app)
      .get('/logout')
      .set('Cookie', adminCookie);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');

    // Re-loga para os próximos testes
    const loginRes = await request(app)
      .post('/login')
      .send({ email: 'admin@sistema.com', senha: 'admin123' });
    adminCookie = loginRes.headers['set-cookie'];
  });

  // ─── CONTROLE DE ACESSO ─────────────────────────────────────────────────────

  test('Operador NÃO deve acessar gerenciamento de usuários (403)', async () => {
    const res = await request(app)
      .get('/usuarios')
      .set('Cookie', operacaoCookie);
    expect(res.statusCode).toBe(403);
  });

  test('Admin DEVE acessar gerenciamento de usuários (200)', async () => {
    const res = await request(app)
      .get('/usuarios')
      .set('Cookie', adminCookie);
    expect(res.statusCode).toBe(200);
  });

  // ─── CRUD DE USUÁRIOS (via API) ──────────────────────────────────────────────

  test('Admin deve criar novo usuário via API', async () => {
    const res = await request(app)
      .post('/api/usuarios')
      .set('Cookie', adminCookie)
      .send({
        nome: 'Financeiro Teste',
        email: 'financeiro.teste@sistema.com',
        senha: 'fin123456',
        tipo: 'financeiro'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();

    // Limpa o usuário criado
    await db.run('DELETE FROM usuarios WHERE id = ?', [res.body.id]);
  });

  test('Deve rejeitar criação de usuário com email duplicado', async () => {
    const res = await request(app)
      .post('/api/usuarios')
      .set('Cookie', adminCookie)
      .send({
        nome: 'Duplicado',
        email: 'admin@sistema.com',
        senha: 'qualquer123',
        tipo: 'operacao'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('já cadastrado');
  });

  test('Operador NÃO deve criar usuário via API (403)', async () => {
    const res = await request(app)
      .post('/api/usuarios')
      .set('Cookie', operacaoCookie)
      .send({
        nome: 'Invasor',
        email: 'invasor@sistema.com',
        senha: 'senha123',
        tipo: 'operacao'
      });
    expect(res.statusCode).toBe(403);
  });

  // ─── CRUD DE NOTAS FISCAIS ──────────────────────────────────────────────────

  test('Deve criar uma nova nota fiscal via API', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock pdf data');

    const res = await request(app)
      .post('/api/notas')
      .set('Cookie', adminCookie)
      .field('tipo_nota', 'NF/AP')
      .field('numero_nota', '2026-TESTE-99')
      .field('cnpj_cpf', '12.345.678/0001-90')
      .field('fornecedor', 'Fornecedor Teste S/A')
      .field('data_emissao', '2026-05-27')
      .field('data_vencimento', '2026-06-27')
      .field('valor', '500.50')
      .field('descricao', 'Testando criação de nota')
      .field('centro_custo', 'TI')
      .attach('pdf_nota', pdfBuffer, { filename: 'nota.pdf', contentType: 'application/pdf' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
    testNotaId = res.body.id;
  });

  test('Deve rejeitar nota sem campos obrigatórios', async () => {
    const res = await request(app)
      .post('/api/notas')
      .set('Cookie', adminCookie)
      .field('tipo_nota', 'NF/AP');
    // Sem pdf e campos obrigatórios
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('Deve carregar os detalhes da nota fiscal criada', async () => {
    const res = await request(app)
      .get(`/nota/${testNotaId}`)
      .set('Cookie', adminCookie);

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('2026-TESTE-99');
    expect(res.text).toContain('Fornecedor Teste S/A');
  });

  test('Deve retornar 404 para nota inexistente', async () => {
    const res = await request(app)
      .get('/nota/999999')
      .set('Cookie', adminCookie);
    expect(res.statusCode).toBe(404);
  });

  // ─── FLUXO DE TRABALHO (WORKFLOW) ───────────────────────────────────────────

  test('Deve enviar nota para o financeiro (status: entrada → financeiro)', async () => {
    const res = await request(app)
      .post(`/api/notas/${testNotaId}/enviar-financeiro`)
      .set('Cookie', adminCookie);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const nota = await db.get('SELECT status FROM notas_fiscais WHERE id = ?', [testNotaId]);
    expect(nota.status).toBe('financeiro');
  });

  test('Operador NÃO deve confirmar pagamento', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock');
    const res = await request(app)
      .post(`/api/notas/${testNotaId}/confirmar-pagamento`)
      .set('Cookie', operacaoCookie)
      .field('data_pagamento', '2026-05-28')
      .attach('pdf_comprovante', pdfBuffer, { filename: 'comp.pdf', contentType: 'application/pdf' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('permissão');
  });

  test('Admin deve confirmar pagamento com comprovante (status: financeiro → guarda)', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock receipt pdf');

    const res = await request(app)
      .post(`/api/notas/${testNotaId}/confirmar-pagamento`)
      .set('Cookie', adminCookie)
      .field('data_pagamento', '2026-05-28')
      .attach('pdf_comprovante', pdfBuffer, { filename: 'comprovante.pdf', contentType: 'application/pdf' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id = ?', [testNotaId]);
    expect(nota.status).toBe('guarda');
    expect(nota.data_pagamento).toBe('2026-05-28');
    expect(nota.pdf_comprovante_url).toBeDefined();
    expect(nota.pdf_comprovante_url).not.toBeNull();
  });

  test('Deve rejeitar confirmação de pagamento sem comprovante PDF', async () => {
    const res = await request(app)
      .post(`/api/notas/${testNotaId}/confirmar-pagamento`)
      .set('Cookie', adminCookie)
      .send({ data_pagamento: '2026-05-28' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('Deve excluir a nota fiscal e arquivos associados', async () => {
    const res = await request(app)
      .delete(`/api/notas/${testNotaId}`)
      .set('Cookie', adminCookie);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id = ?', [testNotaId]);
    expect(nota).toBeNull();
    testNotaId = null; // Já excluído, não precisa limpar no afterAll
  });
});
