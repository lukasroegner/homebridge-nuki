
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
  platform.config.bridgeApiPort = platform.config.bridgeApiPort || 8080;
  platform.config.bridgeApiToken = platform.config.bridgeApiToken || null;
  platform.config.devices = platform.config.devices || [];
  platform.config.supportedDeviceTypes = [0, 2];
  platform.config.requestBuffer = 3000;
  platform.config.requestRetryCount = 3;

  // Initializes the client
  platform.client = new NukiBridgeClient(platform);

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

  // Sends a request to the API to get all devices
  platform.client.send('/list', function (success, body) {

    // Checks the result
    if (!success) {
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

      // Prints out the device information
      if (body[i].deviceType == 0) {
        platform.log('Device with Nuki ID ' + body[i].nukiId + ' and name ' + body[i].name + ' is a SmartLock.');
      }
      if (body[i].deviceType == 2) {
        platform.log('Device with Nuki ID ' + body[i].nukiId + ' and name ' + body[i].name + ' is an Opener.');
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
      if (body[i].deviceType == 0) {
        platform.devices.push(new NukiSmartLockDevice(platform, body[i], config));
      }
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
      accessoriesToRemove.push(platform.accessories[i]);
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
  } catch(e) {

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
    let isRegistered = false;
    if (body.callbacks) {
      for (let i = 0; i < body.callbacks.length; i++) {
        if (body.callbacks[i].url === 'http://' + platform.config.hostNameOrIpAddress + ':' + platform.config.hostCallbackApiPort) {
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
 * Represents a physical Nuki Opener device.
 * @param platform The NukiPlatform instance.
 * @param apiConfig The device information provided by the Nuki Bridge API.
 * @param config The device configuration.
 */
function NukiOpenerDevice(platform, apiConfig, config) {
  const device = this;
  const { UUIDGen, Accessory, Characteristic, Service } = platform;

  // Sets the nuki ID and platform
  device.nukiId = config.nukiId;
  device.platform = platform;

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
    lockAccessory = new Accessory(apiConfig.name, UUIDGen.generate(config.nukiId + 'LockAccessory'));
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
      switchAccessory = new Accessory(apiConfig.name + ' Settings', UUIDGen.generate(config.nukiId + 'SwitchAccessory'));
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
      .setCharacteristic(Characteristic.SerialNumber, config.nukiId);
  }

  // Updates the lock
  let lockService = lockAccessory.getService(Service.LockMechanism);
  if (!lockService) {
    lockService = lockAccessory.addService(Service.LockMechanism);
  }
  lockService
    .setCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED)
    .setCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED)
    .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

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
        return callback(null);
      }

      // Executes the action
      platform.log(config.nukiId + ' - Unlock');
      platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=2&action=3', function(actionSuccess, actionBody) {
        if (actionSuccess && actionBody.success) {
          device.lockService
            .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
          device.lockService
            .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
        }
      });
      callback(null);
    });

  // Subscribes for changes of the RTO mode
  if (ringToOpenSwitchService) {
    ringToOpenSwitchService
      .getCharacteristic(Characteristic.On).on('set', function (value, callback) {

        // Executes the action
        platform.log(config.nukiId + ' - Set RTO to ' + value);
        platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=2&action=' + (value ? '1' : '2'), function() {});
        callback(null);
      });
  }

  // Subscribes for changes of the continuous mode
  if (continuousModeSwitchService) {
    continuousModeSwitchService
      .getCharacteristic(Characteristic.On).on('set', function (value, callback) {

        // Executes the action
        platform.log(config.nukiId + ' - Set Continuous Mode to ' + value);
        platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=2&action=' + (value ? '4' : '5'), function() {});
        callback(null);
      });
  }

  // Updates the state initially
  device.update(apiConfig.lastKnownState);
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
    device.platform.log(device.nukiId + ' - Updating lock state: SECURED/SECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
    device.lockService
      .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
  }
  if (state.state == 5) {
    device.platform.log(device.nukiId + ' - Updating lock state: UNSECURED/UNSECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
      device.lockService
        .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
  }
  if (state.state == 7) {
    device.platform.log(device.nukiId + ' - Updating lock state: -/UNSECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
  }

  // Sets the status for the continuous mode
  if (device.continuousModeSwitchService) {
    device.platform.log(device.nukiId + ' - Updating Continuous Mode: ' + state.mode);
    device.continuousModeSwitchService
      .updateCharacteristic(Characteristic.On, state.mode == 3);
  }
  
  // Sets the status for RTO
  if (device.ringToOpenSwitchService) {
    if (state.state == 1 || state.state == 3) {
      device.platform.log(device.nukiId + ' - Updating RTO: ' + state.state);
      device.ringToOpenSwitchService
        .updateCharacteristic(Characteristic.On, state.state == 3);
    }
  }

  // Sets the status of the battery
  device.platform.log(device.nukiId + ' - Updating critical battery: ' + state.batteryCritical);
  if (state.batteryCritical) {
    device.lockService
      .updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
  } else {
    device.lockService
      .updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  }
}

/**
 * Represents a physical Nuki SmartLock device.
 * @param platform The NukiPlatform instance.
 * @param apiConfig The device information provided by the Nuki Bridge API.
 * @param config The device configuration.
 */
function NukiSmartLockDevice(platform, apiConfig, config) {
  const device = this;
  const { UUIDGen, Accessory, Characteristic, Service } = platform;

  // Sets the nuki ID and platform
  device.nukiId = config.nukiId;
  device.platform = platform;

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
    lockAccessory = new Accessory(apiConfig.name, UUIDGen.generate(config.nukiId + 'LockAccessory'));
    lockAccessory.context.nukiId = config.nukiId;
    lockAccessory.context.kind = 'LockAccessory';
    newDeviceAccessories.push(lockAccessory);
  }
  deviceAccessories.push(lockAccessory);

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
      .setCharacteristic(Characteristic.Model, 'SmartLock')
      .setCharacteristic(Characteristic.SerialNumber, config.nukiId);
  }

  // Updates the lock
  let lockService = lockAccessory.getServiceByUUIDAndSubType(Service.LockMechanism, 'Lock');
  if (!lockService) {
    lockService = lockAccessory.addService(Service.LockMechanism, 'Lock', 'Lock');
  }
  lockService
    .setCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED)
    .setCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED)
    .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

  // Stores the lock service
  device.lockService = lockService;

  // Updates the unlatch service
  let unlatchService = lockAccessory.getServiceByUUIDAndSubType(Service.LockMechanism, 'Unlatch');
  if (config.unlatchLock) {
    if (!unlatchService) {
      unlatchService = lockAccessory.addService(Service.LockMechanism, 'Latch', 'Unlatch');
    }
    unlatchService
      .setCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED)
      .setCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);

    // Stores the service
    device.unlatchService = unlatchService;
  } else {
    if (unlatchService) {
      lockAccessory.removeService(unlatchService);
      unlatchService = null;
    }
  }

  // Subscribes for changes of the target state characteristic
  lockService
    .getCharacteristic(Characteristic.LockTargetState).on('set', function (value, callback) {

      // Checks if the operation is unsecured
      if (value === Characteristic.LockTargetState.UNSECURED) {
        if (lockService.getCharacteristic(Characteristic.LockCurrentState).value === Characteristic.LockCurrentState.SECURED) {
          if (config.unlatchFromLockedToUnlocked) {

            // Sets the target state of the unlatch switch to unsecured, as both should be displayed as open
            if (unlatchService) {
              unlatchService
                .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
            }
              
            // Unlatches the door
            platform.log(config.nukiId + ' - Unlatch');
            platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=3', function(actionSuccess, actionBody) {
              if (actionSuccess && actionBody.success) {
                device.lockService
                  .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                device.lockService
                  .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
              }
            });

          } else {

            // Unlocks the door
            platform.log(config.nukiId + ' - Unlock');
            platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=1', function(actionSuccess, actionBody) {
              if (actionSuccess && actionBody.success) {
                device.lockService
                  .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                device.lockService
                  .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
              }
            });
          }
        }
        if (lockService.getCharacteristic(Characteristic.LockCurrentState).value === Characteristic.LockCurrentState.UNSECURED) {
          if (config.unlatchFromUnlockedToUnlocked) {

            // Sets the target state of the unlatch switch to unsecured, as both should be displayed as open
            if (unlatchService) {
              unlatchService
                .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
            }
              
            // Unlatches the door
            platform.log(config.nukiId + ' - Unlatch');
            platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=3', function(actionSuccess, actionBody) {
              if (actionSuccess && actionBody.success) {
                device.lockService
                  .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                device.lockService
                  .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
              }
            });

          }
        }
      }

      // Checks if the operation is secured
      if (value === Characteristic.LockTargetState.SECURED) {
        platform.log(config.nukiId + ' - Lock');
        platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=2', function(actionSuccess, actionBody) {
          if (actionSuccess && actionBody.success) {
            device.lockService
              .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
            device.lockService
              .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
          }
        });
      }

      // Performs the callback
      callback(null);
    });

  // Subscribes for changes of the unlatch lock
  if (unlatchService) {
    unlatchService
      .getCharacteristic(Characteristic.LockTargetState).on('set', function (value, callback) {

        // Checks if the operation is unsecured, as the latch cannot be secured
        if (value !== Characteristic.LockTargetState.UNSECURED) {
          return callback(null);
        }

        // Sets the target state of the lock to unsecured, as both should be displayed as open
        lockService
          .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);

        // Unlatches the lock
        platform.log(config.nukiId + ' - Unlatch');
        platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=3', function(actionSuccess, actionBody) {
          if (actionSuccess && actionBody.success) {
            unlatchService
              .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
            unlatchService
              .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
          }
        });
        callback(null);
      });
  }

  // Updates the state initially
  device.update(apiConfig.lastKnownState);
}

