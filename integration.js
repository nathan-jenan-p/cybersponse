let async = require('async');
let config = require('./config/config');
let request = require('request');

let Logger;
let requestOptions = {};
let requestWithDefaults;

const HYDRA_MEMBER = 'hydra:member';

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
            callback({ error: err, statusCode: resp.statusCode, body: body }, null);
            return;
        }

        callback(null, body.token);
    });
}

function getAlertActions(token, options, callback) {
    requestWithDefaults({
        uri: `${options.host}/api/workflows/actions`,
        qs: {
            '$relationships': true,
            'isActive': true,
            'type': 'alerts'
        },
        headers: {
            Authorization: `Bearer ${token}`
        },
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting alert actions ${err || resp.statusCode} ${body}`);
            callback({ error: err, statusCode: resp.statusCode, body: body }, null);
            return;
        }

        let actions = body[HYDRA_MEMBER].map(action => {
            let triggerStepId = action.triggerStep;
            let triggerStep = action.steps
                .filter(step => step['@id'] === triggerStepId)
                .pop(); // should be only 1 match

            return {
                invoke: `${options.host}/api/triggers/1/action/${triggerStep.arguments.route}`,
                name: action.name
            };
        });

        callback(null, actions);
    });
}

function getResult(options, token, key, callback) {
    let body = {
        logic: "OR",
        filters: [
            {
                field: "source",
                operator: "eq",
                value: key.toLowerCase()
            },
            {
                field: "source",
                operator: "eq",
                value: key.toUpperCase()
            }
        ]
    };

    Logger.trace('request body', body);

    requestWithDefaults({
        method: 'POST',
        uri: `${options.host}/api/query/incidents`,
        headers: {
            Authorization: `Bearer ${token}`
        },
        body: body,
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting entities`, { err: err, statusCode: resp.statusCode, body: body });
            callback({ error: err, statusCode: resp.statusCode, body: body }, null);
            return;
        }

        Logger.trace('lookup', { result: body, value: key });

        callback(null, body);
    });
}

function getNumberOfAlerts(options, token, id, callback) {
    requestWithDefaults({
        method: 'GET',
        uri: `${options.host}${id}/alerts`,
        headers: {
            Authorization: `Bearer ${token}`
        },
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting number of alerts`, { err: err, statusCode: resp.statusCode, body: body });
            callback({ error: err, statusCode: resp.statusCode, body: body }, null);
            return;
        }

        callback(null, body[HYDRA_MEMBER].length);
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

        getAlertActions(token, options, (err, actions) => {
            if (err) {
                callback(err, null);
                return;
            }

            async.each(entities, (entity, done) => {
                getResult(options, token, entity.value, (err, result) => {
                    if (err) {
                        done(err);
                        return;
                    }

                    if (result[HYDRA_MEMBER].length === 0) {
                        results.push({
                            entity: entity,
                            data: null
                        });
                        done();
                        return;
                    }

                    async.forEach(result[HYDRA_MEMBER], (result, done) => {
                        getNumberOfAlerts(options, token, result['@id'], (err, numberOfAlerts) => {
                            if (err) {
                                done(err);
                                return;
                            }

                            results.push({
                                entity: entity,
                                data: {
                                    summary: [
                                        result.severity.itemValue,
                                        result.status.itemValue,
                                        result.phase.itemValue,
                                        result.category.itemValue,
                                        `Alerts: ${numberOfAlerts}`
                                    ],
                                    details: {
                                        actions: actions,
                                        result: result,
                                        host: options.host,
                                        numberOfAlerts: numberOfAlerts
                                    }
                                }
                            });
                            done();
                        });
                    }, err => {
                        done(err);
                    });
                });
            }, err => {
                callback(err, results);
            });
        });
    });
}

function onMessage(payload, options, callback) {
    getToken(options, (err, token) => {
        if (err) {
            callback({ error: err });
            return;
        }

        requestWithDefaults({
            method: 'POST',
            uri: payload.action.invoke,
            body: {
                records: [payload.alert],
            },
            headers: {
                Authorization: `Bearer ${token}`
            },
            json: true,
        }, (err, resp) => {
            if (err || resp.statusCode !== 200) {
                callback({ error: err, statusCode: resp.statusCode });
                return;
            }

            callback(null, {});
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

    validateStringOption(errors, options, 'host', 'You must provide a host.');
    validateStringOption(errors, options, 'username', 'You must provide a username.');
    validateStringOption(errors, options, 'password', 'You must provide a password.');

    callback(null, errors);
}

module.exports = {
    doLookup: doLookup,
    onMessage: onMessage,
    startup: startup,
    validateOptions: validateOptions
};
