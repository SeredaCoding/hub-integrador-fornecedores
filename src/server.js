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
app.use(express.json());

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
    
    try {
        const [rows] = await db.execute(
            'SELECT id, name, field_mapping FROM suppliers WHERE api_key = ? AND is_active = 1',
            [fornecedorKey]
        );

        if (rows.length === 0) return res.status(401).json({ error: 'Não autorizado.' });

        const fornecedorDB = rows[0];
        const activeMapping = fornecedorDB.field_mapping[0]; 
        const mappings = activeMapping.mapping;
        const listRoot = activeMapping.list_root;
        const simulate_only = String(req.body.simulate_only) === 'true' || req.body.simulate_only === true;

        let produtos = listRoot ? getValueByPath(req.body, listRoot) : [req.body];
        if (!Array.isArray(produtos)) produtos = [produtos];

        const results = [];
        const ERP_URL = !simulate_only ? (await getDynamicConfig('erp_webhook_url') || process.env.ERP_WEBHOOK_URL) : null;

        for (const itemRaw of produtos) {
            let sku = getValueByPath(itemRaw, mappings.find(m => m.to === 'sku')?.from);
            let preco = getValueByPath(itemRaw, mappings.find(m => m.to === 'preco')?.from);
            let estoque = getValueByPath(itemRaw, mappings.find(m => m.to === 'estoque')?.from);

            if (!sku) continue;

            const cacheKey = `f:${fornecedorDB.id}:sku:${sku}`;
            const novoEstado = JSON.stringify({ preco, estoque });
            const estadoAnterior = await cache.get(cacheKey);

            if (estadoAnterior === novoEstado) {
                results.push({ sku, status: "skipped" });
                continue;
            }

            if (simulate_only) {
                await db.execute('INSERT INTO sync_logs (supplier_id, sku, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [fornecedorDB.id, sku, 'simulation']);
                await cache.set(cacheKey, novoEstado, { EX: 86400 });
                results.push({ sku, status: "simulated" });
            } else if (ERP_URL) {
                try {
                    await axios.post(ERP_URL, { sku, preco, estoque, fornecedor: fornecedorDB.id });
                    await db.execute('INSERT INTO sync_logs (supplier_id, sku, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [fornecedorDB.id, sku, 'success']);
                    await cache.set(cacheKey, novoEstado, { EX: 86400 });
                    results.push({ sku, status: "success" });
                } catch (e) {
                    results.push({ sku, status: "error", message: e.message });
                }
            }
        }

        res.status(200).json({ 
            status: "batch_completed", 
            processed: results.length,
            details: results 
        });

    } catch (error) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ ERRO:`, error.message);
        res.status(500).json({ error: "Falha na sincronização." });
    }
});

// Exemplo no Node.js (Express)
app.post('/sync', async (req, res) => {
    const { supplier_id, identifier, payload } = req.body;

    for (const item of payload) {
        const cacheKey = `hub:cache:${supplier_id}:${identifier}:${item.sku}`;
        const lastValue = await redis.get(cacheKey);
        const currentValue = JSON.stringify(item);

        if (lastValue !== currentValue) {
            // SÓ ENTRA AQUI SE HOUVE MUDANÇA
            await redis.set(cacheKey, currentValue);
            
            // Envia para o Webhook do ERP
            await axios.post(process.env.ERP_WEBHOOK_URL, {
                origin: "HUB_INTEGRADOR",
                supplier_id,
                type: identifier,
                data: item
            });
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 🚀 HUB ONLINE - Porta: ${PORT}`);
    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📡 Modo: Configuração Dinâmica via Banco de Dados Ativa.\n`);
});