const generateCacheKey = (supplierId, globalIds, sanitizedItem) => {
    const d070IdSafe = (globalIds && globalIds.length > 0) ? globalIds[0] : '0';
    const codProduto = sanitizedItem.D069_Codigo_Produto || Object.values(sanitizedItem)[0];
    return `f:${supplierId}:D070_Id:${d070IdSafe}:${codProduto}`;
};

module.exports = { generateCacheKey };
