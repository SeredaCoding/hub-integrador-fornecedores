const { injectTimestamp } = require('../../src/utils/timestampInjector');

describe('injectTimestamp', () => {
    test('deve substituir RAW:CURRENT_TIMESTAMP', () => {
        const payload = { date: 'RAW:CURRENT_TIMESTAMP', name: 'Test' };
        const result = injectTimestamp(payload);
        expect(result.date).not.toBe('RAW:CURRENT_TIMESTAMP');
        expect(result.date).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
        expect(result.name).toBe('Test');
    });

    test('deve substituir DYNAMIC_TIMESTAMP', () => {
        const payload = { updated_at: 'DYNAMIC_TIMESTAMP' };
        const result = injectTimestamp(payload);
        expect(result.updated_at).not.toBe('DYNAMIC_TIMESTAMP');
        expect(result.updated_at).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    test('deve substituir múltiplas ocorrências', () => {
        const payload = { 
            created_at: 'RAW:CURRENT_TIMESTAMP',
            updated_at: 'DYNAMIC_TIMESTAMP'
        };
        const result = injectTimestamp(payload);
        expect(result.created_at).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
        expect(result.updated_at).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    test('deve manter valores que não são timestamp', () => {
        const payload = { name: 'Product', price: 100 };
        const result = injectTimestamp(payload);
        expect(result.name).toBe('Product');
        expect(result.price).toBe(100);
    });
});
