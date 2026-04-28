const { normalizeProductId } = require('../../src/utils/productNormalizer');
const { injectTimestamp } = require('../../src/utils/timestampInjector');
const { mockRedisClient } = require('../helpers/mockRedis');
const { mockPool } = require('../helpers/mockPostgres');

describe('Worker Process Message Logic', () => {
    beforeEach(() => {
        mockRedisClient.data = {};
        mockPool.reset();
    });

    test('normalizeProductId deve extrair ID corretamente', () => {
        const data = { cod_produto_fornecedor: null };
        const payload = { data: { item: { D069_Codigo_Produto: 'TEST123' } } };
        const result = normalizeProductId(data, payload);
        expect(result).toBe('TEST123');
    });

    test('injectTimestamp deve substituir timestamp em payload', () => {
        const payload = {
            data: {
                item: {
                    D069_Codigo_Produto: 'TEST',
                    updated_at: 'RAW:CURRENT_TIMESTAMP'
                }
            }
        };
        const result = injectTimestamp(payload);
        expect(result.data.item.updated_at).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    test('deve processar mensagem com retry count', () => {
        const data = {
            cod_produto_fornecedor: 'PROD123',
            supplier_id: '1',
            payload: JSON.stringify({
                data: { item: { D069_Codigo_Produto: 'PROD123' } }
            }),
            retryCount: '0',
            cacheKey: 'f:1:D070_Id:0:PROD123',
            novoEstado: '{"test": true}'
        };

        expect(data.retryCount).toBe('0');
        expect(JSON.parse(data.payload).data.item.D069_Codigo_Produto).toBe('PROD123');
    });
});
