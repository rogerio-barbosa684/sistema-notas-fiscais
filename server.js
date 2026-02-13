require('dotenv').config();

const express = require('express');
const db = require('./db');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'kJ8#mP2$nQ9@vR5&wT7!xY3%zA1^bC4*dE6',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Middleware de autenticação
function verificarAuth(req, res, next) {
    if (req.session && req.session.usuario) {
        return next();
    }
    res.redirect('/login');
}

// Middleware para verificar se é admin
function verificarAdmin(req, res, next) {
    const tipo = req.session?.usuario?.tipo;

    if (tipo === 'admin' || tipo === 'administrador') {
        return next();
    }

    res.status(403).send('Acesso negado. Apenas administradores podem acessar esta página.');
}

// Criar pasta uploads se não existir
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
    console.log('✅ Pasta uploads/ criada');
}

// Configuração do Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF são permitidos!'));
        }
    }
});

// Inicializar banco de dados PostgreSQL
async function initDatabase() {
    try {
        // Tabela de usuários
        await db.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL,
                tipo TEXT DEFAULT 'usuario',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de notas fiscais
        await db.query(`
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

        console.log('✅ Tabelas criadas/verificadas no PostgreSQL');

        // Criar usuário admin padrão
        const { rows } = await db.query("SELECT * FROM usuarios WHERE email = $1", ['admin@sistema.com']);

        if (rows.length === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            await db.query(
                `INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4)`,
                ['Administrador', 'admin@sistema.com', hash, 'admin']
            );
            console.log('✅ Usuário admin criado: admin@sistema.com / admin123');
        } else {
            await db.query(`UPDATE usuarios SET tipo = 'admin' WHERE email = 'admin@sistema.com'`);
            console.log('✅ Usuário admin já existe');
        }
    } catch (err) {
        console.error('❌ Erro ao inicializar banco:', err);
    }
}

initDatabase();

// ROTAS - LOGIN
app.get('/login', (req, res) => {
    if (req.session && req.session.usuario) {
        return res.redirect('/');
    }
    res.render('login', { erro: null });
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.render('login', { erro: 'Email e senha são obrigatórios' });
    }

    try {
        const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        const usuario = rows[0];

        if (!usuario) {
            return res.render('login', { erro: 'Email ou senha incorretos' });
        }

        const match = await bcrypt.compare(senha, usuario.senha);
        if (!match) {
            return res.render('login', { erro: 'Email ou senha incorretos' });
        }

        req.session.usuario = {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            tipo: usuario.tipo || 'usuario'
        };

        res.redirect('/');
    } catch (err) {
        console.error('❌ Erro no login:', err);
        res.render('login', { erro: 'Erro ao fazer login' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ROTAS - GERENCIAMENTO DE USUÁRIOS (APENAS ADMIN)
app.get('/usuarios', verificarAuth, verificarAdmin, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT id, nome, email, tipo, created_at FROM usuarios ORDER BY created_at DESC');
        res.render('usuarios', {
            usuario: req.session.usuario,
            usuarios: rows
        });
    } catch (err) {
        console.error('❌ Erro ao carregar usuários:', err);
        res.status(500).send('Erro ao carregar usuários');
    }
});

app.post('/api/usuarios', verificarAuth, verificarAdmin, async (req, res) => {
    const { nome, email, senha, tipo } = req.body;

    if (!nome || !email || !senha || !tipo) {
        return res.json({ success: false, error: 'Todos os campos são obrigatórios' });
    }

    try {
        const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);

        if (rows.length > 0) {
            return res.json({ success: false, error: 'Email já cadastrado' });
        }

        const hash = await bcrypt.hash(senha, 10);
        const result = await db.query(
            `INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id`,
            [nome, email, hash, tipo]
        );

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('❌ Erro ao criar usuário:', err);
        res.json({ success: false, error: 'Erro ao criar usuário: ' + err.message });
    }
});

app.put('/api/usuarios/:id', verificarAuth, verificarAdmin, async (req, res) => {
    const userId = req.params.id;
    const { nome, email, tipo, senha } = req.body;

    if (!nome || !email || !tipo) {
        return res.json({ success: false, error: 'Nome, email e tipo são obrigatórios' });
    }

    try {
        if (senha && senha.trim() !== '') {
            const hash = await bcrypt.hash(senha, 10);
            await db.query(
                `UPDATE usuarios SET nome = $1, email = $2, tipo = $3, senha = $4 WHERE id = $5`,
                [nome, email, tipo, hash, userId]
            );
        } else {
            await db.query(
                `UPDATE usuarios SET nome = $1, email = $2, tipo = $3 WHERE id = $4`,
                [nome, email, tipo, userId]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao atualizar usuário:', err);
        res.json({ success: false, error: 'Erro ao atualizar usuário' });
    }
});

app.delete('/api/usuarios/:id', verificarAuth, verificarAdmin, async (req, res) => {
    const userId = req.params.id;

    if (parseInt(userId) === req.session.usuario.id) {
        return res.json({ success: false, error: 'Você não pode excluir seu próprio usuário' });
    }

    try {
        await db.query('DELETE FROM usuarios WHERE id = $1', [userId]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao excluir usuário:', err);
        res.json({ success: false, error: 'Erro ao excluir usuário' });
    }
});

// ROTAS - DASHBOARD
app.get('/', verificarAuth, async (req, res) => {
    try {
        const notasResult = await db.query('SELECT * FROM notas_fiscais ORDER BY created_at DESC');
        const notas = notasResult.rows;

        const statsResult = await db.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'entrada' THEN 1 ELSE 0 END) as entrada,
                SUM(CASE WHEN status = 'financeiro' THEN 1 ELSE 0 END) as financeiro,
                SUM(CASE WHEN status = 'guarda' THEN 1 ELSE 0 END) as guarda,
                SUM(CASE WHEN tipo_nota = 'NF/AP' THEN 1 ELSE 0 END) as nfap,
                SUM(CASE WHEN tipo_nota = 'Insumo' THEN 1 ELSE 0 END) as insumo,
                SUM(valor) as valor_total
            FROM notas_fiscais
        `);

        const estatisticas = statsResult.rows[0] || {
            total: 0, entrada: 0, financeiro: 0, guarda: 0,
            nfap: 0, insumo: 0, valor_total: 0
        };

        res.render('index', {
            usuario: req.session.usuario,
            notas: notas,
            stats: estatisticas
        });
    } catch (err) {
        console.error('❌ Erro ao carregar dashboard:', err);
        res.status(500).send('Erro ao carregar dashboard');
    }
});

