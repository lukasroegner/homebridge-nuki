
/**
 * Represents the physical Nuki Bridge device.
 * @param platform The NukiPlatform instance.
 */
function NukiBridgeDevice(platform) {
    const device = this;
    const { UUIDGen, Accessory, Characteristic, Service } = platform;

    // Sets the bridge IP address
    device.bridgeIpAddress = platform.config.bridgeIpAddress;

    // Gets all accessories from the platform that match the Bridge IP address
    let unusedDeviceAccessories = [];
    let newDeviceAccessories = [];
    let deviceAccessories = [];
    for (let i = 0; i < platform.accessories.length; i++) {
        if (platform.accessories[i].context.bridgeIpAddress === platform.config.bridgeIpAddress) {
            unusedDeviceAccessories.push(platform.accessories[i]);
        }
    }

    // Gets the switch accessory
    let switchAccessory = null;
    for (let i = 0; i < unusedDeviceAccessories.length; i++) {
        if (unusedDeviceAccessories[i].context.kind === 'SwitchAccessory') {
            switchAccessory = unusedDeviceAccessories[i];
            unusedDeviceAccessories.splice(i, 1);
            break;
        }
    }

    // Creates a new one if it has not been cached
    if (!switchAccessory) {
        platform.log('Adding new accessory for Bridge with IP address ' + platform.config.bridgeIpAddress + ' and kind SwitchAccessory.');
        switchAccessory = new Accessory('Bridge', UUIDGen.generate(platform.config.bridgeIpAddress + 'SwitchAccessory'));
        switchAccessory.context.bridgeIpAddress = platform.config.bridgeIpAddress;
        switchAccessory.context.kind = 'SwitchAccessory';
        newDeviceAccessories.push(switchAccessory);
    }
    deviceAccessories.push(switchAccessory);

    // Registers the newly created accessories
    platform.api.registerPlatformAccessories(platform.pluginName, platform.platformName, newDeviceAccessories);

    // Removes all unused accessories
    for (let i = 0; i < unusedDeviceAccessories.length; i++) {
        platform.log('Removing unused accessory for Bridge with IP address ' + platform.config.bridgeIpAddress + ' and kind ' + unusedDeviceAccessories[i].context.kind + '.');
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
            .setCharacteristic(Characteristic.Model, 'Bridge')
            .setCharacteristic(Characteristic.SerialNumber, platform.config.bridgeIpAddress);
    }

    // Updates the switch
    let switchService = switchAccessory.getService(Service.Switch);
    if (!switchService) {
        switchService = switchAccessory.addService(Service.Switch);
    }
    switchService
        .setCharacteristic(Characteristic.On, false);

    // Subscribes for changes of the switch
    switchService
        .getCharacteristic(Characteristic.On).on('set', function (value, callback) {

            // Checks if the operation is true, as the reboot cannot be stopped
            if (!value) {
                return callback(null);
            }

            // Executes the action
            platform.log(platform.config.bridgeIpAddress + ' - Reboot');
            platform.client.send('/reboot', function () { });
            setTimeout(function () {
                switchService
                    .setCharacteristic(Characteristic.On, false);
            }, 5000);
            callback(null);
        });
}

/**
 * Defines the export of the file.
 */
module.exports = NukiBridgeDevice;
