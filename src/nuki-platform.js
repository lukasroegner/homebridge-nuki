
const http = require('http');

const NukiBridgeClient = require('./nuki-bridge-client');
const NukiSmartLockDevice = require('./nuki-smart-lock-device');
const NukiOpenerDevice = require('./nuki-opener-device');
const NukiBridgeDevice = require('./nuki-bridge-device');
const NukiApi = require('./nuki-api');

/**
 * Initializes a new platform instance for the Nuki plugin.
 * @param log The logging function.
 * @param config The configuration that is passed to the plugin (from the config.json file).
 * @param api The API instance of homebridge (may be null on older homebridge versions).
 */
function NukiPlatform(log, config, api) {
    const platform = this;

    // Saves objects for functions
    platform.Accessory = api.platformAccessory;
    platform.Categories = api.hap.Accessory.Categories;
    platform.Service = api.hap.Service;
    platform.Characteristic = api.hap.Characteristic;
    platform.UUIDGen = api.hap.uuid;
    platform.hap = api.hap;
    platform.pluginName = 'homebridge-nuki';
    platform.platformName = 'NukiPlatform';

    // Checks whether a configuration is provided, otherwise the plugin should not be initialized
    if (!config) {
        return;
    }

    // Defines the variables that are used throughout the platform
    platform.log = log;
    platform.config = config;
    platform.devices = [];
    platform.accessories = [];

    // Initializes the configuration
    platform.config.hostNameOrIpAddress = platform.config.hostNameOrIpAddress || null;
    platform.config.hostCallbackApiPort = platform.config.hostCallbackApiPort || 40506;
    platform.config.bridgeIpAddress = platform.config.bridgeIpAddress || null;
    platform.config.bridgeApiPort = platform.config.bridgeApiPort || 8080;
    platform.config.bridgeApiToken = platform.config.bridgeApiToken || null;
    platform.config.devices = platform.config.devices || [];
    platform.config.isApiEnabled = platform.config.isApiEnabled || false;
    platform.config.apiPort = platform.config.apiPort || 40011;
    platform.config.apiToken = platform.config.apiToken || null;
    platform.config.supportedDeviceTypes = [0, 2];
    platform.config.requestBuffer = 3000;
    platform.config.requestRetryCount = 3;

    // Initializes the client
    platform.client = new NukiBridgeClient(platform);

    // Checks whether the API object is available
    if (!api) {
        platform.log('Homebridge API not available, please update your homebridge version!');
        return;
    }

    // Saves the API object to register new devices later on
    platform.log('Homebridge API available.');
    platform.api = api;

    // Subscribes to the event that is raised when homebridge finished loading cached accessories
    platform.api.on('didFinishLaunching', function () {
        platform.log('Cached accessories loaded.');

        // Initially gets the devices from the Nuki Bridge API
        platform.getDevicesFromApi(function (devicesResult) {
            if (devicesResult) {
                platform.startCallbackServer(function (callbackServerResult) {
                    if (callbackServerResult) {
                        platform.registerCallback(function () { });
                    }
                });

                // Starts the API if requested
                if (platform.config.isApiEnabled) {
                    platform.nukiApi = new NukiApi(platform);
                }
            }
        });
    });
}

/**
 * Gets the devices from the Bridge API.
 * @param callback The callback function that gets a boolean value indicating success or failure.
 */
NukiPlatform.prototype.getDevicesFromApi = function (callback) {
    const platform = this;

    // Sends a request to the API to get all devices
    platform.client.send('/list', function (success, body) {

        // Checks the result
        if (!success) {
            return callback(false);
        }

        // Stores the devices in the plugin
        platform.apiConfig = body;

        // Initializes a device for each device from the API
        for (let i = 0; i < body.length; i++) {
            const apiConfig = body[i];

            // Checks if the device is supported by this plugin
            if (!platform.config.supportedDeviceTypes.some(function(t) { return t === apiConfig.deviceType; })) {
                platform.log('Device with Nuki ID ' + apiConfig.nukiId + ' not added, as it is not supported by this plugin.');
                continue;
            }

            // Prints out the device information
            if (apiConfig.deviceType == 0) {
                platform.log('Device with Nuki ID ' + apiConfig.nukiId + ' and name ' + apiConfig.name + ' is a SmartLock.');
            }
            if (apiConfig.deviceType == 2) {
                platform.log('Device with Nuki ID ' + apiConfig.nukiId + ' and name ' + apiConfig.name + ' is an Opener.');
            }

            // Gets the corresponding device configuration
            const config = platform.config.devices.find(function(d) { return d.nukiId === apiConfig.nukiId; });
            if (!config) {
                platform.log('No configuration provided for device with Nuki ID ' + apiConfig.nukiId + '.');
                continue;
            }

            // Creates the device instance and adds it to the list of all devices
            if (apiConfig.deviceType == 0) {
                platform.devices.push(new NukiSmartLockDevice(platform, apiConfig, config));
            }
            if (apiConfig.deviceType == 2) {
                platform.devices.push(new NukiOpenerDevice(platform, apiConfig, config));
            }
        }

        // Checks if the Bridge should be added as device
        if (platform.config.bridgeRebootSwitch) {
            platform.devices.push(new NukiBridgeDevice(platform));
        }

        // Removes the accessories that are not bound to a device
        let unusedAccessories = platform.accessories.filter(function(a) { return !platform.devices.some(function(d) { return d.nukiId === a.context.nukiId || d.bridgeIpAddress === a.context.bridgeIpAddress; }); });
        for (let i = 0; i < unusedAccessories.length; i++) {
            const unusedAccessory = unusedAccessories[i];
            platform.log('Removing accessory with Nuki ID ' + unusedAccessory.context.nukiId + ' and kind ' + unusedAccessory.context.kind + '.');
            platform.accessories.splice(platform.accessories.indexOf(unusedAccessory), 1);
        }
        platform.api.unregisterPlatformAccessories(platform.pluginName, platform.platformName, unusedAccessories);

        // Returns a positive result
        platform.log('Got devices from the Nuki Bridge API.');
        return callback(true);
    });
}

