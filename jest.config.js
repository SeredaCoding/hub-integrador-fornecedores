module.exports = {
    testEnvironment: 'node',
    coverageProvider: 'v8',
    collectCoverageFrom: ['src/**/*.js'],
    testMatch: ['**/test/**/*.test.js'],
    modulePaths: ['<rootDir>/src']
};
