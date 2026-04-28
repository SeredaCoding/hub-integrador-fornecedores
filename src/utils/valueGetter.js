const getValueByPath = (obj, path) => {
    if (obj == null) return undefined;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

module.exports = { getValueByPath };
