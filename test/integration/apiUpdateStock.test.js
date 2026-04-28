const request = require('supertest');
const { mockRedisClient } = require('../helpers/mockRedis');
const { mockPool } = require('../helpers/mockPostgres');
const { mockChannel } = require('../helpers/mockRabbitMQ');

// Mock dependencies before importing the app
jest.mock('redis', () => ({
    createClient: jest.fn(() => mockRedisClient)
}));

jest.mock('amqplib', () => ({
    connect: jest.fn(() => ({
        createChannel: jest.fn(() => mockChannel)
    }))
}));

jest.mock('pg', () => ({
    Pool: jest.fn(() => mockPool)
}));

// Import the app after mocks
const app = require('../../src/server');

describe('API POST /v1/update-stock', () => {
    beforeEach(() => {
        mockRedisClient.data = {};
        mockPool.reset();
        mockChannel.reset();
    });

    test('deve retornar 401 sem x-api-key', async () => {
        const response = await request(app)
            .post('/v1/update-stock')
            .send({ payload: { entries: [] } });
        
        expect(response.status).toBe(401);
        expect(response.body.error).toContain('Chave de autenticação');
    });
    
    test('deve retornar 400 com payload vazio', async () => {
        const response = await request(app)
            .post('/v1/update-stock')
            .set('x-api-key', 'valid-key')
            .send({});
        
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('entries/itens');
    });

    test('deve retornar 401 com api-key inválida', async () => {
        mockPool.queryResults = [{ rows: [] }];
        
        const response = await request(app)
            .post('/v1/update-stock')
            .set('x-api-key', 'invalid-key')
            .send({ payload: { entries: [{ PROD1: 'test' }] } });
        
        expect(response.status).toBe(401);
        expect(response.body.error).toContain('Fornecedor não encontrado');
    });
});
