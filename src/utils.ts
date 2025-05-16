import * as vscode from 'vscode';
import path from 'path';
import fse from 'fs-extra';
import { FileInfo, fileUtils, ITreeElement, ReadFileInfoOptions, generatorUtils, ITreeElementPaths } from '@lhq/lhq-generators';

import { ILogger, VsCodeLogger } from './logger';

const isEditorActiveContextKey = 'lhqEditorIsActive';
const messageBoxPrefix = '[LHQ Editor]';

let _isEditorActive = false;
let _logger: VsCodeLogger = new VsCodeLogger();

let _isDebugMode = false; // Default to false

export function initializeDebugMode(mode: vscode.ExtensionMode) {
    _isDebugMode = mode === vscode.ExtensionMode.Development;
    _logger.updateDebugMode(_isDebugMode);
    if (_isDebugMode) {
        _logger.log('debug', 'Extension is running in Development mode.');
    }
}

export function logger(): ILogger {
    return _logger;
}

export function isEditorActive(): boolean {
    return _isEditorActive;
}

export function setEditorActive(active: boolean) {
    if (_isEditorActive !== active) {
        _isEditorActive = active;
        _logger.log('debug', `called setEditorActive(${active})`);
        vscode.commands.executeCommand('setContext', isEditorActiveContextKey, active);
    }
}

export function isValidDocument(document: vscode.TextDocument | null | undefined): document is vscode.TextDocument {
    return !!document && document.uri.scheme === 'file' && document.fileName.endsWith('.lhq');
}

export async function safeReadFile(fileName: string): Promise<string> {
    return fileUtils.safeReadFile(fileName, fse.pathExists, fse.readFile);
}

export async function readFileInfo(inputPath: string, options?: ReadFileInfoOptions): Promise<FileInfo> {
    return fileUtils.readFileInfo(inputPath, path, fse.pathExists, fse.readFile, options);
}

export function getElementFullPath(element: ITreeElement): string {
    return element.paths.getParentPath('/', true);
}

export function createTreeElementPaths(parentPath: string): ITreeElementPaths {
    return generatorUtils.createTreeElementPaths(parentPath, '/');
}

export function showMessageBox<T extends string>(type: 'warn' | 'info' | 'err', message: string, 
    options?: vscode.MessageOptions, ...items: T[]): Thenable<T | undefined> {
    const msg = `${messageBoxPrefix} ${message}`;

    options = options ?? {};

    if (type === 'warn') {
        return vscode.window.showWarningMessage(msg, options, ...items);
    } else if (type === 'err') {
        return vscode.window.showErrorMessage(msg, options, ...items);
    } else {
        return vscode.window.showInformationMessage(msg, options, ...items);
    }
}

export function toPascalCasing(str: string): string {
    return str.substring(0, 1).toUpperCase() + str.substring(1);
}