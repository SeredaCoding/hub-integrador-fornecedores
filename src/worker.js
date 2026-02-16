require('dotenv').config();
const redis = require('redis');
const axios = require('axios');
const qs = require('qs');
const crypto = require('crypto');

const STREAM = 'erp_updates';
const GROUP = 'erp_group';
const DEAD_LETTER = 'erp_dead_letter';
const MAX_RETRY = 5;

const workerName = `worker-${crypto.randomUUID()}`;

const cache = redis.createClient({
    url: process.env.REDIS_URL
});

cache.on('error', err => {
    console.error("❌ Redis error:", err.message);
});

async function startWorker() {

    await cache.connect();

    // 🔥 Garante que o group existe
    try {
        await cache.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
        console.log('✅ Consumer group pronto');
    } catch (err) {
        if (!err.message.includes('BUSYGROUP')) {
            console.error('Erro ao criar grupo:', err);
        }
    }

    console.log(`🛠 Worker iniciado: ${workerName}`);

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

                    let payload = JSON.parse(data.payload);
                    const retryCount = parseInt(data.retryCount || 0);

                    // Injeção de Data Real (Anti-defasagem)
                    const now = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
                    const stringifiedPayload = JSON.stringify(payload).replace(/RAW:CURRENT_TIMESTAMP|DYNAMIC_TIMESTAMP/g, now);
                    payload = JSON.parse(stringifiedPayload);

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

                            await cache.xAck(STREAM, GROUP, messageId);

                            console.log(`✅ SKU ${data.sku} processado com sucesso`);

                        } else {
                            throw new Error("ERP retornou falha");
                        }

                    } catch (err) {

                        const nextRetry = retryCount + 1;

                        if (nextRetry >= MAX_RETRY) {

                            await cache.xAdd(DEAD_LETTER, '*', {
                                payload: JSON.stringify(payload),
                                error: err.message,
                                sku: data.sku || '',
                                supplier_id: data.supplier_id || ''
                            });

                            await cache.xAck(STREAM, GROUP, messageId);

                            console.log(`💀 SKU ${data.sku} movido para Dead Letter`);

                        } else {

                            await cache.xAdd(STREAM, '*', {
                                supplier_id: data.supplier_id || '',
                                sku: data.sku || '',
                                cacheKey: data.cacheKey || '',
                                novoEstado: data.novoEstado || '',
                                payload: JSON.stringify(payload),
                                retryCount: String(nextRetry)
                            });

                            await cache.xAck(STREAM, GROUP, messageId);

                            console.log(`🔁 Retry ${nextRetry} para SKU ${data.sku}`);
                        }
                    }
                }
            }

        } catch (err) {
            console.error("❌ Erro geral no worker:", err.message);
        }
    }
}

startWorker();
