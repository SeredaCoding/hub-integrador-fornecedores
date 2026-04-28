const { generateCacheKey } = require('../../src/utils/cacheKeyGenerator');

describe('generateCacheKey', () => {
    test('deve gerar chave com global_ids presente', () => {
        const item = { D069_Codigo_Produto: 'PROD123' };
        const result = generateCacheKey('1', ['100'], item);
        expect(result).toBe('f:1:D070_Id:100:PROD123');
    });

    test('deve usar 0 quando global_ids estiver vazio', () => {
        const item = { D069_Codigo_Produto: 'PROD456' };
        const result = generateCacheKey('2', [], item);
        expect(result).toBe('f:2:D070_Id:0:PROD456');
    });

    test('deve usar primeiro valor de Object.values quando D069_Codigo_Produto não existe', () => {
        const item = { SKU: 'SKU789', name: 'Item' };
        const result = generateCacheKey('3', [], item);
        expect(result).toBe('f:3:D070_Id:0:SKU789');
    });

    test('deve extrair D069_Codigo_Produto corretamente', () => {
        const item = { D069_Codigo_Produto: 'PROD_DATA' };
        const result = generateCacheKey('4', ['200'], item);
        expect(result).toBe('f:4:D070_Id:200:PROD_DATA');
    });
});
