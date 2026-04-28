const normalizeProductId = (data, payload) => {
    if (!data.cod_produto_fornecedor || data.cod_produto_fornecedor === 'true' || data.cod_produto_fornecedor === true) {
        const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
        const item = parsedPayload.data?.item || parsedPayload;
        const potentialId = item.D069_Codigo_Produto || 
                          parsedPayload.D069_Codigo || 
                          parsedPayload.cod_produto || 
                          parsedPayload.SKU || 
                          Object.values(parsedPayload).find(v => typeof v !== 'boolean');
        return String(potentialId);
    }
    return String(data.cod_produto_fornecedor);
};

module.exports = { normalizeProductId };
