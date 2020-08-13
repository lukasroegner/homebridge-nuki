
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
    device.leaveOpen = config.leaveOpen;
    device.platform = platform;

    // Gets all accessories from the platform that match the Nuki ID
    let unusedDeviceAccessories = platform.accessories.filter(function(a) { return a.context.nukiId === config.nukiId; });
    let newDeviceAccessories = [];
    let deviceAccessories = [];

    // Gets the lock accessory
    let lockAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'LockAccessory'; });
    if (lockAccessory) {
        unusedDeviceAccessories.splice(unusedDeviceAccessories.indexOf(lockAccessory), 1);
    } else {
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
        if (config.isSingleAccessoryModeEnabled) {
            switchAccessory = lockAccessory;
        } else {
            switchAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'SwitchAccessory'; });
            if (switchAccessory) {
                unusedDeviceAccessories.splice(unusedDeviceAccessories.indexOf(switchAccessory), 1);
            } else {
                platform.log('Adding new accessory with Nuki ID ' + config.nukiId + ' and kind SwitchAccessory.');
                switchAccessory = new Accessory(apiConfig.name + ' Settings', UUIDGen.generate(config.nukiId + 'SwitchAccessory'));
                switchAccessory.context.nukiId = config.nukiId;
                switchAccessory.context.kind = 'SwitchAccessory';
                newDeviceAccessories.push(switchAccessory);
            }
            deviceAccessories.push(switchAccessory);
        }
    }

    // Registers the newly created accessories
    platform.api.registerPlatformAccessories(platform.pluginName, platform.platformName, newDeviceAccessories);

    // Removes all unused accessories
    for (let i = 0; i < unusedDeviceAccessories.length; i++) {
        const unusedDeviceAccessory = unusedDeviceAccessories[i];
        platform.log('Removing unused accessory with Nuki ID ' + config.nukiId + ' and kind ' + unusedDeviceAccessory.context.kind + '.');
        platform.accessories.splice(platform.accessories.indexOf(unusedDeviceAccessory), 1);
    }
    platform.api.unregisterPlatformAccessories(platform.pluginName, platform.platformName, unusedDeviceAccessories);

    // Updates the accessory information
    for (let i = 0; i < deviceAccessories.length; i++) {
        const deviceAccessory = deviceAccessories[i];
        let accessoryInformationService = deviceAccessory.getService(Service.AccessoryInformation);
        if (!accessoryInformationService) {
            accessoryInformationService = deviceAccessory.addService(Service.AccessoryInformation);
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

    // Stores the lock service
    device.lockService = lockService;

    // Updates the doorbell
    let doorbellService = lockAccessory.getService(Service.Doorbell);
    if (config.isDoorbellEnabled) {
        if (!doorbellService) {
            doorbellService = lockAccessory.addService(Service.Doorbell);
        }

        // Stores the doorbell service
        device.doorbellService = doorbellService;
    } else {
        if (doorbellService) {
            lockAccessory.removeService(doorbellService);
        }
    }

    // Updates the RTO switch
    let ringToOpenSwitchService = null;
    if (switchAccessory && config.isRingToOpenEnabled) {
        ringToOpenSwitchService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'RingToOpen');
        if (!ringToOpenSwitchService) {
            ringToOpenSwitchService = switchAccessory.addService(Service.Switch, 'Ring to Open', 'RingToOpen');
        }

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

        // Stores the service
        device.continuousModeSwitchService = continuousModeSwitchService;
    }

    // Subscribes for changes of the target state characteristic
    lockService.getCharacteristic(Characteristic.LockTargetState).on('set', function (value, callback) {

        // Checks if the operation is unsecured, as the Opener cannot be secured
        if (value !== Characteristic.LockTargetState.UNSECURED) {
            return callback(null);
        }

        // Executes the action
        platform.log(config.nukiId + ' - Unlock');
        platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=2&action=3', function (actionSuccess, actionBody) {
            if (actionSuccess && actionBody.success) {
                device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
            }
        });
        callback(null);
    });

    // Subscribes for changes of the RTO mode
    if (ringToOpenSwitchService) {
        ringToOpenSwitchService.getCharacteristic(Characteristic.On).on('set', function (value, callback) {

            // Executes the action
            platform.log(config.nukiId + ' - Set RTO to ' + value);
            platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=2&action=' + (value ? '1' : '2'), function () { });
            callback(null);
        });
    }

    // Subscribes for changes of the continuous mode
    if (continuousModeSwitchService) {
        continuousModeSwitchService.getCharacteristic(Characteristic.On).on('set', function (value, callback) {

            // Executes the action
            platform.log(config.nukiId + ' - Set Continuous Mode to ' + value);
            platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=2&action=' + (value ? '4' : '5'), function () { });
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
NukiOpenerDevice.prototype.update = function (state) {
    const device = this;
    const { Characteristic } = device.platform;

    // Checks if the state exists, which is not the case if the device is unavailable
    if (!state) {
        return;
    }

    // Sets the lock state
    if (state.state == 1 || state.state == 3) {
        if (!device.leaveOpen) {
            device.platform.log(device.nukiId + ' - Updating lock state: SECURED/SECURED');
            device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
            device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
        }
    }
    if (state.state == 5) {
        device.platform.log(device.nukiId + ' - Updating lock state: UNSECURED/UNSECURED');
        device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
        device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
    }
    if (state.state == 7) {
        device.platform.log(device.nukiId + ' - Updating lock state: -/UNSECURED');
        device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
    }

    // Sets the ring action state
    if (device.doorbellService && state.ringactionState) {
        device.platform.log(device.nukiId + ' - Updating doorbell: Ring');
        device.doorbellService.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, 0);
    }

    // Sets the status for the continuous mode
    if (device.continuousModeSwitchService) {
        device.platform.log(device.nukiId + ' - Updating Continuous Mode: ' + state.mode);
        device.continuousModeSwitchService.updateCharacteristic(Characteristic.On, state.mode == 3);
    }

    // Sets the status for RTO
    if (device.ringToOpenSwitchService) {
        if (state.state == 1 || state.state == 3) {
            device.platform.log(device.nukiId + ' - Updating RTO: ' + state.state);
            device.ringToOpenSwitchService.updateCharacteristic(Characteristic.On, state.state == 3);
        }
    }

    // Sets the status of the battery
    device.platform.log(device.nukiId + ' - Updating critical battery: ' + state.batteryCritical);
    if (state.batteryCritical) {
        device.lockService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    } else {
        device.lockService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    }
}

/**
 * Defines the export of the file.
 */
module.exports = NukiOpenerDevice;
