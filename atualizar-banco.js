const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

console.log('🔄 Atualizando estrutura do banco de dados...');

const updates = [
    `ALTER TABLE notas_fiscais ADD COLUMN cnpj_cpf TEXT`,
    `ALTER TABLE notas_fiscais ADD COLUMN chave_acesso TEXT`,
    `ALTER TABLE notas_fiscais ADD COLUMN tipo_nota TEXT DEFAULT 'NF/AP'`,
    `ALTER TABLE notas_fiscais ADD COLUMN origem TEXT DEFAULT 'manual'`,
    `ALTER TABLE notas_fiscais ADD COLUMN validado_empresa INTEGER DEFAULT 0`
];

let contador = 0;
updates.forEach((sql, index) => {
    db.run(sql, (err) => {
        contador++;
        if (err) {
            console.log(`⚠️  [${contador}/${updates.length}] ${sql} - ${err.message}`);
        } else {
            console.log(`✅  [${contador}/${updates.length}] ${sql} - OK`);
        }
        
        if (contador === updates.length) {
            console.log('\n🎉 BANCO DE DADOS ATUALIZADO COM SUCESSO!');
            db.close();
            process.exit();
        }
    });
});
