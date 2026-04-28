const mockChannel = {
    messages: [],
    acked: [],
    nacked: [],
    
    async assertExchange(name, type, options) {
        return Promise.resolve();
    },
    
    async assertQueue(name, options) {
        return Promise.resolve({ queue: name });
    },
    
    async bindQueue(queue, exchange, routingKey) {
        return Promise.resolve();
    },
    
    async sendToQueue(queue, content, options) {
        this.messages.push({
            queue,
            content: JSON.parse(content.toString()),
            options
        });
        return Promise.resolve();
    },
    
    async consume(queue, callback, options) {
        this.consumeCallback = callback;
        return Promise.resolve();
    },
    
    ack(msg) {
        this.acked.push(msg);
    },
    
    nack(msg) {
        this.nacked.push(msg);
    },
    
    reset() {
        this.messages = [];
        this.acked = [];
        this.nacked = [];
        this.consumeCallback = null;
    }
};

module.exports = { mockChannel };