// ROTAS - NOVA NOTA
app.get('/nova-nota', verificarAuth, (req, res) => {
    res.render('nova-nota', { usuario: req.session.usuario });
});

app.post('/api/notas', verificarAuth, upload.single('pdf_nota'), async (req, res) => {
    const {
        tipo_nota,
        numero_nota,
        chave_acesso,
        cnpj_cpf,
        fornecedor,
        data_emissao,
        data_vencimento,
        valor,
        descricao,
        centro_custo,
        observacoes
    } = req.body;

    const pdf_nota_url = req.file ? req.file.filename : null;

    if (!tipo_nota || !numero_nota || !cnpj_cpf || !fornecedor || !data_emissao || !data_vencimento || !valor || !pdf_nota_url) {
        return res.json({
            success: false,
            error: 'Campos obrigatórios faltando'
        });
    }

    try {
        const result = await db.query(
            `INSERT INTO notas_fiscais 
            (tipo_nota, numero_nota, chave_acesso, cnpj_cpf, fornecedor, data_emissao, data_vencimento, valor, descricao, centro_custo, 
             status, pdf_nota_url, observacoes) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'entrada', $11, $12) RETURNING id`,
            [
                tipo_nota,
                numero_nota,
                chave_acesso || null,
                cnpj_cpf,
                fornecedor,
                data_emissao,
                data_vencimento,
                parseFloat(valor),
                descricao || null,
                centro_custo || null,
                pdf_nota_url,
                observacoes || null
            ]
        );

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('❌ Erro ao criar nota:', err);
        res.json({ success: false, error: 'Erro ao criar nota fiscal: ' + err.message });
    }
});

