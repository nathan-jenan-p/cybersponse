let async = require('async');
let config = require('./config/config');
let request = require('request');

let Logger;
let requestOptions = {};
let requestWithDefaults;

function getToken(options, callback) {
    requestWithDefaults({
        method: 'POST',
        uri: `${options.host}/auth/authenticate`,
        body: {
            credentials: {
                loginid: options.username,
                password: options.password
            }
        },
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting token ${err || resp.statusCode} ${body}`);
            callback(err || { statusCode: resp.statusCode, body: body }, null);
            return;
        }

        callback(null, body.token);
    });
}

function getResult(options, token, key, callback) {
    requestWithDefaults({
        method: 'POST',
        uri: `${options.host}/api/query/alerts`,
        headers: {
            Authorization: `Bearer ${token}`
        },
        body: {
            logic: "AND",
            filters: [
                {
                    field: "source",
                    operator: "eq",
                    value: "10.10.10.10"
                }
            ]
        },
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting entities ${err || resp.statusCode} ${body}`);
            callback(err || { statusCode: resp.statusCode, body: body }, null);
            return;
        }

        callback(null, body);
    });
}

function doLookup(entities, options, callback) {
    Logger.trace('lookup options', { options: options });

    let results = [];

    getToken(options, (err, token) => {
        if (err) {
            callback(err, null);
            return;
        }

        getResult(options, token, entities[0].value, (err, result) => {
            if (err) {
                callback(err, null);
                return;
            }

            results = results.concat(result['hydra:member']);

            callback(err, results);
        });
    });
}

function startup(logger) {
    Logger = logger;

    if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
        requestOptions.cert = fs.readFileSync(config.request.cert);
    }

    if (typeof config.request.key === 'string' && config.request.key.length > 0) {
        requestOptions.key = fs.readFileSync(config.request.key);
    }

    if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
        requestOptions.passphrase = config.request.passphrase;
    }

    if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
        requestOptions.ca = fs.readFileSync(config.request.ca);
    }

    if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
        requestOptions.proxy = config.request.proxy;
    }

    if (typeof config.request.rejectUnauthorized === 'boolean') {
        requestOptions.rejectUnauthorized = config.request.rejectUnauthorized;
    }

    requestWithDefaults = request.defaults(requestOptions);
}

function validateStringOption(errors, options, optionName, errMessage) {
    if (typeof options[optionName].value !== 'string' ||
        (typeof options[optionName].value === 'string' && options[optionName].value.length === 0)) {
        errors.push({
            key: optionName,
            message: errMessage
        });
    }
}

function validateOptions(options, callback) {
    let errors = [];

    validateOption(errors, options, 'host', 'You must provide a host.');
    validateOption(errors, options, 'username', 'You must provide a username.');
    validateOption(errors, options, 'password', 'You must provide a password.');

    callback(null, errors);
}

module.exports = {
    doLookup: doLookup,
    startup: startup,
    validateOptions: validateOptions
};
