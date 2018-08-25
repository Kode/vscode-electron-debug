/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as yauzl from 'yauzl';
import * as vscode from 'vscode';
import { NestedError } from '../NestedError';

async function InstallZipSymLinks(buffer: Buffer, destinationInstallPath: string, links: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipFile) => {
            if (err) {
                let message = 'Electron Extension was unable to download its dependencies. Please check your internet connection. If you use a proxy server, please visit https://aka.ms/VsCodeCsharpNetworking';
                return reject(new NestedError(message));
            }

            zipFile.readEntry();

            zipFile.on('entry', (entry: yauzl.Entry) => {
                let absoluteEntryPath = path.resolve(destinationInstallPath, entry.fileName);

                if (entry.fileName.endsWith('/')) {
                    // Directory - already created
                    zipFile.readEntry();
                } else {
                    // File - symlink it
                    zipFile.openReadStream(entry, (readerr, readStream) => {
                        if (readerr) {
                            return reject(new NestedError('Error reading zip stream', readerr));
                        }

                        // Prevent Electron from kicking in special behavior when opening a write-stream to a .asar file
                        let originalAbsoluteEntryPath = absoluteEntryPath;
                        if (absoluteEntryPath.endsWith('.asar')) {
                            absoluteEntryPath += '_';
                        }

                        if (links && links.indexOf(absoluteEntryPath) !== -1) {
                            readStream.setEncoding('utf8');
                            let body = '';
                            readStream.on('data', (chunk) => {
                                body += chunk;
                            });
                            readStream.on('end', () => {
                                // vscode.window.showInformationMessage('Linking ' + absoluteEntryPath + ' and ' + path.join(absoluteEntryPath, body));
                                fs.symlink(body, absoluteEntryPath, undefined, () => {
                                    zipFile.readEntry();
                                });
                            });
                        } else {
                            zipFile.readEntry();
                        }
                    });
                }
            });

            zipFile.on('end', () => {
                resolve();
            });

            zipFile.on('error', ziperr => {
                reject(new NestedError('Zip File Error:' + ziperr.code || '', ziperr));
            });
        });
    });
}

export async function InstallZip(buffer: Buffer, description: string, destinationInstallPath: string, binaries: string[], links: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipFile) => {
            if (err) {
                let message = 'Electron Extension was unable to download its dependencies. Please check your internet connection. If you use a proxy server, please visit https://aka.ms/VsCodeCsharpNetworking';
                return reject(new NestedError(message));
            }

            zipFile.readEntry();

            zipFile.on('entry', (entry: yauzl.Entry) => {
                let absoluteEntryPath = path.resolve(destinationInstallPath, entry.fileName);

                if (entry.fileName.endsWith('/')) {
                    // Directory - create it
                    mkdirp(absoluteEntryPath, { mode: 0o775 }, direrr => {
                        if (direrr) {
                            return reject(new NestedError('Error creating directory for zip directory entry:' + direrr.code || '', direrr));
                        }

                        zipFile.readEntry();
                    });
                } else {
                    // File - extract it
                    zipFile.openReadStream(entry, (readerr, readStream) => {
                        if (readerr) {
                            return reject(new NestedError('Error reading zip stream', readerr));
                        }

                        mkdirp(path.dirname(absoluteEntryPath), { mode: 0o775 }, direrr => {
                            if (direrr) {
                                return reject(new NestedError('Error creating directory for zip file entry', direrr));
                            }

                            // Make sure executable files have correct permissions when extracted
                            let fileMode = binaries && binaries.indexOf(absoluteEntryPath) !== -1
                                ? 0o755
                                : 0o664;

                            // Prevent Electron from kicking in special behavior when opening a write-stream to a .asar file
                            let originalAbsoluteEntryPath = absoluteEntryPath;
                            if (absoluteEntryPath.endsWith('.asar')) {
                                absoluteEntryPath += '_';
                            }

                            if (links && links.indexOf(absoluteEntryPath) !== -1) {
                                zipFile.readEntry();
                            } else {
                                readStream.pipe(fs.createWriteStream(absoluteEntryPath, { mode: fileMode }));
                                readStream.on('end', () => {
                                    if (absoluteEntryPath !== originalAbsoluteEntryPath) {
                                        fs.renameSync(absoluteEntryPath, originalAbsoluteEntryPath);
                                    }
                                    zipFile.readEntry();
                                });
                            }
                        });
                    });
                }
            });

            zipFile.on('end', () => {
                InstallZipSymLinks(buffer, destinationInstallPath, links).then(() => {
                    resolve();
                }, (errr) => {
                    reject(new NestedError('Error symlinking', errr));
                });
            });

            zipFile.on('error', ziperr => {
                reject(new NestedError('Zip File Error:' + ziperr.code || '', ziperr));
            });
        });
    });
}

