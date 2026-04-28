require('dotenv').config();
const redis = require('redis');
const amqp = require('amqplib');
const axios = require('axios');
const qs = require('qs');
const { Pool } = require('pg');
const { normalizeProductId } = require('./utils/productNormalizer');
const { injectTimestamp } = require('./utils/timestampInjector');

const db = new Pool({
    host: process.env.DB_HOST || 'db-tunnel',
    user: process.env.DB_USER || process.env.DB_USERNAME, 
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_DATABASE || process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '5432'),
});

const MAX_RETRY = 5;

// Redis apenas para Cache
const cache = redis.createClient({
    url: process.env.REDIS_URL
});

cache.on('error', err => {
    console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Redis error:`, err.message);
});

cache.connect().then(() => {
    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ✅ Conectado ao Redis (Cache)`);
});

let channel = null;
let connection = null;

async function connectRabbitMQ() {
    try {
        connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672');
        channel = await connection.createChannel();
        
        // Configurar QoS (equivalente ao COUNT: 10 do Redis)
        await channel.prefetch(10);
        
        // Garantir que as filas e exchanges existam
        await channel.assertExchange('erp_updates', 'direct', { durable: true });
        await channel.assertExchange('erp_dlx', 'direct', { durable: true });
        
        await channel.assertQueue('erp_updates', { 
            durable: true,
            deadLetterExchange: 'erp_dlx',
            deadLetterRoutingKey: 'erp_dead_letter'
        });
        await channel.bindQueue('erp_updates', 'erp_updates', '');
        
        await channel.assertQueue('erp_dead_letter', { durable: true });
        await channel.bindQueue('erp_dead_letter', 'erp_dlx', 'erp_dead_letter');
        
        console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 🛠 Worker iniciado - Aguardando mensagens do RabbitMQ...`);
        
        // Consumir mensagens
        await channel.consume('erp_updates', processMessage, { noAck: false });
        
    } catch (err) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Erro no RabbitMQ:`, err.message);
        setTimeout(connectRabbitMQ, 5000);
    }
}

async function processMessage(msg) {
    if (!msg) return;
    
    let data;
    try {
        data = JSON.parse(msg.content.toString());
    } catch (err) {
        console.error(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ❌ Erro ao parsear mensagem:`, err.message);
        channel.ack(msg);
        return;
    }
    
    const retryCount = parseInt(data.retryCount || 0);
    let payload = JSON.parse(data.payload);
    
    // Normalização do identificador do produto
    data.cod_produto_fornecedor = normalizeProductId(data, payload);
    
    // Injeção de Data Real
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
    const stringifiedPayload = JSON.stringify(payload).replace(/RAW:CURRENT_TIMESTAMP|DYNAMIC_TIMESTAMP/g, now);
    payload = JSON.parse(stringifiedPayload);
    
    if (!data.supplier_id && payload.data?.supplier_id) {
        data.supplier_id = payload.data.supplier_id;
    }
    
    try {
        const erpResponse = await axios.post(
            process.env.ERP_WEBHOOK_URL,
            qs.stringify(payload),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
            
            channel.ack(msg);
            console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ✅ Produto ${data.cod_produto_fornecedor} processado com sucesso.`);
        } else {
            const errorMsg = erpResponse.data?.message || "ERP retornou falha";
            await db.query(
                "UPDATE sync_logs SET status = 'error', message = $1, updated_at = NOW() WHERE cod_produto = $2 AND supplier_id = $3 AND status = 'simulation'",
                [errorMsg.substring(0, 255), String(data.cod_produto_fornecedor), parseInt(data.supplier_id || payload.data?.supplier_id)]
            );
            throw new Error(errorMsg);
        }
    } catch (err) {
        const nextRetry = retryCount + 1;
        
        if (nextRetry >= MAX_RETRY) {
            await db.query(
                "UPDATE sync_logs SET status = 'error', message = $1, updated_at = NOW() WHERE cod_produto = $2 AND supplier_id = $3 AND status = 'simulation'",
                ['Falha critica apos retentativas: ' + err.message.substring(0, 100), String(data.cod_produto_fornecedor), parseInt(data.supplier_id || payload.data?.supplier_id)]
            );
            
            // Enviar para Dead Letter via exchange
            channel.sendToQueue('erp_dead_letter', Buffer.from(JSON.stringify({
                payload: JSON.stringify(payload),
                error: err.message,
                cod_produto_fornecedor: data.cod_produto_fornecedor || '',
                supplier_id: data.supplier_id || '',
                erp_response: err.response ? JSON.stringify(err.response.data) : 'N/A'
            })), { persistent: true });
            
            channel.ack(msg);
            console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 💀 Produto ${data.cod_produto_fornecedor} movido para Dead Letter. Motivo: ${err.message}`);
        } else {
            // Re-enfileirar com retry count incrementado
            channel.sendToQueue('erp_updates', Buffer.from(JSON.stringify({
                supplier_id: data.supplier_id || '',
                cod_produto_fornecedor: String(data.cod_produto_fornecedor || ''),
                cacheKey: data.cacheKey || '',
                novoEstado: data.novoEstado || '',
                payload: JSON.stringify(payload),
                retryCount: String(nextRetry)
            })), { persistent: true });
            
            channel.ack(msg);
            console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] 🔁 Retry ${nextRetry} para Produto ${data.cod_produto_fornecedor}`);
        }
    }
}

connectRabbitMQ();

// Tratamento de encerramento gracioso
process.on('SIGINT', async () => {
    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] Encerrando worker...`);
    if (channel) await channel.close();
    if (connection) await connection.close();
    await cache.quit();
    process.exit(0);
});
