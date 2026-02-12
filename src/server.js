// Carregando Variáveis de ambiente
const fs = require('fs');
if (fs.existsSync('.env')) {
    require('dotenv').config();
} else {
    console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ ERRO: Arquivo .env não encontrado no diretório raiz.`);
}
// Verificação das variáveis de ambiente
const requiredEnv = ['REDIS_URL', 'ERP_WEBHOOK_URL', 'HUB_API_KEY', 'ERP_WEBHOOK_KEY'];
requiredEnv.forEach(envVar => {
    if (!process.env[envVar]) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ⚠️ AVISO: Variável de ambiente ${envVar} não definida.`);
    }
});

const express = require('express');
const redis = require('redis');
const axios = require('axios');
const mysql = require('mysql2/promise'); // Adicione esta linha no topo
const qs = require('qs');

// Pool de conexão com MySQL (Shared com Laravel)
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10
});

const app = express();
const path = require('path');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 1. Conexão Redis com Log
const cache = redis.createClient({ url: process.env.REDIS_URL });
cache.on('error', err => console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Erro no Redis:`, err));
cache.connect().then(() => console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ✅ Conectado ao Redis com sucesso!`));

// const ERP_URL = process.env.ERP_WEBHOOK_URL;

// Função para buscar configurações dinâmicas do Banco de Dados
async function getDynamicConfig(key) {
    try {
        const [rows] = await db.execute(
            'SELECT value FROM configs WHERE name = ? LIMIT 1',
            [key]
        );
        return rows.length > 0 ? rows[0].value : null;
    } catch (error) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Erro ao buscar config ${key}:`, error.message);
        return null;
    }
}

// Função Utilitária para Dot Notation (Suporta Objetos e Arrays)
const getValueByPath = (obj, path) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

app.post('/v1/update-stock', async (req, res) => {
    const fornecedorKey = req.headers['x-api-key'];

    if (!fornecedorKey) {
        return res.status(401).json({ error: 'Chave de autenticação do fornecedor não enviada.' });
    }
    
    // O Laravel envia como ['payload' => $finalPayload], então acessamos req.body.payload
    const envelope = req.body.payload;

    if (!envelope || !envelope.itens) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ⚠️ Payload vazio ou malformado recebido.`);
        return res.status(400).json({ error: 'Conteúdo (itens) não encontrado no payload.' });
    }

    try {
        const [rows] = await db.execute(
            'SELECT id, name FROM suppliers WHERE api_key = ? AND is_active = 1',
            [fornecedorKey]
        );

        if (rows.length === 0) return res.status(401).json({ error: 'Fornecedor não encontrado ou inativo.' });

        const fornecedorDB = rows[0];
        const d070_ids = envelope.D070_Id || [];
        const produtos = envelope.itens;
        const simulate_only = String(req.body.simulate_only) === 'true' || req.body.simulate_only === true;
        
        const ERP_URL = !simulate_only ? (await getDynamicConfig('erp_webhook_url') || process.env.ERP_WEBHOOK_URL) : null;
        const results = [];

        for (const item of produtos) {
            // Identifica a primeira chave do objeto para usar como SKU dinâmico
            const chaves = Object.keys(item);
            const cod_prod_fornecedor = item[chaves[0]];
            
            if (!cod_prod_fornecedor) {
                console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ⚠️ Pulando item: Identificador dinâmico não encontrado.`);
                continue;
            }

            const cacheKey = `f:${fornecedorDB.id}:D070_Id:${d070_ids[0] || '0'}:${Object.entries(item).map(([k, v]) => `${k}:${v}`).join(':')}`;
            const novoEstado = JSON.stringify(item);
            const estadoAnterior = await cache.get(cacheKey);

            if (estadoAnterior === novoEstado) {
                results.push({ cod_prod_fornecedor, status: "skipped" });
                continue;
            }

            // LOG ATUALIZADO (Se aparecer undefined aqui, o container não reiniciou com o código novo)
            console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ✅ PROCESSANDO: ${cod_prod_fornecedor}`);

            if (simulate_only) {
                await db.execute(
                    'INSERT INTO sync_logs (supplier_id, sku, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
                    [fornecedorDB.id, String(cod_prod_fornecedor), 'simulation']
                );
                await cache.set(cacheKey, novoEstado, { EX: 86400 });
                results.push({ cod_prod_fornecedor, status: "simulated" });
            } else if (ERP_URL) {
                try {
                    // Montando o payload combinando os parâmetros fixos com os dados do item
                    const payloadParaERP = {
                        ajax: 'true',
                        acaoId: '676',
                        requisicaoPura: '1',
                        data: {
                            auth_key: process.env.ERP_WEBHOOK_KEY,
                            supplier_id: fornecedorDB.id,
                            D070_Id: d070_ids,
                            item: item
                        }
                    };

                    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📤 ENVIANDO AO ERP (update-stock):`, JSON.stringify(payloadParaERP));

                    const responseERP = await axios.post(ERP_URL, qs.stringify(payloadParaERP), {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });

                    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📥 RETORNO DO ERP:`, JSON.stringify(responseERP.data));

                    const erpData = responseERP.data;

                    // VALIDACAO CRÍTICA: Só atualiza o cache se o ERP confirmou o sucesso
                    if (erpData && erpData.success === true) {
                        await cache.set(cacheKey, novoEstado, { EX: 86400 });
                        
                        await db.execute(
                            'INSERT INTO sync_logs (supplier_id, sku, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
                            [fornecedorDB.id, String(cod_prod_fornecedor), 'success']
                        );
                        
                        results.push({ cod_prod_fornecedor, status: "success" });
                    } else {
                        // Se o ERP respondeu mas deu erro interno (ex: ID não encontrado)
                        const erroMsg = erpData.message || "Erro desconhecido no ERP";
                        console.error(`[${new Date().toLocaleString()}] ⚠️ ERP falhou ao atualizar: ${erroMsg}`);
                        
                        results.push({ cod_prod_fornecedor, status: "failed_in_erp", message: erroMsg });
                    }
                } catch (e) {
                    console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Erro ERP cod_prod_fornecedor ${cod_prod_fornecedor}:`, e.message);
                    results.push({ cod_prod_fornecedor, status: "error", message: e.message });
                }
            }
        }

        res.status(200).json({ 
            status: "batch_completed", 
            processed: results.length,
            details: results 
        });

    } catch (error) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ CRITICAL ERROR:`, error.message);
        res.status(500).json({ error: "Erro interno no processamento do lote." });
    }
});


