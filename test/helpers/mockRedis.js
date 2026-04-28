const mockRedisClient = {
    data: {},
    connected: true,
    error: null,
    
    async connect() {
        this.connected = true;
        return Promise.resolve();
    },
    
    async get(key) {
        return this.data[key] || null;
    },
    
    async set(key, value, options) {
        this.data[key] = value;
        return 'OK';
    },
    
    async del(key) {
        delete this.data[key];
        return 1;
    },
    
    async quit() {
        this.connected = false;
        return Promise.resolve();
    },
    
    on(event, callback) {
        if (event === 'error' && this.error) {
            callback(this.error);
        }
    }
};

module.exports = { mockRedisClient };
