require('dotenv').config();

const express = require('express');
const db = require('./db-adapter');
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

    if (tipo === 'administrador') {
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
        const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);
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
        res.render('login', { erro: 'Erro interno do servidor ao autenticar' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ROTAS - GERENCIAMENTO DE USUÁRIOS (APENAS ADMIN)
app.get('/usuarios', verificarAuth, verificarAdmin, async (req, res) => {
    try {
        const usuarios = await db.all('SELECT id, nome, email, tipo, created_at FROM usuarios ORDER BY created_at DESC');
        res.render('usuarios', {
            usuario: req.session.usuario,
            usuarios: usuarios
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
        const usuarioExistente = await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);
        if (usuarioExistente) {
            return res.json({ success: false, error: 'Email já cadastrado' });
        }

        const hash = await bcrypt.hash(senha, 10);
        const result = await db.run(
            `INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)`,
            [nome, email, hash, tipo]
        );
        res.json({ success: true, id: result.lastID });
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
            await db.run(
                `UPDATE usuarios SET nome = ?, email = ?, tipo = ?, senha = ? WHERE id = ?`,
                [nome, email, tipo, hash, userId]
            );
        } else {
            await db.run(
                `UPDATE usuarios SET nome = ?, email = ?, tipo = ? WHERE id = ?`,
                [nome, email, tipo, userId]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao atualizar usuário:', err);
        res.json({ success: false, error: 'Erro ao atualizar usuário: ' + err.message });
    }
});

app.delete('/api/usuarios/:id', verificarAuth, verificarAdmin, async (req, res) => {
    const userId = req.params.id;

    if (parseInt(userId) === req.session.usuario.id) {
        return res.json({ success: false, error: 'Você não pode excluir seu próprio usuário' });
    }

    try {
        await db.run('DELETE FROM usuarios WHERE id = ?', [userId]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao excluir usuário:', err);
        res.json({ success: false, error: 'Erro ao excluir usuário: ' + err.message });
    }
});

// ROTAS - DASHBOARD
app.get('/', verificarAuth, async (req, res) => {
    try {
        const notas = await db.all('SELECT * FROM notas_fiscais ORDER BY created_at DESC');
        const stats = await db.all(`SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'entrada' THEN 1 ELSE 0 END) as entrada,
                    SUM(CASE WHEN status = 'financeiro' THEN 1 ELSE 0 END) as financeiro,
                    SUM(CASE WHEN status = 'guarda' THEN 1 ELSE 0 END) as guarda,
                    SUM(CASE WHEN tipo_nota = 'NF/AP' THEN 1 ELSE 0 END) as nfap,
                    SUM(CASE WHEN tipo_nota = 'Insumo' THEN 1 ELSE 0 END) as insumo,
                    SUM(valor) as valor_total
                FROM notas_fiscais`);

        const estatisticas = stats[0] || {
            total: 0, entrada: 0, financeiro: 0, guarda: 0,
            nfap: 0, insumo: 0, valor_total: 0
        };

        // Correção de tipagem para valores nulos vindos do banco
        estatisticas.total = parseInt(estatisticas.total || 0);
        estatisticas.entrada = parseInt(estatisticas.entrada || 0);
        estatisticas.financeiro = parseInt(estatisticas.financeiro || 0);
        estatisticas.guarda = parseInt(estatisticas.guarda || 0);
        estatisticas.nfap = parseInt(estatisticas.nfap || 0);
        estatisticas.insumo = parseInt(estatisticas.insumo || 0);
        estatisticas.valor_total = parseFloat(estatisticas.valor_total || 0);

        res.render('index', {
            usuario: req.session.usuario,
            notas: notas,
            stats: estatisticas
        });
    } catch (err) {
        console.error('❌ Erro ao carregar notas:', err);
        res.status(500).send('Erro ao carregar dados do dashboard');
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

    const sql = `INSERT INTO notas_fiscais 
            (tipo_nota, numero_nota, chave_acesso, cnpj_cpf, fornecedor, data_emissao, data_vencimento, valor, descricao, centro_custo, 
             status, pdf_nota_url, observacoes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entrada', ?, ?)`;

    const params = [
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
    ];

    try {
        const result = await db.run(sql, params);
        res.json({ success: true, id: result.lastID });
    } catch (err) {
        console.error('❌ Erro ao criar nota fiscal:', err);
        res.json({ success: false, error: 'Erro ao criar nota fiscal: ' + err.message });
    }
});

// ROTAS - DETALHES DA NOTA
app.get('/nota/:id', verificarAuth, async (req, res) => {
    const notaId = req.params.id;

    try {
        const nota = await db.get('SELECT * FROM notas_fiscais WHERE id = ?', [notaId]);
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
        await db.run('UPDATE notas_fiscais SET status = ? WHERE id = ?', ['financeiro', notaId]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao enviar nota para o financeiro:', err);
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
        await db.run(`UPDATE notas_fiscais 
                SET status = 'guarda', data_pagamento = ?, pdf_comprovante_url = ? 
                WHERE id = ?`,
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
        const nota = await db.get('SELECT * FROM notas_fiscais WHERE id = ?', [notaId]);
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

        await db.run('DELETE FROM notas_fiscais WHERE id = ?', [notaId]);
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
        const nota = await db.get(`SELECT ${campo} FROM notas_fiscais WHERE id = ?`, [notaId]);
        if (!nota || !nota[campo]) {
            return res.json({ success: false, error: 'Arquivo não encontrado' });
        }

        const caminhoArquivo = path.join(__dirname, 'uploads', nota[campo]);
        if (fs.existsSync(caminhoArquivo)) {
            fs.unlinkSync(caminhoArquivo);
        }

        await db.run(`UPDATE notas_fiscais SET ${campo} = NULL WHERE id = ?`, [notaId]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro ao excluir PDF:', err);
        res.json({ success: false, error: 'Erro ao atualizar banco' });
    }
});

// INICIAR SERVIDOR (apenas se executado diretamente, não via testes)
if (require.main === module) {
    db.init().then(() => {
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
    }).catch(err => {
        console.error('❌ Falha crítica ao inicializar o banco de dados:', err);
        process.exit(1);
    });
}

module.exports = app;