/**
 * Can be called to update the device information based on the new state.
 * @param state The lock state from the API.
 */
NukiSmartLockDevice.prototype.update = function(state) {
  const device = this;
  const { Characteristic } = device.platform;
  
  // Sets the lock state
  if (state.state == 1) {
    device.platform.log(device.nukiId + ' - Updating lock state: SECURED/SECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
    device.lockService
      .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
    if (device.unlatchService) {
      device.unlatchService
        .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
      device.unlatchService
        .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
    }
  }
  if (state.state == 3) {
    device.platform.log(device.nukiId + ' - Updating lock state: UNSECURED/UNSECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
    device.lockService
      .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
    if (device.unlatchService) {
      device.platform.log(device.nukiId + ' - Updating latch state: SECURED/SECURED');
      device.unlatchService
        .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
      device.unlatchService
        .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
    }
  }
  if (state.state == 5) {
    device.platform.log(device.nukiId + ' - Updating lock state: UNSECURED/UNSECURED');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
    device.lockService
      .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
    if (device.unlatchService) {
      device.platform.log(device.nukiId + ' - Updating latch state: UNSECURED/UNSECURED');
      device.unlatchService
        .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
      device.unlatchService
        .updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
    }
  }
  if (state.state == 254) {
    device.platform.log(device.nukiId + ' - Updating lock state: JAMMED/-');
    device.lockService
      .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.JAMMED);
    if (device.unlatchService) {
      device.unlatchService
        .updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.JAMMED);
    }
  }

  // Sets the status of the battery
  device.platform.log(device.nukiId + ' - Updating critical battery: ' + state.batteryCritical);
  if (state.batteryCritical) {
    device.lockService
      .updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
  } else {
    device.lockService
      .updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  }
}

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
NukiBridgeClient.prototype.send = function(uriPath, callback) {
  const client = this;

  // Adds the request to the queue
  client.queue.push({ uriPath: uriPath, callback: callback, retryCount: 0 });

  // Starts processing the queue
  client.process();
}

/**
 * Check if the queue contains elements that can be sent to the Bridge API.
 */
NukiBridgeClient.prototype.process = function() {
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
    setTimeout(function() {
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
