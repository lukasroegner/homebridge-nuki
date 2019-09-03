
const request = require('request');
const http = require('http');

var homebridgeObj = null;
var pluginName = 'homebridge-nuki';
var platformName = 'NukiPlatform';

/**
 * Defines the export of the platform module.
 * @param homebridge The homebridge object that contains all classes, objects and functions for communicating with HomeKit.
 */
module.exports = function (homebridge) {

  // Gets the classes required for implementation of the plugin
  homebridgeObj = homebridge;

  // Registers the dynamic Nuki platform, as the accessories are read from the API and created dynamically
  homebridge.registerPlatform(pluginName, platformName, NukiPlatform, true);
}

/**
 * Initializes a new platform instance for the Nuki plugin.
 * @param log The logging function.
 * @param config The configuration that is passed to the plugin (from the config.json file).
 * @param api The API instance of homebridge (may be null on older homebridge versions).
 */
function NukiPlatform(log, config, api) {
  const platform = this;

  // Saves objects for functions
  platform.Accessory = homebridgeObj.platformAccessory;
  platform.Categories = homebridgeObj.hap.Accessory.Categories;
  platform.Service = homebridgeObj.hap.Service;
  platform.Characteristic = homebridgeObj.hap.Characteristic;
  platform.UUIDGen = homebridgeObj.hap.uuid;
  platform.hap = homebridgeObj.hap;
  platform.pluginName = pluginName;
  platform.platformName = platformName;

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
  platform.config.bridgeApiPort = platform.config.bridgeApiPort || 80;
  platform.config.bridgeApiToken = platform.config.bridgeApiToken || null;
  platform.config.devices = platform.config.devices || [];
  platform.config.supportedDeviceTypes = [2];

  // Checks whether the API object is available
  if (!api) {
    log('Homebridge API not available, please update your homebridge version!');
    return;
  }

  // Saves the API object to register new devices later on
  log('Homebridge API available.');
  platform.api = api;

  // Subscribes to the event that is raised when homebridge finished loading cached accessories
  platform.api.on('didFinishLaunching', function () {
    platform.log('Cached accessories loaded.');

    // Initially gets the devices from the Nuki Bridge API
    platform.getDevicesFromApi(function(devicesResult) {
      if (devicesResult) {
        platform.startCallbackServer(function (callbackServerResult) {
          if (callbackServerResult) {
            platform.registerCallback(function() { });
          }
        });
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

  // Checks if all required information is provided
  if (platform.config.bridgeIpAddress) {
    platform.log('No bridge IP address provided.');
    return callback(false);
  }
  if (platform.config.bridgeApiToken) {
    platform.log('No API token for the bridge provided.');
    return callback(false);
  }

  // Sends a request to the API to get all devices
  request({
    uri: 'http://' + platform.config.bridgeIpAddress + ':' + platform.config.bridgeApiPort + '/list?token=' + platform.config.bridgeApiToken,
    method: 'GET',
    json: true,
    rejectUnauthorized: false
  }, function (error, response, body) {

    // Checks if the API returned a positive result
    if (error || response.statusCode != 200 || !body) {
      if (error) {
        platform.log('Error while retrieving the devices from the API. Error: ' + error);
      } else if (response.statusCode != 200) {
        platform.log('Error while retrieving the devices from the API. Status Code: ' + response.statusCode);
      } else if (!body) {
        platform.log('Error while retrieving the devices from the API. Could not get devices from response: ' + JSON.stringify(body));
      }
      return callback(false);
    }

    // Initializes a device for each device from the API
    for (let i = 0; i < body.length; i++) {

      // Checks if the device is supported by this plugin
      let isSupported = false;
      for (let j = 0; j < platform.config.supportedDeviceTypes.length; j++) {
        if (platform.config.supportedDeviceTypes[j] === body[i].deviceType) {
          isSupported = true;
          break;
        }
      }
      if (!isSupported) {
        platform.log('Device with Nuki ID ' + body[i].nukiId + ' not added, as it is not supported by this plugin.');
        continue;
      }

      // Gets the corresponding device configuration
      let config = null;
      for (let j = 0; j < platform.config.devices.length; j++) {
        if (platform.config.devices[j].nukiId === body[i].nukiId) {
          config = platform.config.devices[i];
          break;
        }
      }
      if (!config) {
        platform.log('No configuration provided for device with Nuki ID ' + body[i].nukiId + '.');
        continue;
      }
      
      // Creates the device instance and adds it to the list of all devices
      if (body[i].deviceType == 2) {
        platform.devices.push(new NukiOpenerDevice(platform, body[i], config));
      }
    }

    // Removes the accessories that are not bound to a device
    let accessoriesToRemove = [];
    for (let i = 0; i < platform.accessories.length; i++) {

      // Checks if the device exists
      let deviceExists = false;
      for (let j = 0; j < platform.devices.length; j++) {
        if (platform.devices[j].nukiId === platform.accessories[i].context.nukiId) {
          deviceExists = true;
          break;
        }
      }
      if (deviceExists) {
        continue;
      }

      // Removes the accessory
      platform.log('Removing accessory with Nuki ID ' + platform.accessories[i].context.nukiId + ' and kind ' + platform.accessories[i].context.kind + '.');
      accessoriesToRemove.push(accessory);
      platform.accessories.splice(i, 1);
    }

    // Actually removes the accessories from the platform
    platform.api.unregisterPlatformAccessories(platform.pluginName, platform.platformName, accessoriesToRemove);

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
  if (platform.config.hostNameOrIpAddress) {
    platform.log('No host name or IP address provided.');
    return callback(false);
  }
  if (platform.config.hostCallbackApiPort) {
    platform.log('No API port for callback (host) provided.');
    return callback(false);
  }

  // Starts the server
  try {
    http.createServer(function(request, response) {
      const payload = [];

      // Subscribes for events of the request
      request.on('error', function() {
        platform.log('Error received from callback server.');
      }).on('data', function(chunk) {
        payload.push(chunk);
      }).on('end', function() {

        // Subscribes to errors when sending the response
        response.on('error', function() {
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
  } catch {

    // Returns a negative result
    platform.log('Callback server could not be started.');
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
  if (platform.config.hostNameOrIpAddress) {
    platform.log('No host name or IP address provided.');
    return callback(false);
  }
  if (platform.config.hostCallbackApiPort) {
    platform.log('No API port for callback (host) provided.');
    return callback(false);
  }

  // Sends a request to the API to get all callback URIs
  request({
    uri: 'http://' + platform.config.bridgeIpAddress + ':' + platform.config.bridgeApiPort + '/callback/list?token=' + platform.config.bridgeApiToken,
    method: 'GET',
    json: true,
    rejectUnauthorized: false
  }, function (error, response, body) {

    // Checks if the API returned a positive result
    if (error || response.statusCode != 200 || !body) {
      if (error) {
        platform.log('Error while retrieving the callback list from the API. Error: ' + error);
      } else if (response.statusCode != 200) {
        platform.log('Error while retrieving the callback list from the API. Status Code: ' + response.statusCode);
      } else if (!body) {
        platform.log('Error while retrieving the callback list from the API. Could not get callback list from response: ' + JSON.stringify(body));
      }
      return callback(false);
    }

    // Checks if the callback is already registered
    let isRegistered = false;
    if (body.callbacks) {
      for (let i = 0; i < body.callbacks.length; i++) {
        if (body.callbacks[i] === 'http://' + platform.config.hostNameOrIpAddress + ':' + platform.config.hostCallbackApiPort) {
          isRegistered = true;
          break;
        }
      }
    }
    if (isRegistered) {
      platform.log('Callback already registered.');
      return callback(true);
    }

    // Adds the callback to the Bridge API
    request({
      uri: 'http://' + platform.config.bridgeIpAddress + ':' + platform.config.bridgeApiPort + '/callback/add?url=' + encodeURI('http://' + platform.config.hostNameOrIpAddress + ':' + platform.config.hostCallbackApiPort) + '&token=' + platform.config.bridgeApiToken,
      method: 'GET',
      json: true,
      rejectUnauthorized: false
    }, function (error, response) {
  
      // Checks if the API returned a positive result
      if (error || response.statusCode != 200) {
        if (error) {
          platform.log('Error while adding the callback to the API. Error: ' + error);
        } else if (response.statusCode != 200) {
          platform.log('Error while adding the callback to the API. Status Code: ' + response.statusCode);
        }
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
 * Represents a physical Nuki Opener device.
 * @param platform The NukiPlatform instance.
 * @param apiConfig The device information provided by the Nuki Bridge API.
 * @param config The device configuration.
 */
function NukiOpenerDevice(platform, apiConfig, config) {
  const device = this;
  const { UUIDGen, Accessory, Characteristic, Service } = platform;

  // Sets the nuki ID
  device.nukiId = config.nukiId;

  // Gets all accessories from the platform that match the Nuki ID
  let unusedDeviceAccessories = [];
  let newDeviceAccessories = [];
  let deviceAccessories = [];
  for (let i = 0; i < platform.accessories.length; i++) {
    if (platform.accessories[i].context.nukiId === config.nukiId) {
      unusedDeviceAccessories.push(platform.accessories[i]);
    }
  }

  // Gets the lock accessory
  let lockAccessory = null; 
  for (let i = 0; i < unusedDeviceAccessories.length; i++) {
    if (unusedDeviceAccessories[i].context.kind === 'LockAccessory') {
      lockAccessory = unusedDeviceAccessories[i];
      unusedDeviceAccessories.splice(i, 1);
      break;
    }
  }

  // Creates a new one if it has not been cached
  if (!lockAccessory) {
    platform.log('Adding new accessory with Nuki ID ' + config.nukiId + ' and kind LockAccessory.');
    lockAccessory = new Accessory(name, UUIDGen.generate(config.nukiId + 'LockAccessory'));
    lockAccessory.context.nukiId = config.nukiId;
    lockAccessory.context.kind = 'LockAccessory';
    newDeviceAccessories.push(lockAccessory);
  }
  deviceAccessories.push(lockAccessory);

  // Gets the switch accessory
  let switchAccessory = null;
  if (config.isRingToOpenEnabled || config.isContinuousModeEnabled) {
    for (let i = 0; i < unusedDeviceAccessories.length; i++) {
      if (unusedDeviceAccessories[i].context.kind === 'SwitchAccessory') {
        switchAccessory = unusedDeviceAccessories[i];
        unusedDeviceAccessories.splice(i, 1);
        break;
      }
    }

    // Creates a new one if it has not been cached
    if (!switchAccessory) {
      platform.log('Adding new accessory with Nuki ID ' + config.nukiId + ' and kind SwitchAccessory.');
      switchAccessory = new Accessory(name + ' Settings', UUIDGen.generate(config.nukiId + 'SwitchAccessory'));
      switchAccessory.context.nukiId = config.nukiId;
      switchAccessory.context.kind = 'SwitchAccessory';
      newDeviceAccessories.push(switchAccessory);
    }
    deviceAccessories.push(switchAccessory);
  }

  // Registers the newly created accessories
  platform.api.registerPlatformAccessories(platform.pluginName, platform.platformName, newDeviceAccessories);

  // Removes all unused accessories
  for (let i = 0; i < unusedDeviceAccessories.length; i++) {
    platform.log('Removing unused accessory with Nuki ID ' + config.nukiId + ' and kind ' + unusedDeviceAccessories[i].context.kind + '.');
    platform.accessories.splice(platform.accessories.indexOf(unusedDeviceAccessories[i]), 1);
  }
  platform.api.unregisterPlatformAccessories(platform.pluginName, platform.platformName, unusedDeviceAccessories);

  // Updates the accessory information
  for (let i = 0; i < deviceAccessories.length; i++) {
    let accessoryInformationService = deviceAccessories[i].getService(Service.AccessoryInformation);
    if (!accessoryInformationService) {
      accessoryInformationService = deviceAccessories[i].addService(Service.AccessoryInformation);
    }
    accessoryInformationService
      .setCharacteristic(Characteristic.Manufacturer, 'Nuki')
      .setCharacteristic(Characteristic.Model, 'Opener')
      .setCharacteristic(Characteristic.SerialNumber, 'Nuki ID ' + config.nukiId);
  }

  // Updates the lock
  let lockService = lockAccessory.getService(Service.LockMechanism);
  if (!lockService) {
    lockService = lockAccessory.addService(Service.LockMechanism);
  }
  lockService
    .setCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED)
    .setCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);

  // Stores the lock service
  device.lockService = lockService;

  // Updates the RTO switch
  let ringToOpenSwitchService = null;
  if (switchAccessory && config.isRingToOpenEnabled) {
    ringToOpenSwitchService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'RingToOpen');
    if (!ringToOpenSwitchService) {
      ringToOpenSwitchService = switchAccessory.addService(Service.Switch, 'Ring to Open', 'RingToOpen');
    }
    ringToOpenSwitchService
      .setCharacteristic(Characteristic.On, apiConfig.lastKnownState.state == 3);

    // Stores the service
    device.ringToOpenSwitchService = ringToOpenSwitchService;
  }

  // Updates the continuous mode
  let continuousModeSwitchService = null;
  if (switchAccessory && config.isContinuousModeEnabled) {
    continuousModeSwitchService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'ContinuousMode');
    if (!continuousModeSwitchService) {
      continuousModeSwitchService = switchAccessory.addService(Service.Switch, 'Continuous Mode', 'ContinuousMode');
    }
    continuousModeSwitchService
      .setCharacteristic(Characteristic.On, apiConfig.lastKnownState.mode == 3);

    // Stores the service
    device.continuousModeSwitchService = continuousModeSwitchService;
  }

  // Subscribes for changes of the target state characteristic
  lockService
    .getCharacteristic(Characteristic.LockTargetState).on('set', function (value, callback) {

      // Checks if the operation is unsecured, as the Opener cannot be secured
      if (value !== Characteristic.LockTargetState.UNSECURED) {
        return;
      }

      // Executes the action
      platform.log(config.nukiId + ' - Unlock');
      request({
        uri: 'http://' + platform.config.bridgeIpAddress + ':' + platform.config.bridgeApiPort + '/lockAction?nukiId=' + config.nukiId + 'deviceType=2&action=3&token=' + platform.config.bridgeApiToken,
        method: 'GET',
        json: true,
        rejectUnauthorized: false
      });
      callback(null);
    });

  // Subscribes for changes of the night mode
  if (ringToOpenSwitchService) {
    ringToOpenSwitchService
      .getCharacteristic(Characteristic.On).on('set', function (value, callback) {

        // Executes the action
        platform.log(config.nukiId + ' - Set RTO to ' + value);
        request({
          uri: 'http://' + platform.config.bridgeIpAddress + ':' + platform.config.bridgeApiPort + '/lockAction?nukiId=' + config.nukiId + 'deviceType=2&action=' + (value ? '1' : '2') + '&token=' + platform.config.bridgeApiToken,
          method: 'GET',
          json: true,
          rejectUnauthorized: false
        });
        callback(null);
      });
  }

  // Subscribes for changes of the jet focus
  if (jetFocusSwitchService) {
    jetFocusSwitchService
      .getCharacteristic(Characteristic.On).on('set', function (value, callback) {

        // Executes the action
        platform.log(config.nukiId + ' - Set Continuous Mode to ' + value);
        request({
          uri: 'http://' + platform.config.bridgeIpAddress + ':' + platform.config.bridgeApiPort + '/lockAction?nukiId=' + config.nukiId + 'deviceType=2&action=' + (value ? '4' : '5') + '&token=' + platform.config.bridgeApiToken,
          method: 'GET',
          json: true,
          rejectUnauthorized: false
        });
        callback(null);
      });
  }
}

/**
 * Can be called to update the device information based on the new state.
 * @param state The lock state from the API.
 */
NukiOpenerDevice.prototype.update = function(state) {
  const device = this;
  const { Characteristic } = device.platform;
  
  // Sets the lock state
  if (state.state == 1 || state.state == 3) {
    platform.log(device.nukiId + ' - Updating lock state: SECURED/SECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
    device.lockService
      .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
  }
  if (state.state == 5) {
    platform.log(device.nukiId + ' - Updating lock state: UNSECURED/UNSECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
      device.lockService
        .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
  }
  if (state.state == 7) {
    platform.log(device.nukiId + ' - Updating lock state: -/UNSECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
  }

  // Sets the status for the continuous mode
  if (device.continuousModeSwitchService) {
    platform.log(device.nukiId + ' - Updating Continuous Mode: ' + state.mode);
    device.continuousModeSwitchService
      .updateCharacteristic(Characteristic.On, state.mode == 3);
  }
  
  // Sets the status for RTO
  if (device.ringToOpenSwitchService) {
    if (state.state == 1 || state.state == 3) {
      platform.log(device.nukiId + ' - Updating Continuous Mode: ' + state.state);
      device.ringToOpenSwitchService
        .updateCharacteristic(Characteristic.On, state.state == 3);
    }
  }
}
