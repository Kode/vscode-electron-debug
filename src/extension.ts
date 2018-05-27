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

import { targetFilter } from './utils';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

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

    let runtimeDependenciesExist = await ensureRuntimeDependencies(extension, platformInfo, networkSettingsProvider);

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
                targets = await discovery.getAllTargets(config.address || '127.0.0.1', config.port, targetFilter, config.url || config.urlFilter);
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

        config.electronDir = join(vscode.extensions.getExtension('kodetech.electron-debug').extensionPath, '.electron', '2.0.2');
        return config;
    }
}

function toggleSkippingFile(path: string): void {
    if (!path) {
        const activeEditor = vscode.window.activeTextEditor;
        path = activeEditor && activeEditor.document.fileName;
    }

    if (path && vscode.debug.activeDebugSession) {
        const args: Core.IToggleSkipFileStatusArgs = typeof path === 'string' ? { path } : { sourceReference: path };
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
