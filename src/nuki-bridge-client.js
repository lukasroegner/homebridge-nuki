
const request = require('request');

/**
 * Represents the client for communicating with the Nuki Bridge.
 * @param platform The NukiPlatform instance.
 */
function NukiBridgeClient(platform) {
    const client = this;

    // Sets the platform for further use
    client.platform = platform;

    // Initializes the queue, which is used to perform sequential calls to the Bridge API
    client.queue = [];
    client.lastRequestTimestamp = null;
    client.isExecutingRequest = false;
}

/**
 * Sends a request to the Nuki Bridge.
 * @param uriPath The endpoint of the Bridge that is to be called.
 * @param callback The callback that contains a result. The result contains a success indicator and the body.
 */
NukiBridgeClient.prototype.send = function (uriPath, callback) {
    const client = this;

    // Adds the request to the queue
    client.queue.push({ uriPath: uriPath, callback: callback, retryCount: 0 });

    // Starts processing the queue
    client.process();
}

/**
 * Check if the queue contains elements that can be sent to the Bridge API.
 */
NukiBridgeClient.prototype.process = function () {
    const client = this;

    // Checks if the bridge client is currently executing a request
    if (client.isExecutingRequest) {
        return;
    }

    // Checks if the queue has items to process
    if (client.queue.length === 0) {
        return;
    }

    // Checks if the last request has been executed within the request buffer
    if (client.lastRequestTimestamp && new Date().getTime() - client.lastRequestTimestamp < client.platform.config.requestBuffer) {
        setTimeout(function () {
            client.process();
        }, Math.max(100, client.platform.config.requestBuffer - (new Date().getTime() - client.lastRequestTimestamp)));
        return;
    }

    // Starts executing the request
    client.isExecutingRequest = true;

    // Checks if all required information is provided
    if (!client.platform.config.bridgeIpAddress) {
        client.platform.log('No bridge IP address provided.');
        return;
    }
    if (!client.platform.config.bridgeApiToken) {
        client.platform.log('No API token for the bridge provided.');
        return;
    }

    // Sends out the request
    const item = client.queue[0];
    try {
        request({
            uri: 'http://' + client.platform.config.bridgeIpAddress + ':' + client.platform.config.bridgeApiPort + item.uriPath + (item.uriPath.indexOf('?') == -1 ? '?' : '&') + 'token=' + client.platform.config.bridgeApiToken,
            method: 'GET',
            json: true,
            rejectUnauthorized: false
        }, function (error, response, body) {

            // Checks if the API returned a positive result
            if (error || response.statusCode != 200 || !body) {
                if (error) {
                    client.platform.log('Error while communicating with the Nuki Bridge. Error: ' + error);
                } else if (response.statusCode != 200) {
                    client.platform.log('Error while communicating with the Nuki Bridge. Status Code: ' + response.statusCode);
                } else if (!body) {
                    client.platform.log('Error while communicating with the Nuki Bridge. Could not get body from response: ' + JSON.stringify(body));
                }

                // Checks the retry count
                item.retryCount = item.retryCount + 1;
                if (item.retryCount >= client.platform.config.requestRetryCount) {
                    client.queue.shift();
                    item.callback(false);
                }

                // Stops executing the request
                client.lastRequestTimestamp = new Date().getTime();
                client.isExecutingRequest = false;
                client.process();
                return;
            }

            // Executes the callback
            client.queue.shift();
            item.callback(true, body);

            // Stops executing the request
            client.lastRequestTimestamp = new Date().getTime();
            client.isExecutingRequest = false;
            client.process();
        });
    } catch (e) {
        client.platform.log('Error while communicating with the Nuki Bridge. Exception: ' + JSON.stringify(e));

        // Checks the retry count
        item.retryCount = item.retryCount + 1;
        if (item.retryCount >= client.platform.config.requestRetryCount) {
            client.queue.shift();
            item.callback(false);
        }

        // Stops executing the request
        client.lastRequestTimestamp = new Date().getTime();
        client.isExecutingRequest = false;
        client.process();
    }
}

/**
 * Defines the export of the file.
 */
module.exports = NukiBridgeClient;
