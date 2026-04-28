const { getValueByPath } = require('../../src/utils/valueGetter');

describe('getValueByPath', () => {
    test('deve retornar valor para caminho simples', () => {
        const obj = { name: 'Test' };
        expect(getValueByPath(obj, 'name')).toBe('Test');
    });

    test('deve retornar valor para caminho aninhado', () => {
        const obj = { data: { item: { id: 123 } } };
        expect(getValueByPath(obj, 'data.item.id')).toBe(123);
    });

    test('deve retornar undefined para caminho inexistente', () => {
        const obj = { name: 'Test' };
        expect(getValueByPath(obj, 'invalid.path')).toBeUndefined();
    });

    test('deve retornar undefined para caminho parcialmente inexistente', () => {
        const obj = { data: { name: 'Test' } };
        expect(getValueByPath(obj, 'data.invalid.deep')).toBeUndefined();
    });

    test('deve funcionar com arrays', () => {
        const obj = { items: ['a', 'b', 'c'] };
        expect(getValueByPath(obj, 'items.1')).toBe('b');
    });

    test('deve retornar undefined para objeto nulo', () => {
        expect(getValueByPath(null, 'name')).toBeUndefined();
    });
});
