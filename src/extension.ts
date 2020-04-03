/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { join } from 'path';

import { ElectronExtDownloader } from './ElectronExtDownloader';
import ElectronExtensionExports from './ElectronExtensionExports';
import { PlatformInformation } from './platform';
import { vscodeNetworkSettingsProvider, NetworkSettingsProvider } from './NetworkSettings';
import * as util from './common';

import * as vscode from 'vscode';
import * as Core from 'vscode-chrome-debug-core';
import * as nls from 'vscode-nls';
import * as path from 'path';

import { defaultTargetFilter, getTargetFilter } from './utils';

const localize = nls.loadMessageBundle();

const DEBUG_SETTINGS = 'debug.chrome';
const USE_V3_SETTING = 'useV3';

export async function activate(context: vscode.ExtensionContext) {
    const extensionId = 'kodetech.electron-debug';
    const extension = vscode.extensions.getExtension<ElectronExtensionExports>(extensionId);
    util.setExtensionPath(extension.extensionPath);

    let platformInfo: PlatformInformation;
    try {
        platformInfo = await PlatformInformation.GetCurrent();
    } catch (error) {
        // eventStream.post(new ActivationFailure());
    }

    let networkSettingsProvider = vscodeNetworkSettingsProvider(vscode as any);

    if (!vscode.env.appName.includes('Kode')) {
        await ensureRuntimeDependencies(extension, platformInfo, networkSettingsProvider);
    }

    context.subscriptions.push(vscode.commands.registerCommand('extension.electron-debug.toggleSkippingFile', toggleSkippingFile));
    context.subscriptions.push(vscode.commands.registerCommand('extension.electron-debug.toggleSmartStep', toggleSmartStep));

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('electron', new ChromeConfigurationProvider()));
}

export function deactivate() {
}

const DEFAULT_CONFIG = {
    type: 'electron',
    request: 'launch',
    name: localize('chrome.launch.name', 'Launch Electron against the workspace'),
    appDir: '${workspaceFolder}'
};

export class ChromeConfigurationProvider implements vscode.DebugConfigurationProvider {
    provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return Promise.resolve([DEFAULT_CONFIG]);
    }

    /**
     * Try to add all missing attributes to the debug configuration being launched.
     */
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration> {
        // if launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            // Return null so it will create a launch.json and fall back on provideDebugConfigurations - better to point the user towards the config
            // than try to work automagically.
            return null;
        }

        if (config.request === 'attach') {
            const discovery = new Core.chromeTargetDiscoveryStrategy.ChromeTargetDiscovery(
                new Core.NullLogger(), new Core.telemetry.NullTelemetryReporter());

            let targets;
            try {
                targets = await discovery.getAllTargets(config.address || '127.0.0.1', config.port, config.targetTypes === undefined ? defaultTargetFilter : getTargetFilter(config.targetTypes), config.url || config.urlFilter);
            } catch (e) {
                // Target not running?
            }

            if (targets && targets.length > 1) {
                const selectedTarget = await pickTarget(targets);
                if (!selectedTarget) {
                    // Quickpick canceled, bail
                    return null;
                }

                config.websocketUrl = selectedTarget.websocketDebuggerUrl;
            }
        }

        resolveRemoteUris(folder, config);

        const useV3 = !!vscode.workspace.getConfiguration(DEBUG_SETTINGS).get(USE_V3_SETTING)
            || vscode.workspace.getConfiguration().get('debug.javascript.usePreview', false);

        if (useV3) {
            config['__workspaceFolder'] = '${workspaceFolder}';
            config.type = 'pwa-chrome';
        }

        if (vscode.env.appName.includes('Kode')) {
            let exec = process.execPath;
            if (exec.indexOf('Kode Studio Helper') >= 0) {
                const dir = exec.substring(0, exec.lastIndexOf('/'));
                exec = join(dir, '..', '..', '..', '..', 'MacOS', 'Electron');
            }
            config.electronPath = exec;
        } else {
            const electronDir = join(vscode.extensions.getExtension('kodetech.electron-debug').extensionPath, '.electron', '7.1.9');
            if (process.platform === 'darwin') {
                config.electronPath = join(electronDir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
            } else if (process.platform === 'win32') {
                config.electronPath = join(electronDir, 'electron.exe');
            } else {
                config.electronPath = join(electronDir, 'electron');
            }
        }
        return config;
    }
}

