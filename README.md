# homebridge-nuki

This project is a homebridge plugin for Nuki devices.

The device information is loaded from the local Nuki Bridge, therefore you just have to specify an API token for communication with the Nuki Bridge.

The Nuki SmartLock is exposed as a lock in Homekit with support for:
- Lock/Unlock

The Nuki Opener is exposed as a lock in Homekit with support for:
- Lock/Unlock
- Notification when the bell rings (not yet supported by Bridge)

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
* Go back and click on the device icon that you want to use with the plugin
* Repeat this step for each device you want to use with the plugin

## Find Nuki IDs of the devices

Start homebridge with the plugin installed, however, do not provide any devices in the `devices` array. The plugin will print out all devices with their type and corresponding `nukiId`.

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
            "devices": [
                {
                    "nukiId": <DEVICE-ID>,
                    "isRingToOpenEnabled": false,
                    "isContinuousModeEnabled": false
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

**devices**: Array of all your Nuki devices that the plugin should expose.

**nukiId**: The ID of the device (provide as number, not as string).

**isRingToOpenEnabled**: If set to true, a switch is exposed for the ring-to-open function. (only for Opener)

**isContinuousModeEnabled**: If set to true, a switch is exposed for the continuous mode. (only for Opener)
