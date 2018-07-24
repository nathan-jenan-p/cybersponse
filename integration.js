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
            callback({ error: err, statusCode: (resp ? resp.statusCode : 'unknown'), body: body }, null);
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

function multiCasedBody(field, key) {
    let body = {
        logic: "OR",
        filters: [
            {
                field: field,
                operator: "eq",
                value: key.toLowerCase()
            },
            {
                field: field,
                operator: "eq",
                value: key.toUpperCase()
            }
        ]
    };

    return body
}

function getResult(options, token, key, callback) {
    let body = multiCasedBody('source', key);

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
        uri: `${options.host}${id}/alerts?&__selectFields=id`,
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

function getIndicators(options, token, key, callback) {
    let body = multiCasedBody('value', key);

    requestWithDefaults({
        method: 'POST',
        uri: `${options.host}/api/query/indicators`,
        headers: {
            Authorization: `Bearer ${token}`
        },
        body: body,
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting indicators`, { err: err, statusCode: resp.statusCode, body: body });
            callback({ error: err, statusCode: resp.statusCode, body: body }, null);
            return;
        }

        let indicators = [];

        async.each(body[HYDRA_MEMBER], (indicator, done) => {
            let sightings = {};

            async.each(['alerts', 'assets', 'incidents', 'emails', 'events'], (type, done) => {
                let id = indicator['@id'];

                requestWithDefaults({
                    method: 'GET',
                    uri: `${options.host}${id}/${type}?&__selectFields=id`,
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    body: body,
                    json: true
                }, (err, resp, body) => {
                    if (err || resp.statusCode !== 200) {
                        Logger.error(`error getting ${type}`, { err: err, statusCode: resp.statusCode, body: body });
                        done({ error: err, statusCode: resp.statusCode, body: body });
                        return;
                    }

                    sightings[type] = body[HYDRA_MEMBER].length;
                    done();
                });
            }, err => {
                if (err) {
                    done(err);
                }

                indicators.push({
                    indicator: indicator,
                    sightings: sightings
                });
                done();
            });
        }, err => {
            callback(err, indicators);
        });

    });
}

function doLookup(entities, options, lookupCallback) {
    Logger.trace('lookup options', { options: options });

    let results = [];

    getToken(options, (err, token) => {
        if (err) {
            lookupCallback(err, null);
            return;
        }

        getAlertActions(token, options, (err, actions) => {
            if (err) {
                lookupCallback(err, null);
                return;
            }

            async.each(entities, (entity, doneEntities) => {
                getIndicators(options, token, entity.value, (err, indicators) => {
                    if (err) {
                        lookupCallback(err);
                        return;
                    }

                    getResult(options, token, entity.value, (err, result) => {
                        if (err) {
                            lookupCallback(err);
                            return;
                        }

                        if (result[HYDRA_MEMBER].length === 0) {
                            results.push({
                                entity: entity,
                                data: null
                            });
                            doneEntities();
                            return;
                        }

                        async.each(result[HYDRA_MEMBER], (result, doneResults) => {
                            getNumberOfAlerts(options, token, result['@id'], (err, numberOfAlerts) => {
                                if (err) {
                                    lookupCallback(err);
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
                                            numberOfAlerts: numberOfAlerts,
                                            indicators: indicators
                                        }
                                    }
                                });
                                doneResults();
                            });
                        }, err => {
                            if (err) {
                                doneEntities(err);
                                Logger.error('circular error?', err);
                            }
                            doneEntities();
                        });
                    });
                });
            }, err => {
                lookupCallback(err, results);
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
