/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import {utils as coreUtils, chromeConnection } from 'vscode-chrome-debug-core';

export function getElectronPath(dir: string): string {
    const platform = coreUtils.getPlatform();
    if (platform === coreUtils.Platform.OSX) {
        return path.join(dir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
    } else if (platform === coreUtils.Platform.Windows) {
        return path.join(dir, 'electron.exe');
    } else {
        return path.join(dir, 'electron');
    }
}

export class DebounceHelper {
    private waitToken: any; // TS can't decide whether Timer or number...

    constructor(private timeoutMs: number) { }

    /**
     * If not waiting already, call fn after the timeout
     */
    public wait(fn: () => any): void {
        if (!this.waitToken) {
            this.waitToken = setTimeout(() => {
                this.waitToken = null;
                fn();
            },
                this.timeoutMs);
        }
    }

    /**
     * If waiting for something, cancel it and call fn immediately
     */
    public doAndCancel(fn: () => any): void {
        if (this.waitToken) {
            clearTimeout(this.waitToken);
            this.waitToken = null;
        }

        fn();
    }
}

export const targetFilter: chromeConnection.ITargetFilter =
    target => target && (!target.type || target.type === 'page');
