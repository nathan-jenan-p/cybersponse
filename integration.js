let async = require('async');
let config = require('./config/config');
let request = require('request');
let NodeCache = require('node-cache');

let polarityCache = new NodeCache({
    stdTTL: 60 * 60 // cache items live 1 hour
});

let Logger;
let requestOptions = {};
let requestWithDefaults;
let defaults;

const HYDRA_MEMBER = 'hydra:member';

function getToken(options, callback) {
    defaults({
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

function getAlertActions(options, callback) {
    let actions = polarityCache.get('actions');

    if (actions) {
        Logger.trace('actions found in cache');
        callback(null, actions);
        return;
    }

    Logger.trace('actions NOT found in cache');

    requestWithDefaults(options, {
        uri: `${options.host}/api/workflows/actions`,
        qs: {
            '$relationships': true,
            'isActive': true,
            'type': 'alerts'
        },
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting alert actions ${err || resp.statusCode} ${JSON.stringify(body)}`);
            callback({ error: err, statusCode: resp ? resp.statusCode : "", body: body }, null);
            return;
        }

        actions = body[HYDRA_MEMBER].map(action => {
            let triggerStepId = action.triggerStep;
            let triggerStep = action.steps
                .filter(step => step['@id'] === triggerStepId)
                .pop(); // should be only 1 match

            return {
                invoke: `${options.host}/api/triggers/1/action/${triggerStep.arguments.route}`,
                name: action.name
            };
        });

        polarityCache.set('actions', actions);

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

function getResult(options, key, callback) {
    let body = multiCasedBody('source', key);

    Logger.trace('request body', body);

    requestWithDefaults(options, {
        method: 'POST',
        uri: `${options.host}/api/query/incidents`,
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

function getNumberOfAlerts(options, id, callback) {
    let alerts = polarityCache.get('number-of-alerts-' + id);
    if (alerts) {
        Logger.trace('alerts found in cache');
        callback(null, alerts);
        return;
    }

    Logger.trace('alerts NOT found in cache');

    requestWithDefaults(options, {
        method: 'GET',
        uri: `${options.host}${id}/alerts?&__selectFields=id`,
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting number of alerts`, { err: err, statusCode: resp.statusCode, body: body });
            callback({ error: err, statusCode: resp.statusCode, body: body }, null);
            return;
        }

        polarityCache.set('number-of-alerts-' + id, body[HYDRA_MEMBER].length);

        callback(null, body[HYDRA_MEMBER].length);
    });
}

function getIndicators(options, key, callback) {
    let indicators = polarityCache.get('indicators-' + key);
    if (indicators) {
        Logger.trace('indicators found in cache');
        callback(null, indicators);
        return;
    }

    Logger.trace('indicators NOT found in cache');

    let body = multiCasedBody('value', key);

    requestWithDefaults(options, {
        method: 'POST',
        uri: `${options.host}/api/query/indicators`,
        body: body,
        json: true
    }, (err, resp, body) => {
        if (err || resp.statusCode !== 200) {
            Logger.error(`error getting indicators`, { err: err, statusCode: resp ? resp.statusCode : 'unknown', body: body });
            callback({ error: err, statusCode: resp.statusCode, body: body }, null);
            return;
        }

        let indicators = [];

        async.each(body[HYDRA_MEMBER], (indicator, done) => {
            let sightings = {};

            async.each(['alerts', 'assets', 'incidents', 'emails', 'events'], (type, done) => {
                let id = indicator['@id'];

                requestWithDefaults(options, {
                    method: 'GET',
                    uri: `${options.host}${id}/${type}?&__selectFields=id`,
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
            polarityCache.set('indicators-' + key, indicators);

            callback(err, indicators);
        });

    });
}

function doLookup(entities, options, lookupCallback2) {
    let lookupCallback = (err, data) => {
        Logger.trace('final callback called with', { err: err, data: data });
        lookupCallback2(err, data);
    }
    Logger.trace('lookup options', { options: options });

    let results = [];

    Logger.trace('1');

    getAlertActions(options, (err, actions) => {
        Logger.trace('1.1');
        if (err) {
            lookupCallback(err, null);
            return;
        }

        Logger.trace('2');

        async.each(entities, (entity, doneEntities) => {
            getIndicators(options, entity.value, (err, indicators) => {
                if (err) {
                    lookupCallback(err);
                    return;
                }

                Logger.trace('3');

                getResult(options, entity.value, (err, result) => {
                    if (err) {
                        lookupCallback(err);
                        return;
                    }

                    Logger.trace('4');

                    if (result[HYDRA_MEMBER].length === 0) {
                        results.push({
                            entity: entity,
                            data: null
                        });
                        doneEntities();
                        return;
                    }

                    Logger.trace('5');

                    async.each(result[HYDRA_MEMBER], (result, doneResults) => {
                        getNumberOfAlerts(options, result['@id'], (err, numberOfAlerts) => {
                            if (err) {
                                lookupCallback(err);
                                return;
                            }

                            Logger.trace('6');

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
            Logger.trace('sending results', { results: results });
            lookupCallback(err, results);
        });
    });

}

function onMessage(payload, options, callback) {
    requestWithDefaults(options, {
        method: 'POST',
        uri: payload.action.invoke,
        body: {
            records: [payload.alert],
        },
        json: true,
    }, (err, resp) => {
        if (err || resp.statusCode !== 200) {
            callback({ error: err, statusCode: resp.statusCode });
            return;
        }

        callback(null, {});
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

    let tokens = {};

    defaults = request.defaults(requestOptions);
    requestWithDefaults = (options, requestOptions, callback) => {
        if (!requestOptions.headers) {
            requestOptions.headers = {};
        }

        requestOptions.headers.Authorization = tokens[options.username + options.password];
        defaults(requestOptions, (err, resp, body) => {
            if (err) {
                callback(err, null);
                return;
            }

            if (resp.statusCode == 401) {
                getToken(options, (err, token) => {
                    if (err) {
                        callback(err);
                        return;
                    }

                    tokens[options.username + options.password] = token
                    requestOptions.headers.Authorization = 'Bearer ' + token;
                    defaults(requestOptions, callback);
                });
                return;
            }

            callback(null, resp, body);
        });
    }
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
