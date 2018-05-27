/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as util from './common';
import * as vscode from 'vscode';
import { PlatformInformation } from './platform';
import { DownloadAndInstallPackages } from './packageManager/PackageManager';
import { Package } from './packageManager/Package';
import { NetworkSettingsProvider } from './NetworkSettings';
import { ResolveFilePaths } from './packageManager/PackageFilePathResolver';

/*
 * Class used to download the runtime dependencies of the C# Extension
 */
export class ElectronExtDownloader {

    public constructor(
        private networkSettingsProvider: NetworkSettingsProvider,
        private packageJSON: any,
        private platformInfo: PlatformInformation) {
    }

    public async installRuntimeDependencies(): Promise<boolean> {
        let installationStage = 'touchBeginFile';

        try {
            vscode.window.showInformationMessage('Downloading Electron...');
            let message = vscode.window.setStatusBarMessage('Downloading Electron...');
            await util.touchInstallFile(util.InstallFileType.Begin);
            // Display platform information and RID
            // this.eventStream.post(new LogPlatformInfo(this.platformInfo));
            let runTimeDependencies = GetRunTimeDependenciesPackages(this.packageJSON);
            runTimeDependencies.forEach(pkg => ResolveFilePaths(pkg));
            installationStage = 'downloadAndInstallPackages';
            await DownloadAndInstallPackages(runTimeDependencies, this.networkSettingsProvider, this.platformInfo);
            installationStage = 'touchLockFile';
            await util.touchInstallFile(util.InstallFileType.Lock);
            message.dispose();
            return true;
        } catch (error) {
            return false;
        }
        finally {
            try {
                util.deleteInstallFile(util.InstallFileType.Begin);
            } catch (error) { }
        }
    }
}

export function GetRunTimeDependenciesPackages(packageJSON: any): Package[] {
    if (packageJSON.runtimeDependencies) {
        return JSON.parse(JSON.stringify(<Package[]>packageJSON.runtimeDependencies));
    }

    throw new Error('No runtime dependencies found');
}