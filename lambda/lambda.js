'use strict';

const AWS = require('aws-sdk');
const http = require("https");
const zlib = require('zlib');

const configurationData = {
    logitApiKey: ""
};

function parseEvent(logGroupName, logStreamName, logEvent) {
    return {
        message: logEvent.message.trim(),
        logGroupName: logGroupName,
        logStreamName: logStreamName,
        timestamp: new Date(logEvent.timestamp).toISOString()
    };
}

function sendToLogit(logitPayload, context, callback) {
    const stringPayload = JSON.stringify(logitPayload);

    try {
        const options = {
            "method": "POST",
            "hostname": "api.logit.io",
            "port": null,
            "path": "/v2",
            "headers": {
                "apikey": configurationData.logitApiKey,
                "content-type": "application/json",
                'content-length': stringPayload.length,
            }
        };

        const request = http.request(options, (response) => {
            var chunks = [];

            response.on('data', function (chunk) {
                chunks.push(chunk);
            });

            response.on('end', function () {
                const body = Buffer.concat(chunks);
                console.log("Response text: " + body.toString());


                if (response.statusCode !== 202) {
                    console.log("Response code invalid:", response.statusCode);
                    callback("Invalid status code");
                }
                else {
                    console.log("Log data sent successfully.");
                    callback(null);
                }
            });
        });

        request.on('error', (error) => {
            console.log('Problem executing the request:', error.toString());
            callback(error);
        });

        request.write(stringPayload);
        request.end();
    }
    catch (exception) {
        console.log(exception.message);
        callback(exception.message);
    }
}

function handleInput(input, context, callback) {
    const payload = new Buffer(input.awslogs.data, 'base64');
    zlib.gunzip(payload, function(error, result) {
        if (error) {
            callback(error);
        }
        else {
            const rawLogEvents = JSON.parse(result.toString('ascii'));
            const logEvents = rawLogEvents.logEvents.map(function(rawLogEvent) {
                return parseEvent(rawLogEvents.logGroup, rawLogEvents.logStream, rawLogEvent);
            });
            const logitPayload = {
                cloudWatchLogEvents: logEvents
            };

            sendToLogit(logitPayload, context, callback);
        }
    });
}

exports.handler = function(input, context, callback) {
    if ((process.env.encryptedLogitApiKey) && (/\S/.test(process.env.encryptedLogitApiKey))) {
        console.log("KMS encrypted API key encountered, decrypting it");

        const kms = new AWS.KMS({ apiVersion: '2014-11-01' });
        const params = {
            CiphertextBlob: new Buffer(process.env.encryptedLogitApiKey, 'base64')
        };
        kms.decrypt(params, function(error, result) {
            if (error) {
                console.log(error);
            }
            else {
                configurationData.logitApiKey = result.Plaintext.toString();
                handleInput(input, context, callback);
            }
        });
    }
    else if ((process.env.logitApiKey) && (/\S/.test(process.env.logitApiKey))) {
        console.log("Unencrypted API key encountered, using it directly");

        configurationData.logitApiKey = process.env.logitApiKey.trim();
        handleInput(input, context, callback);
    }
    else {
        callback("Environment value for logitApiKey or encryptedLogitApiKey must be specified.");
    }
};
