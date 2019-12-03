
const http = require('http');
const url = require('url');

/**
 * Represents the API.
 * @param platform The NukiPlatform instance.
 */
function NukiApi(platform) {
    const api = this;

    // Sets the platform
    api.platform = platform;

    // Checks if all required information is provided
    if (!api.platform.config.apiPort) {
        api.platform.log('No API port provided.');
        return;
    }
    if (!api.platform.config.apiToken) {
        api.platform.log('No API token provided.');
        return;
    }

    // Starts the server
    try {
        http.createServer(function (request, response) {
            const payload = [];

            // Subscribes for events of the request
            request.on('error', function () {
                api.platform.log('API - Error received.');
            }).on('data', function (chunk) {
                payload.push(chunk);
            }).on('end', function () {

                // Subscribes to errors when sending the response
                response.on('error', function () {
                    api.platform.log('API - Error sending the response.');
                });

                // Validates the token
                if (!request.headers['authorization']) {
                    api.platform.log('Authorization header missing.');
                    response.statusCode = 401;
                    response.end();
                    return;
                }
                if (request.headers['authorization'] !== api.platform.config.apiToken) {
                    api.platform.log('Token invalid.');
                    response.statusCode = 401;
                    response.end();
                    return;
                }

                // Validates the endpoint
                const endpoint = api.getEndpoint(request.url);
                if (!endpoint) {
                    api.platform.log('No endpoint found.');
                    response.statusCode = 404;
                    response.end();
                    return;
                }
            
                // Validates the body
                let body = null;
                if (payload && payload.length > 0) {
                    body = JSON.parse(Buffer.concat(payload).toString());
                }
                
                // Performs the action based on the endpoint and method
                switch (endpoint.name) {
                    case 'device':
                        switch (request.method) {
                            case 'POST':
                                api.handlePostDevice(endpoint, body, response);
                                return;
                        }
                        break;
                }

                api.platform.log('No action matched.');
                response.statusCode = 404;
                response.end();
            });
        }).listen(api.platform.config.apiPort, "0.0.0.0");
        api.platform.log('API started.');
    } catch (e) {
        api.platform.log('API could not be started: ' + JSON.stringify(e));
    }
}

/**
 * Handles requests to POST /devices/{nukiId}.
 * @param endpoint The endpoint information.
 * @param body The body of the request.
 * @param response The response object.
 */
NukiApi.prototype.handlePostDevice = function (endpoint, body, response) {
    const api = this;

    // Checks if the device exists
    const apiDevice = api.platform.apiConfig.find(function(d) { return d.nukiId === endpoint.nukiId; });
    if (!apiDevice) {
        api.platform.log('Device not found.');
        response.statusCode = 400;
        response.end();
        return;
    }

    // Validates the content
    if (!body) {
        api.platform.log('Body invalid.');
        response.statusCode = 400;
        response.end();
        return;
    }

    // Sets the new value
    const promises = [];
    for (let propertyName in body) {
        const devicePropertyValue = body[propertyName];
        switch (propertyName) {
            case 'locked':
                if (devicePropertyValue === true) {
                    promises.push(new Promise(function (resolve, reject) {
                        api.platform.log(apiDevice.nukiId + ' - Lock via API');
                        api.platform.client.send('/lockAction?nukiId=' + apiDevice.nukiId + '&deviceType=0&action=2', function (actionSuccess, actionBody) {
                            if (actionSuccess && actionBody.success) {
                                resolve();
                            } else {
                                reject();
                            }
                        });
                    }));
                }
                break;
        }
    }

    // Writes the response
    Promise.all(promises).then(function() {
        response.statusCode = 200;
        response.end();
    }, function() {
        api.platform.log('Error while setting value.');
        response.statusCode = 400;
        response.end();
    });
}

/**
 * Gets the endpoint information based on the URL.
 * @param uri The uri of the request.
 * @returns Returns the endpoint information.
 */
NukiApi.prototype.getEndpoint = function (uri) {

    // Parses the request path
    const uriParts = url.parse(uri);

    // Checks if the URL matches the devices endpoint
    uriMatch = /\/devices\/(.+)/g.exec(uriParts.pathname);
    if (uriMatch && uriMatch.length === 2) {
        return {
            name: 'device',
            nukiId: parseInt(uriMatch[1])
        };
    }

    // Returns null as no endpoint matched.
    return null;
}

/**
 * Defines the export of the file.
 */
module.exports = NukiApi;
