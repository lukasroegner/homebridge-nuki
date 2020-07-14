# homebridge-nuki

This project is a homebridge plugin for Nuki devices.

The device information is loaded from the local Nuki Bridge, therefore you just have to specify an API token for communication with the Nuki Bridge.

## Bridge

The Nuki Bridge is exposed as a switch for rebooting (optional).

## SmartLock

The Nuki SmartLock is exposed as a lock in HomeKit with support for:
- Lock/Unlock/Unlatch
- Door State
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
                    "isDoorSensorEnabled": false,
                    "isRingToOpenEnabled": false,
                    "isContinuousModeEnabled": false,
                    "isSingleAccessoryModeEnabled": false,
                    "unlatchFromLockedToUnlocked": false,
                    "unlatchFromUnlockedToUnlocked": false,
                    "lockFromLockedToLocked": false,
                    "unlatchLock": false,
                    "unlatchLockPreventUnlatchIfLocked": false,
                    "defaultLockName": "Lock",
                    "defaultLatchName": "Latch"
                }
            ],
            "isApiEnabled": false,
            "apiPort": 40011,
            "apiToken": "<YOUR-TOKEN>"
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

**isDoorSensorEnabled**: If set to true, a contact snesor is exposed for the door state. (only for SmartLock)

**isRingToOpenEnabled**: If set to true, a switch is exposed for the ring-to-open function. (only for Opener)

**isContinuousModeEnabled**: If set to true, a switch is exposed for the continuous mode. (only for Opener)

**isSingleAccessoryModeEnabled**: By default, the ring-to-open and continuous mode switches are placed in a separate accessory (Opener only, works best in the Apple Home app), and the lock and door sensor are also played in a separate accessory (SmartLock only). If this value is set to true, those services are all exposed in a single accessory.

**unlatchFromLockedToUnlocked**: If set to true, the door is unlatched when you switch from "locked" to "unlocked" in the Home app. If set to false, the door is just unlocked when you switch from "locked" to "unlocked" in the Home app. (only for SmartLock)

**unlatchFromUnlockedToUnlocked**: If set to true, the door is unlatched when you switch from "unlocked" to "unlocked" [1] in the Home app (this move is valid and works in the Home app, just hold down the switch, swipe it to "locked" and then "unlocked" without releasing your finger - do not release the finger until you reached the "unlocked" position again). If set to false, nothing is done when you switch from "unlocked" to "unlocked" in the Home app. [2] (only for SmartLock)

**lockFromLockedToLocked**: If set to true, the door can be locked again if the lock is already locked (e.g. 360 degree to 720 degree). (only for SmartLock)

**unlatchLock**: If set to true, a second lock switch is exposed for unlatching the smart lock. (only for SmartLock)

**unlatchLockPreventUnlatchIfLocked**: If set to true, the second lock (**unlatchLock** has to be true) can only operate if the SmartLock is unlocked. (only for SmartLock)

**defaultLockName** (optional): Lets you customize the name of the lock mechanism. Useful for the Alexa plugin, which does not detect changes of service names in HomeKit. Defaults to `Lock`. (only for SmartLock)

**defaultLatchName** (optional): Lets you customize the name of the unlatch mechanism. Useful for the Alexa plugin, which does not detect changes of service names in HomeKit. Defaults to `Latch`. (only for SmartLock)

**isApiEnabled** (optional): Enables an HTTP API for controlling devices. Defaults to `false`. See **API** for more information.

**apiPort** (optional): The port that the API (if enabled) runs on. Defaults to `40011`, please change this setting of the port is already in use.

**apiToken** (optional): The token that has to be included in each request of the API. Is required if the API is enabled and has no default value.

## API

This plugin also provides an HTTP API to control some features of the Nuki devices. It has been created so that you can further automate the system with HomeKit shortcuts. Starting with iOS 13, you can use shortcuts for HomeKit automation. Those automations that are executed on the HomeKit coordinator (i.e. iPad, AppleTV or HomePod) also support HTTP requests, which means you can lock your Nuki devices (e.g. when leaving home) without the security question. WARNING: This plugin only exposes the lock action as an API action, as the unlock action could potentially open your door if you made mistakes in the shortcuts.

If the API is enabled, it can be reached at the specified port on the host of this plugin. 
```
http://<YOUR-HOST-IP-ADDRESS>:<apiPort>
```

The token has to be specified as value of the `Authorization` header on each request:
```
Authorization: <YOUR-TOKEN>
```

### API - Get values of device

Use the `devices/<NUKI-ID>/<PROPERTY-NAME>` endpoint to retrieve a single value of a device. The HTTP method has to be `GET`:
```
http://<YOUR-HOST-IP-ADDRESS>:<apiPort>/devices/<NUKI-ID>/<PROPERTY-NAME>
```

The response is a plain text response (easier to handle in HomeKit shortcuts), the following property names are supported:

* **state** The lock state of the device (possible values: `locked`, `unlocked`, `unlatched`, `jammed`)

Use the `devices/<NUKI-ID>` endpoint to retrieve all values of a device. The HTTP method has to be `GET`:
```
http://<YOUR-HOST-IP-ADDRESS>:<apiPort>/devices/<NUKI-ID>
```

The response is a JSON object containing all values:
```
{
    "state": "locked"
}
```

### API - Set values of device

Use the `devices/<NUKI-ID>` endpoint to set values of a device. The HTTP method has to be `POST`:
```
http://<YOUR-HOST-IP-ADDRESS>:<apiPort>/devices/<NUKI-ID>
```

The body of the request has to be JSON containing the new values:
```
{
    "<PROPERTY-NAME>": <VALUE>
}
```

The following property names are supported:

* **state** The lock state (possible values: `locked` to lock the door)

_______________________________
[1] Also works with Siri, you can ask to unlock devices that are already unlocked.

[2] If you use this mode of operation, the separate `unlatchLock` is not really necessary. Use `unlatchFromLockedToUnlocked: true`, `unlatchFromUnlockedToUnlocked: true` and `unlatchLock: false` to mimic the HomeKit behavior of the lock.