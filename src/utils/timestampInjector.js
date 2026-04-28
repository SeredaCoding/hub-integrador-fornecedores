const injectTimestamp = (payload, timeZone = 'America/Sao_Paulo') => {
    const now = new Date().toLocaleString('sv-SE', { timeZone }).replace('T', ' ');
    const stringified = JSON.stringify(payload).replace(/RAW:CURRENT_TIMESTAMP|DYNAMIC_TIMESTAMP/g, now);
    return JSON.parse(stringified);
};

module.exports = { injectTimestamp };
