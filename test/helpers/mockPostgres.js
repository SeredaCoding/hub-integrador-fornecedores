const mockPool = {
    queryResults: [],
    queryCount: 0,
    
    async query(text, params) {
        this.queryCount++;
        if (this.queryResults.length > 0) {
            return this.queryResults.shift();
        }
        return { rows: [], rowCount: 0 };
    },
    
    reset() {
        this.queryResults = [];
        this.queryCount = 0;
    }
};

module.exports = { mockPool };
