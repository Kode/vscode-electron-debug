# Electron debug extension

A VS Code extension to debug your JavaScript code in Electron.
This is a fork of vscode-chrome-debug which includes and runs Electron for Windows (x64), Linux (x64) and macOS. This extension does nothing that can not be done via vscode-chrome-debug and a proper launch configuration and exists purely for convenience.

See https://marketplace.visualstudio.com/items?itemName=msjsdiag.debugger-for-chrome for more detailed information.

## Launch
Two example `launch.json` configs with `"request": "launch"`. You can specify appDir to point to some Electron application, otherwise this defaults to the
project directory.
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "electron",
            "request": "launch",
            "name": "Launch this",
            "sourceMaps": true
        },
        {
            "type": "electron",
            "request": "launch",
            "name": "Launch something",
            "appDir": "/path/to/my/electron/app/",
            "sourceMaps": true
        }
    ]
}
```

## Release Notes

### 18.5.2

Initial public release
