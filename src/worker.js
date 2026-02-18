require('dotenv').config();
const redis = require('redis');
const axios = require('axios');
const qs = require('qs');
const crypto = require('crypto');
const { Pool } = require('pg');

const db = new Pool({
    host: process.env.DB_HOST || 'db-tunnel',
    user: process.env.DB_USER || process.env.DB_USERNAME, 
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_DATABASE || process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '5432'),
});

const STREAM = 'erp_updates';
const GROUP = 'erp_group';
const DEAD_LETTER = 'erp_dead_letter';
const MAX_RETRY = 5;

const workerName = `worker-${crypto.randomUUID()}`;

const cache = redis.createClient({
    url: process.env.REDIS_URL
});

cache.on('error', err => {
    console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Redis error:`, err.message);
});

async function startWorker() {

    await cache.connect();

    // 🔥 Garante que o group existe
    try {
        await cache.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
        console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ✅ Consumer group pronto`);
    } catch (err) {
        if (!err.message.includes('BUSYGROUP')) {
            console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] Erro ao criar grupo:`, err);
        }
    }

    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 🛠 Worker iniciado: ${workerName}`);

    while (true) {
        try {
            const response = await cache.xReadGroup(
                GROUP,
                workerName,
                [{ key: STREAM, id: '>' }],
                { COUNT: 10, BLOCK: 5000 }
            );

            if (!response) continue;

            for (const stream of response) {
                for (const message of stream.messages) {

                    const messageId = message.id;
                    const data = message.message;
                    
                    // Prioriza cod_produto do payload se o do nível superior for undefined
                    let payload = JSON.parse(data.payload);
                    //console.log('Payload:', payload);
                    
                    // Normalização exaustiva do identificador do produto (Ignora booleanos 'true/false')
                    if (!data.cod_produto_fornecedor || data.cod_produto_fornecedor === 'true' || data.cod_produto_fornecedor === true) {
                        const potentialId = payload.data?.item?.D069_Codigo_Produto || payload.D069_Codigo || payload.cod_produto || payload.SKU || Object.values(payload).find(v => typeof v !== 'boolean');
                        data.cod_produto_fornecedor = String(potentialId);
                    }
                    const retryCount = parseInt(data.retryCount || 0);

                    // Injeção de Data Real (Anti-defasagem)
                    const now = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
                    const stringifiedPayload = JSON.stringify(payload).replace(/RAW:CURRENT_TIMESTAMP|DYNAMIC_TIMESTAMP/g, now);
                    payload = JSON.parse(stringifiedPayload);

                    // Garantir extração de metadados do nível interno se o nível superior for vazio
                    if (!data.supplier_id && payload.data?.supplier_id) {
                        data.supplier_id = payload.data.supplier_id;
                    }

                    try {

                        const erpResponse = await axios.post(
                            process.env.ERP_WEBHOOK_URL,
                            qs.stringify(payload),
                            {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                },
                                timeout: 10000
                            }
                        );

                        if (erpResponse.data?.success === true) {
                            if (data.cacheKey && data.novoEstado) {
                                await cache.set(data.cacheKey, data.novoEstado, { EX: 86400 });
                            }

                            await db.query(
                                "UPDATE sync_logs SET status = 'success', message = 'ERP atualizado com sucesso', updated_at = NOW() WHERE cod_produto = $1 AND supplier_id = $2 AND status = 'simulation'",
                                [String(data.cod_produto_fornecedor), parseInt(data.supplier_id || payload.data?.supplier_id)]
                            );

                            await cache.xAck(STREAM, GROUP, messageId);
                            console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ✅ Produto ${data.cod_produto_fornecedor} processado com sucesso. Retorno ERP:`, JSON.stringify(erpResponse.data));
                        } else {
                            const errorMsg = erpResponse.data?.message || "ERP retornou falha";
                            await db.query(
                                "UPDATE sync_logs SET status = 'error', message = $1, updated_at = NOW() WHERE cod_produto = $2 AND supplier_id = $3 AND status = 'simulation'",
                                [errorMsg.substring(0, 255), String(data.cod_produto_fornecedor), parseInt(data.supplier_id || payload.data?.supplier_id)]
                            );
                            console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ⚠️ Falha no ERP para Produto ${data.cod_produto_fornecedor}. Retorno ERP:`, JSON.stringify(erpResponse.data));
                            throw new Error(errorMsg);
                        }
                    } catch (err) {
                        const nextRetry = retryCount + 1;
                        if (nextRetry >= MAX_RETRY) {
                            await db.query(
                                "UPDATE sync_logs SET status = 'error', message = $1, updated_at = NOW() WHERE cod_produto = $2 AND supplier_id = $3 AND status = 'simulation'",
                                ['Falha critica apos retentativas: ' + err.message.substring(0, 100), String(data.cod_produto_fornecedor), parseInt(data.supplier_id || payload.data?.supplier_id)]
                            );

                            await cache.xAdd(DEAD_LETTER, '*', {
                                payload: JSON.stringify(payload),
                                error: err.message,
                                cod_produto_fornecedor: data.cod_produto_fornecedor || '',
                                supplier_id: data.supplier_id || '',
                                erp_response: err.response ? JSON.stringify(err.response.data) : 'N/A'
                            });

                            await cache.xAck(STREAM, GROUP, messageId);
                            console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 💀 Produto ${data.cod_produto_fornecedor} movido para Dead Letter. Motivo: ${err.message}`);
                        } else {
                            await cache.xAdd(STREAM, '*', {
                                supplier_id: data.supplier_id || '',
                                cod_produto_fornecedor: String(data.cod_produto_fornecedor || ''),
                                cacheKey: data.cacheKey || '',
                                novoEstado: data.novoEstado || '',
                                payload: JSON.stringify(payload),
                                retryCount: String(nextRetry)
                            });

                            await cache.xAck(STREAM, GROUP, messageId);
                            console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 🔁 Retry ${nextRetry} para Produto ${data.cod_produto_fornecedor}`);
                        }
                    }
                }
            }

        } catch (err) {
            console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Erro geral no worker:`, err.message);
        }
    }
}

startWorker();
