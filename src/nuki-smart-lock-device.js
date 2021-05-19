
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
    device.lockName = config.defaultLockName || 'Lock';
    device.latchName = config.defaultLatchName || 'Latch';

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
        lockAccessory = new Accessory(apiConfig.name || 'Nuki', UUIDGen.generate(config.nukiId + 'LockAccessory'));
        lockAccessory.context.nukiId = config.nukiId;
        lockAccessory.context.kind = 'LockAccessory';
        newDeviceAccessories.push(lockAccessory);
    }
    deviceAccessories.push(lockAccessory);

    // Gets the contact sensor accessory
    let contactSensorAccessory = null;
    if (config.isDoorSensorEnabled) {
        if (config.isSingleAccessoryModeEnabled) {
            contactSensorAccessory = lockAccessory;
        } else {
            contactSensorAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'ContactSensorAccessory'; });
            if (contactSensorAccessory) {
                unusedDeviceAccessories.splice(unusedDeviceAccessories.indexOf(contactSensorAccessory), 1);
            } else {
                platform.log('Adding new accessory with Nuki ID ' + config.nukiId + ' and kind ContactSensorAccessory.');
                contactSensorAccessory = new Accessory((apiConfig.name || 'Nuki') + ' Settings', UUIDGen.generate(config.nukiId + 'ContactSensorAccessory'));
                contactSensorAccessory.context.nukiId = config.nukiId;
                contactSensorAccessory.context.kind = 'ContactSensorAccessory';
                newDeviceAccessories.push(contactSensorAccessory);
            }
            deviceAccessories.push(contactSensorAccessory);
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
            .setCharacteristic(Characteristic.Model, 'SmartLock')
            .setCharacteristic(Characteristic.SerialNumber, config.nukiId.toString());
    }

    // Updates the lock
    let lockService = lockAccessory.getServiceByUUIDAndSubType(Service.LockMechanism, 'Lock');
    if (!lockService) {
        lockService = lockAccessory.addService(Service.LockMechanism, device.lockName, 'Lock');
    }

    // Stores the lock service
    device.lockService = lockService;

    // Updates the unlatch service
    let unlatchService = lockAccessory.getServiceByUUIDAndSubType(Service.LockMechanism, 'Unlatch');
    if (config.unlatchLock) {
        if (!unlatchService) {
            unlatchService = lockAccessory.addService(Service.LockMechanism, device.latchName, 'Unlatch');
        }

        // Stores the service
        device.unlatchService = unlatchService;
    } else {
        if (unlatchService) {
            lockAccessory.removeService(unlatchService);
            unlatchService = null;
        }
    }

    // Removes the old low battery characteristic
    let statusLowBatteryCharacteristic = lockService.getCharacteristic(Characteristic.StatusLowBattery);
    if (statusLowBatteryCharacteristic) {
        lockService.removeCharacteristic(statusLowBatteryCharacteristic);
    }

    // Updates the battery service
    let batteryService = lockAccessory.getServiceByUUIDAndSubType(Service.BatteryService, 'Battery');
    if (!batteryService) {
        batteryService = lockAccessory.addService(Service.BatteryService, 'Battery', 'Battery');
    }

    // Stores the battery service
    device.batteryService = batteryService;

    // Updates the contact sensor
    let contactSensorService = null;
    if (contactSensorAccessory && config.isDoorSensorEnabled) {
        contactSensorService = contactSensorAccessory.getServiceByUUIDAndSubType(Service.ContactSensor, 'DoorSensor');
        if (!contactSensorService) {
            contactSensorService = contactSensorAccessory.addService(Service.ContactSensor, 'Door', 'DoorSensor');
        }

        // Stores the service
        device.contactSensorService = contactSensorService;
    }

    // Subscribes for changes of the target state characteristic
    lockService.getCharacteristic(Characteristic.LockTargetState).on('set', function (value, callback) {

        // Checks if the operation is unsecured
        if (value === Characteristic.LockTargetState.UNSECURED) {
            if (lockService.getCharacteristic(Characteristic.LockCurrentState).value === Characteristic.LockCurrentState.SECURED) {
                if (config.unlatchFromLockedToUnlocked) {

                    // Sets the target state of the unlatch switch to unsecured, as both should be displayed as open
                    if (unlatchService) {
                        unlatchService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
                    }

                    // Unlatches the door
                    platform.log(config.nukiId + ' - Unlatch');
                    platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=3', function (actionSuccess, actionBody) {
                        if (actionSuccess && actionBody.success) {
                            device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                            device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
                        }
                    });

                } else {

                    // Unlocks the door
                    platform.log(config.nukiId + ' - Unlock');
                    platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=1', function (actionSuccess, actionBody) {
                        if (actionSuccess && actionBody.success) {
                            device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                            device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
                        }
                    });
                }
            }
            if (lockService.getCharacteristic(Characteristic.LockCurrentState).value === Characteristic.LockCurrentState.UNSECURED) {
                if (config.unlatchFromUnlockedToUnlocked) {

                    // Sets the target state of the unlatch switch to unsecured, as both should be displayed as open
                    if (unlatchService) {
                        unlatchService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
                    }

                    // Unlatches the door
                    platform.log(config.nukiId + ' - Unlatch');
                    platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=3', function (actionSuccess, actionBody) {
                        if (actionSuccess && actionBody.success) {
                            device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                            device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
                        }
                    });

                }
            }
        }

        // Checks if the operation is secured
        if (value === Characteristic.LockTargetState.SECURED) {
            if (lockService.getCharacteristic(Characteristic.LockCurrentState).value === Characteristic.LockCurrentState.SECURED) {
                if (config.lockFromLockedToLocked) {
                    platform.log(config.nukiId + ' - Lock again (already locked)');
                    platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=2', function (actionSuccess, actionBody) {
                        if (actionSuccess && actionBody.success) {
                            device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
                            device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
                        }
                    });
                }
            } else {
                platform.log(config.nukiId + ' - Lock');
                platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=2', function (actionSuccess, actionBody) {
                    if (actionSuccess && actionBody.success) {
                        device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
                        device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
                    }
                });
            }
        }

        // Performs the callback
        callback(null);
    });

    // Subscribes for changes of the unlatch lock
    if (unlatchService) {
        unlatchService.getCharacteristic(Characteristic.LockTargetState).on('set', function (value, callback) {

            // Checks if the operation is unsecured, as the latch cannot be secured
            if (value !== Characteristic.LockTargetState.UNSECURED) {
                return callback(null);
            }

            // Checks if the safety mechanism is enabled, so that the lock cannot unlatch when locked
            if (lockService.getCharacteristic(Characteristic.LockCurrentState).value === Characteristic.LockCurrentState.SECURED) {
                if (config.unlatchLockPreventUnlatchIfLocked) {
                    unlatchService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
                    unlatchService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
                    return;
                }
            }

            // Sets the target state of the lock to unsecured, as both should be displayed as open
            lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);

            // Unlatches the lock
            platform.log(config.nukiId + ' - Unlatch');
            platform.client.send('/lockAction?nukiId=' + config.nukiId + '&deviceType=0&action=3', function (actionSuccess, actionBody) {
                if (actionSuccess && actionBody.success) {
                    unlatchService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                    unlatchService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
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
NukiSmartLockDevice.prototype.update = function (state) {
    const device = this;
    const { Characteristic } = device.platform;

    // Checks if the state exists, which is not the case if the device is unavailable
    if (!state) {
        return;
    }

    // Sets the lock state
    if (state.state == 1) {
        device.platform.log(device.nukiId + ' - Updating lock state: SECURED/SECURED');
        device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
        device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
        if (device.unlatchService) {
            device.unlatchService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
            device.unlatchService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
        }
    }
    if (state.state == 3) {
        device.platform.log(device.nukiId + ' - Updating lock state: UNSECURED/UNSECURED');
        device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
        device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
        if (device.unlatchService) {
            device.platform.log(device.nukiId + ' - Updating latch state: SECURED/SECURED');
            device.unlatchService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
            device.unlatchService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
        }
    }
    if (state.state == 5) {
        device.platform.log(device.nukiId + ' - Updating lock state: UNSECURED/UNSECURED');
        device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
        device.lockService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
        if (device.unlatchService) {
            device.platform.log(device.nukiId + ' - Updating latch state: UNSECURED/UNSECURED');
            device.unlatchService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
            device.unlatchService.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.UNSECURED);
        }
    }
    if (state.state == 254) {
        device.platform.log(device.nukiId + ' - Updating lock state: JAMMED/-');
        device.lockService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.JAMMED);
        if (device.unlatchService) {
            device.unlatchService.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.JAMMED);
        }
    }

    // Sets the status of the battery
    device.platform.log(device.nukiId + ' - Updating critical battery: ' + state.batteryCritical);
    if (state.batteryCritical) {
        device.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    } else {
        device.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    }
    if (state.batteryCharging === false) {
        device.platform.log(device.nukiId + ' - Updating battery charging: NO');
        device.batteryService.updateCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGING);
    }
    if (state.batteryCharging === true) {
        device.platform.log(device.nukiId + ' - Updating battery charging: YES');
        device.batteryService.updateCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.CHARGING);
    }
    if (state.batteryChargeState && !isNaN(state.batteryChargeState)) {
        device.platform.log(device.nukiId + ' - Updating battery level: ' + state.batteryChargeState);
        device.batteryService.updateCharacteristic(Characteristic.BatteryLevel, state.batteryChargeState);
    }

    // Sets the door sensor state
    if (device.contactSensorService) {
        if (state.doorsensorState === 3) {
            device.platform.log(device.nukiId + ' - Updating Door State: Open');
            device.contactSensorService.updateCharacteristic(Characteristic.ContactSensorState, Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
            device.contactSensorService.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT);
        } else if (state.doorsensorState === 2) {
            device.platform.log(device.nukiId + ' - Updating Door State: Closed');
            device.contactSensorService.updateCharacteristic(Characteristic.ContactSensorState, Characteristic.ContactSensorState.CONTACT_DETECTED);
            device.contactSensorService.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT);
        } else {
            device.platform.log(device.nukiId + ' - Updating Door State: Fault');
            device.contactSensorService.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.GENERAL_FAULT);
        }
    }
}

/**
 * Defines the export of the file.
 */
module.exports = NukiSmartLockDevice;
