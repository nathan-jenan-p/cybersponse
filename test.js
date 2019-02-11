let assert = require('chai').assert;
let bunyan = require('bunyan');

let integration = require('./integration');
let config = require('./config/config');
config.request.rejectUnauthorized = false;

describe('CyberSponse integration', () => {
    before(() => {
        integration.startup(bunyan.createLogger({ name: 'test logger', level: bunyan.TRACE }));
    });

    it('should succed when given a correct username/password', done => {
        integration.polarityCache.flushAll();
        integration.tokens = {};
        integration.doLookup([
            {
                isIPv4: true,
                value: '10.10.10.10'
            }], {
                host: 'https://localhost:5555',
                username: 'username',
                password: 'password'
            }, (err, resp) => {
                assert.isNotOk(err);
                assert.equal(1, resp.length);
                done();
            });
    });

    it('should fail when given an incorrect username/password', done => {
        integration.polarityCache.flushAll();
        integration.tokens = {};
        integration.doLookup([
            {
                isIPv4: true,
                value: '10.10.10.10'
            }], {
                host: 'https://localhost:5555',
                username: 'username',
                password: 'password1'
            }, (err, resp) => {
                assert.isOk(err);
                assert.equal(400, err.error.statusCode);
                done();
            });
    });

    it('should look up entities', done => {
        integration.polarityCache.flushAll();
        integration.tokens = {};
        integration.doLookup([
            {
                isIPv4: true,
                value: '10.10.10.10'
            }], {
                host: 'https://localhost:5555',
                username: 'username',
                password: 'password'
            }, (err, resp) => {
                assert.isNotOk(err);
                assert.equal('10.10.10.10', resp[0].entity.value);
                done();
            });
    });
});