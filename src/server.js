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
const { Pool } = require('pg'); 
const qs = require('qs');

// Pool de conexão com PostgreSQL (Extraindo do envelope injetado pelo Docker)
const db = new Pool({
    host: process.env.DB_HOST || 'db-tunnel',
    user: process.env.DB_USER || process.env.DB_USERNAME, 
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_DATABASE || process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '5432'),
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
        // Busca na tabela app_configs criada anteriormente via Laravel
        const res = await db.query(
            'SELECT value FROM app_configs WHERE key = $1 LIMIT 1',
            [key]
        );
        return res.rows.length > 0 ? res.rows[0].value : null;
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

    if (!envelope || (!envelope.entries && !envelope.itens)) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ⚠️ Payload vazio ou malformado recebido.`);
        return res.status(400).json({ error: 'Conteúdo (entries/itens) não encontrado no payload.' });
    }

    try {
        const res = await db.query(
            'SELECT id, name FROM suppliers WHERE api_key = $1 AND is_active = 1',
            [fornecedorKey]
        );

        if (res.rows.length === 0) return res.status(401).json({ error: 'Fornecedor não encontrado ou inativo.' });

        const fornecedorDB = res.rows[0];
        const global_ids = envelope.global_ids || envelope.D070_Id || [];
        const produtos = envelope.entries || envelope.itens;
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
                await db.query(
                    'INSERT INTO sync_logs (supplier_id, sku, status, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
                    [fornecedorDB.id, String(cod_prod_fornecedor), 'simulation']
                );
                await cache.set(cacheKey, novoEstado, { EX: 86400 });
                results.push({ cod_prod_fornecedor, status: "simulated" });
           } else if (ERP_URL) {

                const payloadParaERP = {
                    ajax: 'true',
                    acaoId: '676',
                    requisicaoPura: '1',
                    data: {
                        auth_key: process.env.ERP_WEBHOOK_KEY,
                        supplier_id: fornecedorDB.id,
                        global_ids: global_ids,
                        // Se o item já vier estruturado (novo formato), usa direto, senão mantém compatibilidade
                        ...(item.data ? item : { item: item })
                    }
                };

                console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📬 ENFILEIRANDO PARA ERP: ${cod_prod_fornecedor}`);

                await cache.xAdd('erp_updates', '*', {
                    supplier_id: String(fornecedorDB.id),
                    sku: String(cod_prod_fornecedor),
                    cacheKey: cacheKey,
                    novoEstado: novoEstado,
                    payload: JSON.stringify(payloadParaERP)
                });

                results.push({ cod_prod_fornecedor, status: "queued" });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 🚀 HUB ONLINE - Porta: ${PORT}`);
    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 📡 Modo: Configuração Dinâmica via Banco de Dados Ativa.\n`);
});