// Must match the strings in -core's remoteMapper.ts
const remoteUriScheme = 'vscode-remote';
const remotePathComponent = '__vscode-remote-uri__';

const isWindows = process.platform === 'win32';
function getFsPath(uri: vscode.Uri): string {
    const fsPath = uri.fsPath;
    return isWindows && !fsPath.match(/^[a-zA-Z]:/) ?
        fsPath.replace(/\\/g, '/') : // Hack - undo the slash normalization that URI does when windows is the current platform
        fsPath;
}

function mapRemoteClientUriToInternalPath(remoteUri: vscode.Uri): string {
    const uriPath = getFsPath(remoteUri);
    const driveLetterMatch = uriPath.match(/^[A-Za-z]:/);
    let internalPath: string;
    if (!!driveLetterMatch) {
        internalPath = path.win32.join(driveLetterMatch[0], remotePathComponent, uriPath.substr(2));
    } else {
        internalPath = path.posix.join('/', remotePathComponent, uriPath);
    }

    return internalPath;
}

function rewriteWorkspaceRoot(configObject: any, internalWorkspaceRootPath: string): void {
    for (const key in configObject) {
        if (typeof configObject[key] === 'string') {
            configObject[key] = configObject[key].replace(/\$\{workspace(Root|Folder)\}/g, internalWorkspaceRootPath);
        } else {
            rewriteWorkspaceRoot(configObject[key], internalWorkspaceRootPath);
        }
    }
}

function resolveRemoteUris(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): void {
    if (folder && folder.uri.scheme === remoteUriScheme) {
        const internalPath = mapRemoteClientUriToInternalPath(folder.uri);
        rewriteWorkspaceRoot(config, internalPath);
        (<any>config).remoteAuthority = folder.uri.authority;
    }
}

function toggleSkippingFile(aPath: string): void {
    if (!aPath) {
        const activeEditor = vscode.window.activeTextEditor;
        aPath = activeEditor && activeEditor.document.fileName;
    }

    if (aPath && vscode.debug.activeDebugSession) {
        const args: Core.IToggleSkipFileStatusArgs = typeof aPath === 'string' ? { path: aPath } : { sourceReference: aPath };
        vscode.debug.activeDebugSession.customRequest('toggleSkipFileStatus', args);
    }
}

function toggleSmartStep(): void {
    if (vscode.debug.activeDebugSession) {
        vscode.debug.activeDebugSession.customRequest('toggleSmartStep');
    }
}

interface ITargetQuickPickItem extends vscode.QuickPickItem {
    websocketDebuggerUrl: string;
}

async function pickTarget(targets: Core.chromeConnection.ITarget[]): Promise<ITargetQuickPickItem> {
    const items = targets.map(target => (<ITargetQuickPickItem>{
        label: unescapeTargetTitle(target.title),
        detail: target.url,
        websocketDebuggerUrl: target.webSocketDebuggerUrl
    }));

    const placeHolder = localize('chrome.targets.placeholder', 'Select a tab');
    const selected = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true, matchOnDetail: true });
    return selected;
}

function unescapeTargetTitle(title: string): string {
    return title
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, `'`)
        .replace(/&quot;/g, '"');
}

async function ensureRuntimeDependencies(extension: vscode.Extension<ElectronExtensionExports>, platformInfo: PlatformInformation, networkSettingsProvider: NetworkSettingsProvider): Promise<boolean> {
    return util.installFileExists(util.InstallFileType.Lock)
        .then(exists => {
            if (!exists) {
                const downloader = new ElectronExtDownloader(networkSettingsProvider, extension.packageJSON, platformInfo);
                return downloader.installRuntimeDependencies();
            } else {
                return true;
            }
        });
}
