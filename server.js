require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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

// Banco de dados
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco:', err);
    } else {
        console.log('✅ Conectado ao banco de dados SQLite');
        initDatabase();
    }
});

function initDatabase() {
    // Tabela de usuários
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Adicionar coluna 'tipo' se não existir
    db.run(`ALTER TABLE usuarios ADD COLUMN tipo TEXT DEFAULT 'usuario'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Erro ao adicionar coluna tipo:', err);
        } else if (!err) {
            console.log('✅ Coluna "tipo" adicionada à tabela usuarios');
        }
    });

    // Tabela de notas fiscais
    db.run(`
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Criar usuário admin padrão
    db.get("SELECT * FROM usuarios WHERE email = ?", ['admin@sistema.com'], (err, usuario) => {
        if (err) {
            console.error('❌ Erro ao verificar usuário admin:', err);
            return;
        }
        if (!usuario) {
            bcrypt.hash('admin123', 10, (err, hash) => {
                if (err) {
                    console.error('❌ Erro ao gerar hash da senha:', err);
                    return;
                }
                db.run(
                    `INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)`,
                    ['Administrador', 'admin@sistema.com', hash, 'admin'],
                    (err) => {
                        if (err) {
                            console.error('❌ Erro ao criar usuário admin:', err);
                        } else {
                            console.log('✅ Usuário admin criado: admin@sistema.com / admin123');
                        }
                    }
                );
            });
        } else {
            db.run(`UPDATE usuarios SET tipo = 'admin' WHERE email = 'admin@sistema.com'`, (err) => {
                if (!err) {
                    console.log('✅ Usuário admin atualizado para tipo "admin"');
                }
            });
        }
    });
}

// ROTAS - LOGIN
app.get('/login', (req, res) => {
    if (req.session && req.session.usuario) {
        return res.redirect('/');
    }
    res.render('login', { erro: null });
});

app.post('/login', (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.render('login', { erro: 'Email e senha são obrigatórios' });
    }

    db.get('SELECT * FROM usuarios WHERE email = ?', [email], (err, usuario) => {
        if (err || !usuario) {
            return res.render('login', { erro: 'Email ou senha incorretos' });
        }

        bcrypt.compare(senha, usuario.senha, (err, match) => {
            if (err || !match) {
                return res.render('login', { erro: 'Email ou senha incorretos' });
            }

            req.session.usuario = {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                tipo: usuario.tipo || 'usuario'
            };

            res.redirect('/');
        });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ROTAS - GERENCIAMENTO DE USUÁRIOS (APENAS ADMIN)
app.get('/usuarios', verificarAuth, verificarAdmin, (req, res) => {
    db.all('SELECT id, nome, email, tipo, created_at FROM usuarios ORDER BY created_at DESC', (err, usuarios) => {
        if (err) {
            console.error('❌ Erro ao carregar usuários:', err);
            return res.status(500).send('Erro ao carregar usuários');
        }
        res.render('usuarios', {
            usuario: req.session.usuario,
            usuarios: usuarios
        });
    });
});

app.post('/api/usuarios', verificarAuth, verificarAdmin, (req, res) => {
    const { nome, email, senha, tipo } = req.body;

    if (!nome || !email || !senha || !tipo) {
        return res.json({ success: false, error: 'Todos os campos são obrigatórios' });
    }

    db.get('SELECT * FROM usuarios WHERE email = ?', [email], (err, usuarioExistente) => {
        if (err) {
            return res.json({ success: false, error: 'Erro ao verificar email no banco' });
        }

        if (usuarioExistente) {
            return res.json({ success: false, error: 'Email já cadastrado' });
        }

        bcrypt.hash(senha, 10, (err, hash) => {
            if (err) {
                return res.json({ success: false, error: 'Erro ao criar senha' });
            }

            db.run(
                `INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)`,
                [nome, email, hash, tipo],
                function (err) {
                    if (err) {
                        return res.json({ success: false, error: 'Erro ao criar usuário: ' + err.message });
                    }
                    res.json({ success: true, id: this.lastID });
                }
            );
        });
    });
});

app.put('/api/usuarios/:id', verificarAuth, verificarAdmin, (req, res) => {
    const userId = req.params.id;
    const { nome, email, tipo, senha } = req.body;

    if (!nome || !email || !tipo) {
        return res.json({ success: false, error: 'Nome, email e tipo são obrigatórios' });
    }

    if (senha && senha.trim() !== '') {
        bcrypt.hash(senha, 10, (err, hash) => {
            if (err) {
                return res.json({ success: false, error: 'Erro ao atualizar senha' });
            }

            db.run(
                `UPDATE usuarios SET nome = ?, email = ?, tipo = ?, senha = ? WHERE id = ?`,
                [nome, email, tipo, hash, userId],
                (err) => {
                    if (err) {
                        return res.json({ success: false, error: 'Erro ao atualizar usuário' });
                    }
                    res.json({ success: true });
                }
            );
        });
    } else {
        db.run(
            `UPDATE usuarios SET nome = ?, email = ?, tipo = ? WHERE id = ?`,
            [nome, email, tipo, userId],
            (err) => {
                if (err) {
                    return res.json({ success: false, error: 'Erro ao atualizar usuário' });
                }
                res.json({ success: true });
            }
        );
    }
});

app.delete('/api/usuarios/:id', verificarAuth, verificarAdmin, (req, res) => {
    const userId = req.params.id;

    if (parseInt(userId) === req.session.usuario.id) {
        return res.json({ success: false, error: 'Você não pode excluir seu próprio usuário' });
    }

    db.run('DELETE FROM usuarios WHERE id = ?', [userId], (err) => {
        if (err) {
            return res.json({ success: false, error: 'Erro ao excluir usuário' });
        }
        res.json({ success: true });
    });
});

// ROTAS - DASHBOARD
app.get('/', verificarAuth, (req, res) => {
    db.all('SELECT * FROM notas_fiscais ORDER BY created_at DESC', (err, notas) => {
        if (err) {
            console.error('❌ Erro ao carregar notas:', err);
            return res.status(500).send('Erro ao carregar notas');
        }

        db.all(`SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'entrada' THEN 1 ELSE 0 END) as entrada,
                    SUM(CASE WHEN status = 'financeiro' THEN 1 ELSE 0 END) as financeiro,
                    SUM(CASE WHEN status = 'guarda' THEN 1 ELSE 0 END) as guarda,
                    SUM(CASE WHEN tipo_nota = 'NF/AP' THEN 1 ELSE 0 END) as nfap,
                    SUM(CASE WHEN tipo_nota = 'Insumo' THEN 1 ELSE 0 END) as insumo,
                    SUM(valor) as valor_total
                FROM notas_fiscais`, (err, stats) => {

            const estatisticas = stats[0] || {
                total: 0, entrada: 0, financeiro: 0, guarda: 0,
                nfap: 0, insumo: 0, valor_total: 0
            };

            res.render('index', {
                usuario: req.session.usuario,
                notas: notas,
                stats: estatisticas
            });
        });
    });
});

// ROTAS - NOVA NOTA
app.get('/nova-nota', verificarAuth, (req, res) => {
    res.render('nova-nota', { usuario: req.session.usuario });
});

app.post('/api/notas', verificarAuth, upload.single('pdf_nota'), (req, res) => {
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

    db.run(sql, params, function(err) {
        if (err) {
            return res.json({ success: false, error: 'Erro ao criar nota fiscal: ' + err.message });
        }
        res.json({ success: true, id: this.lastID });
    });
});

// ROTAS - DETALHES DA NOTA
app.get('/nota/:id', verificarAuth, (req, res) => {
    const notaId = req.params.id;

    db.get('SELECT * FROM notas_fiscais WHERE id = ?', [notaId], (err, nota) => {
        if (err) {
            console.error('❌ Erro ao buscar nota:', err);
            return res.status(500).send('Erro ao carregar nota');
        }
        if (!nota) {
            return res.status(404).send('Nota não encontrada');
        }

        res.render('detalhes-nota', {
            usuario: req.session.usuario,
            nota: nota
        });
    });
});

// ROTAS - FLUXO DE TRABALHO
app.post('/api/notas/:id/enviar-financeiro', verificarAuth, (req, res) => {
    const notaId = req.params.id;

    db.run('UPDATE notas_fiscais SET status = ? WHERE id = ?', ['financeiro', notaId], (err) => {
        if (err) {
            return res.json({ success: false, error: 'Erro ao enviar nota' });
        }
        res.json({ success: true });
    });
});

app.post('/api/notas/:id/confirmar-pagamento', verificarAuth, upload.single('pdf_comprovante'), (req, res) => {
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

    db.run(`UPDATE notas_fiscais 
            SET status = 'guarda', data_pagamento = ?, pdf_comprovante_url = ? 
            WHERE id = ?`,
        [data_pagamento, pdf_comprovante_url, notaId],
        (err) => {
            if (err) {
                return res.json({ success: false, error: 'Erro ao confirmar pagamento' });
            }
            res.json({ success: true });
        }
    );
});

// ROTAS - EXCLUIR
app.delete('/api/notas/:id', verificarAuth, (req, res) => {
    const notaId = req.params.id;

    db.get('SELECT * FROM notas_fiscais WHERE id = ?', [notaId], (err, nota) => {
        if (err || !nota) {
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

        db.run('DELETE FROM notas_fiscais WHERE id = ?', [notaId], (err) => {
            if (err) {
                return res.json({ success: false, error: 'Erro ao excluir nota' });
            }
            res.json({ success: true });
        });
    });
});

app.post('/api/notas/:id/excluir-pdf', verificarAuth, (req, res) => {
    const notaId = req.params.id;
    const { tipo } = req.body;

    const campo = tipo === 'nota' ? 'pdf_nota_url' : 'pdf_comprovante_url';

    db.get(`SELECT ${campo} FROM notas_fiscais WHERE id = ?`, [notaId], (err, nota) => {
        if (err || !nota || !nota[campo]) {
            return res.json({ success: false, error: 'Arquivo não encontrado' });
        }

        const caminhoArquivo = path.join(__dirname, 'uploads', nota[campo]);
        if (fs.existsSync(caminhoArquivo)) {
            fs.unlinkSync(caminhoArquivo);
        }

        db.run(`UPDATE notas_fiscais SET ${campo} = NULL WHERE id = ?`, [notaId], (err) => {
            if (err) {
                return res.json({ success: false, error: 'Erro ao atualizar banco' });
            }
            res.json({ success: true });
        });
    });
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
