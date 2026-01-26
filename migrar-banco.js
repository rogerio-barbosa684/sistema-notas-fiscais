const sqlite3 = require('sqlite3').verbose();

console.log('🔧 === MIGRAÇÃO DO BANCO DE DADOS ===');
console.log('Preservando suas notas antigas...\n');

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco:', err.message);
        process.exit(1);
    }
    console.log('✅ Conectado ao banco SQLite\n');
    
    // Verificar colunas existentes
    db.all("PRAGMA table_info(notas_fiscais)", (err, columns) => {
        if (err) {
            console.error('❌ Erro ao verificar colunas:', err.message);
            db.close();
            process.exit(1);
            return;
        }
        
        const colunasExistentes = columns.map(col => col.name);
        console.log('📋 Colunas atuais na tabela notas_fiscais:');
        console.log('   ' + colunasExistentes.join(', '));
        console.log('');
        
        let migracoes = 0;
        let erros = [];
        let tarefasConcluidas = 0;
        const totalTarefas = 4; // 3 colunas + 1 tabela
        
        // Função para verificar se todas as tarefas foram concluídas
        function verificarConclusao() {
            tarefasConcluidas++;
            if (tarefasConcluidas === totalTarefas) {
                finalizarMigracao();
            }
        }
        
        // Função para executar migração de coluna
        function migrarColuna(nomeColuna, tipoColuna) {
            if (!colunasExistentes.includes(nomeColuna)) {
                console.log(`➕ Adicionando coluna: ${nomeColuna} (${tipoColuna})`);
                db.run(`ALTER TABLE notas_fiscais ADD COLUMN ${nomeColuna} ${tipoColuna}`, (err) => {
                    if (err) {
                        console.error(`❌ Erro ao adicionar ${nomeColuna}:`, err.message);
                        erros.push(`${nomeColuna}: ${err.message}`);
                    } else {
                        console.log(`✅ Coluna ${nomeColuna} adicionada com sucesso`);
                        migracoes++;
                    }
                    verificarConclusao();
                });
            } else {
                console.log(`✓ Coluna ${nomeColuna} já existe`);
                verificarConclusao();
            }
        }
        
        // Migração 1: usuario_criador_id
        migrarColuna('usuario_criador_id', 'INTEGER');
        
        // Migração 2: data_pagamento
        migrarColuna('data_pagamento', 'DATE');
        
        // Migração 3: pdf_comprovante_url
        migrarColuna('pdf_comprovante_url', 'TEXT');
        
        // Migração 4: Verificar e criar tabela workflow_historico
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_historico'", (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar tabela workflow_historico:', err.message);
                erros.push('workflow_historico: ' + err.message);
                verificarConclusao();
            } else if (!row) {
                console.log('➕ Criando tabela workflow_historico');
                db.run(`
                    CREATE TABLE workflow_historico (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        nota_fiscal_id INTEGER,
                        status_anterior TEXT,
                        status_novo TEXT,
                        usuario_id INTEGER,
                        usuario_nome TEXT,
                        data_mudanca DATETIME DEFAULT CURRENT_TIMESTAMP,
                        observacao TEXT,
                        FOREIGN KEY (nota_fiscal_id) REFERENCES notas_fiscais(id),
                        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
                    )
                `, (err) => {
                    if (err) {
                        console.error('❌ Erro ao criar workflow_historico:', err.message);
                        erros.push('workflow_historico: ' + err.message);
                    } else {
                        console.log('✅ Tabela workflow_historico criada com sucesso');
                        migracoes++;
                    }
                    verificarConclusao();
                });
            } else {
                console.log('✓ Tabela workflow_historico já existe');
                verificarConclusao();
            }
        });
        
        function finalizarMigracao() {
            console.log('\n' + '='.repeat(60));
            console.log('📊 RESUMO DA MIGRAÇÃO:');
            console.log(`   ✅ ${migracoes} alteração(ões) realizada(s) com sucesso`);
            console.log(`   ❌ ${erros.length} erro(s) encontrado(s)`);
            console.log('='.repeat(60));
            
            if (erros.length > 0) {
                console.log('\n⚠️  ERROS ENCONTRADOS:');
                erros.forEach(erro => console.log(`   - ${erro}`));
                console.log('\n💡 ATENÇÃO: O sistema pode funcionar parcialmente.');
                console.log('   Mas o cadastro de novas notas pode falhar.');
                console.log('   Recomendo verificar os erros acima.');
            } else {
                console.log('\n🎉 MIGRAÇÃO CONCLUÍDA COM SUCESSO!');
                console.log('   ✅ Todas as suas notas antigas foram preservadas');
                console.log('   ✅ O banco de dados está atualizado');
                console.log('   ✅ O sistema agora está 100% funcional');
            }
            
            console.log('\n🚀 PRÓXIMO PASSO:');
            console.log('   Execute o comando: npm start');
            console.log('   Depois acesse: http://localhost:3000/login');
            console.log('='.repeat(60) + '\n');
            
            db.close((err) => {
                if (err) {
                    console.error('❌ Erro ao fechar banco:', err.message);
                }
                process.exit(0);
            });
        }
    });
});