/**
 * Starts the server that receives the callbacks from the Bridge API.
 * @param callback The callback function that gets a boolean value indicating success or failure.
 */
NukiPlatform.prototype.startCallbackServer = function (callback) {
    const platform = this;

    // Checks if all required information is provided
    if (!platform.config.hostNameOrIpAddress) {
        platform.log('No host name or IP address provided.');
        return callback(false);
    }
    if (!platform.config.hostCallbackApiPort) {
        platform.log('No API port for callback (host) provided.');
        return callback(false);
    }

    // Starts the server
    try {
        http.createServer(function (request, response) {
            const payload = [];

            // Subscribes for events of the request
            request.on('error', function () {
                platform.log('Error received from callback server.');
            }).on('data', function (chunk) {
                payload.push(chunk);
            }).on('end', function () {

                // Subscribes to errors when sending the response
                response.on('error', function () {
                    platform.log('Error sending the response from callback server.');
                });

                // Generates the request string
                const content = JSON.parse(Buffer.concat(payload).toString());

                // Checks if the request is valid
                if (!content.nukiId) {
                    platform.log('Callback received, but invalid.');
                    response.statusCode = 400;
                    response.end();
                }

                // Sends a response to the Bridge API
                platform.log('Callback received.');
                response.statusCode = 200;
                response.end();

                // Updates the device
                for (let i = 0; i < platform.devices.length; i++) {
                    if (platform.devices[i].nukiId == content.nukiId) {
                        platform.devices[i].update(content);
                    }
                }
            });
        }).listen(platform.config.hostCallbackApiPort, "0.0.0.0");

        // Returns a positive result
        platform.log('Callback server started.');
        return callback(true);
    } catch (e) {

        // Returns a negative result
        platform.log('Callback server could not be started: ' + JSON.stringify(e));
        return callback(false);
    }
}

/**
 * Registers the callback for changes of the lock states.
 * @param callback The callback function that gets a boolean value indicating success or failure.
 */
NukiPlatform.prototype.registerCallback = function (callback) {
    const platform = this;

    // Checks if all required information is provided
    if (!platform.config.hostNameOrIpAddress) {
        platform.log('No host name or IP address provided.');
        return callback(false);
    }
    if (!platform.config.hostCallbackApiPort) {
        platform.log('No API port for callback (host) provided.');
        return callback(false);
    }

    // Sends a request to the API to get all callback URIs
    platform.client.send('/callback/list', function (success, body) {

        // Checks the result
        if (!success) {
            return callback(false);
        }

        // Checks if the callback is already registered
        if (body.callbacks && body.callbacks.some(function(c) { return c.url === 'http://' + platform.config.hostNameOrIpAddress + ':' + platform.config.hostCallbackApiPort; })) {
            platform.log('Callback already registered.');
            return callback(true);
        }

        // Adds the callback to the Bridge API
        platform.client.send('/callback/add?url=' + encodeURI('http://' + platform.config.hostNameOrIpAddress + ':' + platform.config.hostCallbackApiPort), function (innerSuccess) {

            // Checks the result
            if (!innerSuccess) {
                return callback(false);
            }

            // Returns a positive result
            platform.log('Callback registered.');
            return callback(true);
        });
    });
}

/**
 * Configures a previously cached accessory.
 * @param accessory The cached accessory.
 */
NukiPlatform.prototype.configureAccessory = function (accessory) {
    const platform = this;

    // Adds the cached accessory to the list
    platform.accessories.push(accessory);
}

/**
 * Defines the export of the file.
 */
module.exports = NukiPlatform;
