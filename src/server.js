require('dotenv').config();
const express = require('express');
const redis = require('redis');
const axios = require('axios');

const app = express();
app.use(express.json());

// 1. Conexão Redis com Log
const cache = redis.createClient({ url: 'redis://localhost:6379' });
cache.on('error', err => console.error('❌ Erro no Redis:', err));
cache.connect().then(() => console.log('✅ Conectado ao Redis com sucesso!'));

const ERP_URL = process.env.ERP_WEBHOOK_URL || "https://webhook.site/7069352e-c151-402a-9975-f5b2b2b11545";

app.post('/v1/update-stock', async (req, res) => {
    // 🛡️ Validação de Segurança
    const fornecedorKey = req.headers['x-api-key'];
    if (fornecedorKey !== process.env.HUB_API_KEY) {
        console.log('🚫 Tentativa de acesso não autorizado!');
        return res.status(401).json({ error: 'Não autorizado. API Key inválida.' });
    }

    // 🚩 Adicionamos 'fornecedor' aqui para diferenciar as chaves no Redis
    const { sku, preco, estoque, fornecedor } = req.body;

    // Se o fornecedor não enviar o nome dele, usamos 'geral' para não quebrar
    const fId = fornecedor || 'geral'; 

    try {
        // ✨ A CHAVE AGORA É ÚNICA POR FORNECEDOR + SKU
        const cacheKey = `f:${fId}:sku:${sku}`;
        const novoEstado = JSON.stringify({ preco, estoque });

        console.log(`🔍 Verificando mudanças para [${fId}] SKU: ${sku}...`);
        const estadoAnterior = await cache.get(cacheKey);

        if (estadoAnterior === novoEstado) {
            console.log(`[IDLE] SKU ${sku} do fornecedor ${fId} sem mudanças.`);
            return res.status(200).json({ status: "skipped", message: "Sem alterações." });
        }

        console.log(`🚀 Mudança detectada para ${fId}! Enviando para o ERP...`);
        
        // Enviamos o fornecedor também para o ERP saber quem atualizou
        await axios.post(ERP_URL, { sku, preco, estoque, fornecedor: fId });

        await cache.set(cacheKey, novoEstado, { EX: 86400 });
        console.log(`✅ Cache atualizado: ${cacheKey}`);
        
        res.status(200).json({ status: "success" });

    } catch (error) {
        console.error("❌ ERRO NO PROCESSAMENTO:", error.message);
        res.status(500).json({ error: "Falha interna no Hub.", detalhes: error.message });
    }
});

app.listen(3000, () => {
    console.log(`\n🚀 HUB ONLINE EM http://localhost:3000`);
    console.log(`📡 URL DO ERP CONFIGURADA: ${ERP_URL}\n`);
});