// ROTAS - DETALHES DA NOTA
app.get('/nota/:id', verificarAuth, async (req, res) => {
    const notaId = req.params.id;

    try {
        const { rows } = await db.query('SELECT * FROM notas_fiscais WHERE id = $1', [notaId]);
        const nota = rows[0];

        if (!nota) {
            return res.status(404).send('Nota não encontrada');
        }

        res.render('detalhes-nota', {
            usuario: req.session.usuario,
            nota: nota
        });
    } catch (err) {
        console.error('❌ Erro ao buscar nota:', err);
        res.status(500).send('Erro ao carregar nota');
    }
});

// ROTAS - FLUXO DE TRABALHO
app.post('/api/notas/:id/enviar-financeiro', verificarAuth, async (req, res) => {
    const notaId = req.params.id;

    try {
        await db.query('UPDATE notas_fiscais SET status = $1 WHERE id = $2', ['financeiro', notaId]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao enviar nota:', err);
        res.json({ success: false, error: 'Erro ao enviar nota' });
    }
});

app.post('/api/notas/:id/confirmar-pagamento', verificarAuth, upload.single('pdf_comprovante'), async (req, res) => {
    const tipoUsuario = req.session?.usuario?.tipo;

    if (tipoUsuario === 'operacao') {
        return res.json({
            success: false,
            error: 'Você não tem permissão para confirmar pagamentos. Apenas Administradores e Financeiro podem fazer isso.'
        });
    }

    const notaId = req.params.id;
    const { data_pagamento } = req.body;
    const pdf_comprovante_url = req.file ? req.file.filename : null;

    if (!data_pagamento || !pdf_comprovante_url) {
        return res.json({ success: false, error: 'Data de pagamento e comprovante são obrigatórios' });
    }

    try {
        await db.query(
            `UPDATE notas_fiscais 
            SET status = 'guarda', data_pagamento = $1, pdf_comprovante_url = $2 
            WHERE id = $3`,
            [data_pagamento, pdf_comprovante_url, notaId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao confirmar pagamento:', err);
        res.json({ success: false, error: 'Erro ao confirmar pagamento' });
    }
});

// ROTAS - EXCLUIR
app.delete('/api/notas/:id', verificarAuth, async (req, res) => {
    const notaId = req.params.id;

    try {
        const { rows } = await db.query('SELECT * FROM notas_fiscais WHERE id = $1', [notaId]);
        const nota = rows[0];

        if (!nota) {
            return res.json({ success: false, error: 'Nota não encontrada' });
        }

        if (nota.pdf_nota_url) {
            const caminhoNota = path.join(__dirname, 'uploads', nota.pdf_nota_url);
            if (fs.existsSync(caminhoNota)) fs.unlinkSync(caminhoNota);
        }
        if (nota.pdf_comprovante_url) {
            const caminhoComp = path.join(__dirname, 'uploads', nota.pdf_comprovante_url);
            if (fs.existsSync(caminhoComp)) fs.unlinkSync(caminhoComp);
        }

        await db.query('DELETE FROM notas_fiscais WHERE id = $1', [notaId]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao excluir nota:', err);
        res.json({ success: false, error: 'Erro ao excluir nota' });
    }
});

app.post('/api/notas/:id/excluir-pdf', verificarAuth, async (req, res) => {
    const notaId = req.params.id;
    const { tipo } = req.body;

    const campo = tipo === 'nota' ? 'pdf_nota_url' : 'pdf_comprovante_url';

    try {
        const { rows } = await db.query(`SELECT ${campo} FROM notas_fiscais WHERE id = $1`, [notaId]);
        const nota = rows[0];

        if (!nota || !nota[campo]) {
            return res.json({ success: false, error: 'Arquivo não encontrado' });
        }

        const caminhoArquivo = path.join(__dirname, 'uploads', nota[campo]);
        if (fs.existsSync(caminhoArquivo)) {
            fs.unlinkSync(caminhoArquivo);
        }

        await db.query(`UPDATE notas_fiscais SET ${campo} = NULL WHERE id = $1`, [notaId]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao excluir PDF:', err);
        res.json({ success: false, error: 'Erro ao atualizar banco' });
    }
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🚀 SERVIDOR INICIADO COM SUCESSO!');
    console.log('========================================');
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📋 Login: http://localhost:${PORT}/login`);
    console.log(`👤 Usuário: admin@sistema.com`);
    console.log(`🔑 Senha: admin123`);
    console.log(`📁 Pasta uploads: ${path.join(__dirname, 'uploads')}`);
    console.log('========================================\n');
});
