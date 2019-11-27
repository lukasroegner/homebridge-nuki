# homebridge-nuki

This project is a homebridge plugin for Nuki devices.

The device information is loaded from the local Nuki Bridge, therefore you just have to specify an API token for communication with the Nuki Bridge.

## Bridge

The Nuki Bridge is exposed as a switch for rebooting (optional).

## SmartLock

The Nuki SmartLock is exposed as a lock in HomeKit with support for:
- Lock/Unlock/Unlatch
- Status for Low Battery

Optionally, a second switch is shown in the lock that represents the latch.

## Opener

The Nuki Opener is exposed as a lock in HomeKit with support for:
- Unlock
- Status for Low Battery

Optionally, the following switches are exposed:
- Ring-to-open (on/off)
- Continuous Mode (on/off)

The plugin is optimized for usage of the Home app in iOS 13, i.e. a separate accessory is exposed for RTO and continuous mode switches.

## Installation

Install the plugin via npm:

```bash
npm install homebridge-nuki -g
```

## Prepare Bridge

You have to enable the HTTP API on the Nuki Bridge:
* Open the Nuki app
* Open the menu and go to "Manage my devices" and choose the Bridge
* Click on "Manage bridge" and follow the instructions (press the button on the bridge for at least 10 seconds)
* After the bridge management interface is loaded, click on the bridge icon and enable the switch for "HTTP API"
* The IP address, port and API token are shown (you need them for the configuration of the plugin)

## Find Nuki IDs of the devices

Start homebridge with the plugin installed, however, do not provide any devices in the `devices` array. The plugin will print out all devices with their name, type and corresponding `nukiId`.

## Configuration

```json
{
    "platforms": [
        {
            "platform": "NukiPlatform",
            "hostNameOrIpAddress": "<HOST-IP-OR-NAME>",
            "hostCallbackApiPort": 40506,
            "bridgeIpAddress": "<BRIDGE-IP-ADDRESS>",
            "bridgeApiPort": 8080,
            "bridgeApiToken": "<BRIDGE-API-TOKEN>",
            "bridgeRebootSwitch": false,
            "devices": [
                {
                    "nukiId": 0,
                    "isRingToOpenEnabled": false,
                    "isContinuousModeEnabled": false,
                    "unlatchFromLockedToUnlocked": false,
                    "unlatchFromUnlockedToUnlocked": false,
                    "unlatchLock": false,
                    "unlatchLockPreventUnlatchIfLocked": false
                }
            ]
        }
    ]
}
```

**hostNameOrIpAddress**: The IP address or host name of the device you run the plugin on. This information is required to register a callback for notifications.

**hostCallbackApiPort** (optional): The port that is opened on the device you runt the plugin on. Defaults to `40506`, please change this setting of the port is already in use.

**bridgeIpAddress**: The IP address of your Nuki Bridge.

**bridgeApiPort** (optional): The port on which the API runs on your Nuki Bridge. Defaults to `8080`, please change this setting if you use a different port on the Nuki Bridge for the API.

**bridgeApiToken**: The token for communication with the Bridge API. Can be configured in the Nuki App.

**bridgeRebootSwitch**: If set to true, the Nuki Bridge is exposed as a switch for rebooting.

**devices**: Array of all your Nuki devices that the plugin should expose.

**nukiId**: The ID of the device (provide as number, not as string).

**isRingToOpenEnabled**: If set to true, a switch is exposed for the ring-to-open function. (only for Opener)

**isContinuousModeEnabled**: If set to true, a switch is exposed for the continuous mode. (only for Opener)

**unlatchFromLockedToUnlocked**: If set to true, the door is unlatched when you switch from "locked" to "unlocked" in the Home app. If set to false, the door is just unlocked when you switch from "locked" to "unlocked" in the Home app. (only for SmartLock)

**unlatchFromUnlockedToUnlocked**: If set to true, the door is unlatched when you switch from "unlocked" to "unlocked" [1] in the Home app (this move is valid and works in the Home app, just hold down the switch, swipe it to "locked" and then "unlocked" without releasing your finger - do not release the finger until you reached the "unlocked" position again). If set to false, nothing is done when you switch from "unlocked" to "unlocked" in the Home app. [2] (only for SmartLock)

**unlatchLock**: If set to true, a second lock switch is exposed for unlatching the smart lock. (only for SmartLock)

**unlatchLockPreventUnlatchIfLocked**: If set to true, the second lock (**unlatchLock** has to be true) can only operate if the SmartLock is unlocked. (only for SmartLock)

_______________________________
[1] Also works with Siri, you can ask to unlock devices that are already unlocked.

[2] If you use this mode of operation, the separate `unlatchLock` is not really necessary. Use `unlatchFromLockedToUnlocked: true`, `unlatchFromUnlockedToUnlocked: true` and `unlatchLock: false` to mimic the HomeKit behavior of the lock.