// Rota /sync atualizada para x-www-form-urlencoded
// app.post('/sync', async (req, res) => {
//     const { supplier_id, identifier, payload } = req.body;

//     if (!payload || !Array.isArray(payload)) {
//         return res.status(400).json({ error: "Payload inválido" });
//     }

//     for (const item of payload) {
//         const dynamicKeys = Object.entries(item).map(([k, v]) => `${k}:${v}`).join(':');
//         const cacheKey = `f:${supplier_id}:${identifier}:${dynamicKeys}`;
//         const lastValue = await cache.get(cacheKey);
//         const currentValue = JSON.stringify(item);

//         if (lastValue !== currentValue) {
//             // SÓ ENTRA AQUI SE HOUVE MUDANÇA
//             try {
//                 // Monta o objeto com os parâmetros obrigatórios + dados do item
//                 const payloadParaERP = {
//                     ajax: 'true',
//                     acaoId: '676',
//                     requisicaoPura: '1',
//                     origin: "HUB_INTEGRADOR",
//                     data: {
//                         supplier_id: supplier_id,
//                         type: identifier,
//                         auth_key: process.env.ERP_WEBHOOK_KEY,
//                         item: item 
//                     }
//                 };

//                 console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📤 ENVIANDO AO ERP (sync):`, JSON.stringify(payloadParaERP));

//                 // Envia para o Webhook do ERP formatado como URL Encoded
//                 const responseERP = await axios.post(process.env.ERP_WEBHOOK_URL, qs.stringify(payloadParaERP), {
//                     headers: {
//                         'Content-Type': 'application/x-www-form-urlencoded'
//                     }
//                 });

//                 console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📥 RETORNO DO ERP:`, JSON.stringify(responseERP.data));
                
//                 // Atualiza o cache após o sucesso
//                 await cache.set(cacheKey, currentValue, { EX: 86400 });

//             } catch (error) {
//                 console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Erro ao sincronizar item no ERP:`, error.message);
//                 // Opcional: Decidir se interrompe o loop ou continua para o próximo item
//             }
//         }
//     }
//     res.sendStatus(200);
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 🚀 HUB ONLINE - Porta: ${PORT}`);
    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📡 Modo: Configuração Dinâmica via Banco de Dados Ativa.\n`);
});