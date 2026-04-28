const { normalizeProductId } = require('../../src/utils/productNormalizer');

describe('normalizeProductId', () => {
    test('deve usar cod_produto_fornecedor quando válido', () => {
        const data = { cod_produto_fornecedor: 'PROD123' };
        const result = normalizeProductId(data, {});
        expect(result).toBe('PROD123');
    });

    test('deve extrair D069_Codigo_Produto do payload.data.item', () => {
        const data = { cod_produto_fornecedor: null };
        const payload = { data: { item: { D069_Codigo_Produto: 'PROD456' } } };
        const result = normalizeProductId(data, payload);
        expect(result).toBe('PROD456');
    });

    test('deve extrair D069_Codigo do payload direto', () => {
        const data = { cod_produto_fornecedor: true };
        const payload = { D069_Codigo: 'PROD789' };
        const result = normalizeProductId(data, payload);
        expect(result).toBe('PROD789');
    });

    test('deve extrair SKU do payload', () => {
        const data = { cod_produto_fornecedor: 'true' };
        const payload = { SKU: 'SKU001' };
        const result = normalizeProductId(data, payload);
        expect(result).toBe('SKU001');
    });

    test('deve usar primeiro valor não-booleano como fallback', () => {
        const data = { cod_produto_fornecedor: null };
        const payload = { active: true, cod_produto: 'FALLBACK123' };
        const result = normalizeProductId(data, payload);
        expect(result).toBe('FALLBACK123');
    });
});
