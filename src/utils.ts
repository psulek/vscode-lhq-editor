import * as vscode from 'vscode';
import path from 'path';
import fse from 'fs-extra';
import type { FileInfo, ReadFileInfoOptions, ITreeElementPaths, ITreeElement, IRootModelElement, ICategoryLikeTreeElement, FormattingOptions } from '@lhq/lhq-generators';
import { AppError, fileUtils, isNullOrEmpty, ModelUtils, strCompare } from '@lhq/lhq-generators';

import { ILogger, LogType, VsCodeLogger } from './logger';
import { ConfirmBoxOptions, MatchForSubstringResult, MessageBoxOptions, NotificationBoxOptions } from './types';

import 'reflect-metadata';

let _logger: VsCodeLogger = null!;
let _isDebugMode = false;

const treePathSeparator = '/';

export function initializeDebugMode(ctx: vscode.ExtensionContext) {
    // TODO: remove this when the extension is stable
    // TODO:_isDebugMode = ctx.mode === vscode.ExtensionMode.Development;

    _logger = new VsCodeLogger(ctx);
    _isDebugMode = false;
    _logger.updateDebugMode(_isDebugMode);
    if (_isDebugMode) {
        _logger.log('extension', 'debug', 'LHQ Editor extension activated in Development mode.');
    } else {
        _logger.log('extension', 'info', 'LHQ Editor extension activated');
    }


}

export function getMessageBoxText(msg: string): string {
    // return `${messageBoxPrefix} ${msg}`;
    return msg;
}

export function logger(): ILogger {
    return _logger;
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

export function getElementFullPath(element: ITreeElement | ITreeElementPaths): string {
    return 'getParentPath' in element
        ? element.getParentPath(treePathSeparator, true)
        : element.paths.getParentPath(treePathSeparator, true);
}

export function createTreeElementPaths(parentPath: string, anySlash: boolean = false): ITreeElementPaths {
    if (anySlash) {
        parentPath = parentPath.replace(/\\/g, treePathSeparator);
    }

    return ModelUtils.createTreePaths(parentPath, treePathSeparator);
}

export function joinTreePaths(paths: string[]): string {
    return paths.join(treePathSeparator);
}

export function findCategoryByPaths(rootModel: IRootModelElement,
    elementPaths: ITreeElementPaths, deep: number): ICategoryLikeTreeElement | undefined {

    if (!rootModel || !elementPaths) {
        return undefined;
    }

    const paths = elementPaths.getPaths(true);
    if (paths.length === 0 || paths.length < deep) {
        return undefined;
    }

    let result: ICategoryLikeTreeElement | undefined;
    const pathParts = paths.slice(0, deep);
    if (pathParts.length > 1) {
        let parentCategory: ICategoryLikeTreeElement | undefined = undefined;

        for (const findByName of pathParts) {
            parentCategory = (parentCategory ?? rootModel).find(findByName, 'category');
            if (!parentCategory) {
                break;
            }
        }

        result = parentCategory;
    } else {
        result = rootModel.find(pathParts[0], 'category');
    }

    return result;
}

export type FileFilter = { [name: string]: string[] };

export type ShowFileDialogOptions = {
    filters?: FileFilter;
    title?: string;
    defaultUri?: vscode.Uri;
};

export async function showOpenFileDialog(label: string, dialogOptions?: ShowFileDialogOptions): Promise<vscode.Uri | undefined> {
    const options: vscode.OpenDialogOptions = {
        openLabel: label,
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        title: dialogOptions?.title,
        filters: dialogOptions?.filters ?? { 'All files': ['*'] },
        defaultUri: dialogOptions?.defaultUri
    };

    const fileUri = await vscode.window.showOpenDialog(options);
    return fileUri && fileUri[0] ? fileUri[0] : undefined;
}

export async function showSaveFileDialog(label: string, dialogOptions?: ShowFileDialogOptions): Promise<vscode.Uri | undefined> {
    const options: vscode.SaveDialogOptions = {
        title: label,
        filters: dialogOptions?.filters ?? { 'All files': ['*'] },
        defaultUri: dialogOptions?.defaultUri
    };

    return await vscode.window.showSaveDialog(options);
}

export async function showConfirmBox(message: string, detail?: string, options?: ConfirmBoxOptions): Promise<boolean | undefined> {
    const msg = getMessageBoxText(message);

    const addTologger = options?.logger ?? (options?.warn === true);

    if (addTologger) {
        const logType: LogType = options?.warn === true ? 'warn' : 'info';
        const logMsg = detail ? `${msg}\n${detail}` : msg;
        logger().log('', logType, logMsg);
    }

    const warn = options?.warn ?? false;
    const yes = options?.yesText ?? 'Yes';
    const no = options?.noText ?? 'No';
    const noHidden = options?.noHidden ?? false;
    const extraButtons = options?.extraButtons ?? [];

    const btns = noHidden ? [yes] : [yes, no];
    if (extraButtons.length > 0) {
        btns.push(...extraButtons);
    }

    const result = warn ?
        await vscode.window.showWarningMessage(msg, { modal: true, detail }, ...btns) :
        await vscode.window.showInformationMessage(msg, { modal: true, detail }, ...btns);

    return result === undefined ? undefined : result === yes;
}

export function showNotificationBox(type: 'warn' | 'info' | 'err', message: string, options?: NotificationBoxOptions): void {
    let msg = getMessageBoxText(message);

    const addTologger = options?.logger ?? true;

    if (addTologger) {
        const logType: LogType = type === 'err' ? 'error' : type === 'warn' ? 'warn' : 'info';
        logger().log('', logType, msg);
    }

    if (type === 'warn') {
        vscode.window.showWarningMessage(msg);
    } else if (type === 'err') {
        vscode.window.showErrorMessage(msg);
    } else {
        vscode.window.showInformationMessage(msg);
    }
}

export async function showMessageBox(type: 'warn' | 'info' | 'err', message: string, detail: string | undefined, options: MessageBoxOptions): Promise<string | undefined>;
export async function showMessageBox(type: 'warn' | 'info' | 'err', message: string, detail?: string): Promise<void>;
export async function showMessageBox(
    type: 'warn' | 'info' | 'err',
    message: string,
    detail?: string,
    options?: MessageBoxOptions
): Promise<string | undefined | void> {
    let msg = getMessageBoxText(message);

    const msgOptions: vscode.MessageOptions = {
        detail: detail,
        modal: true
    };

    const addTologger = options?.logger ?? true;

    if (addTologger === true) {
        const logType: LogType = type === 'err' ? 'error' : type === 'warn' ? 'warn' : 'info';
        const logMsg = detail ? `${msg}\n${detail}` : msg;
        logger().log('', logType, logMsg);
    }

    const buttons: string[] = [];
    if (options?.buttons && options.buttons.length > 0) {
        buttons.push(...options.buttons);
    } else {
        buttons.push('OK');
    }

    if (type === 'warn') {
        return await vscode.window.showWarningMessage(msg, msgOptions, ...buttons);
    } else if (type === 'err') {
        return await vscode.window.showErrorMessage(msg, msgOptions, ...buttons);
    }

    return await vscode.window.showInformationMessage(msg, msgOptions, ...buttons);
}

export function toPascalCasing(str: string): string {
    return str.substring(0, 1).toUpperCase() + str.substring(1);
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function isSubsetOfArray(sourceArr: string[], subsetArr: string[], ignoreCase: boolean = false): boolean {
    if (subsetArr.length === 0) {
        return false;
    }

    const maxLength = Math.min(sourceArr.length, subsetArr.length);

    for (let i = 0; i < maxLength; i++) {
        if (!strCompare(sourceArr[i], subsetArr[i], ignoreCase)) {
            return false;
        }
    }

    return true;
}

export function isCategoryLikeTreeElement(element: ITreeElement | undefined): element is ICategoryLikeTreeElement {
    if (!element) {
        return false;
    }
    return element.elementType === 'category' || element.elementType === 'model';
}

export function findChildsByPaths(root: IRootModelElement, elementPaths: ITreeElementPaths): Array<{
    element: ITreeElement, match: MatchForSubstringResult, leaf: boolean
}> {
    const paths = elementPaths.getPaths(true);
    if (paths.length === 0) {
        return [];
    }

    const result: Array<{ element: ITreeElement, match: MatchForSubstringResult, leaf: boolean }> = [];
    let currentElement: ITreeElement | undefined = root;
    let path = paths.shift() ?? '';
    let isLast = paths.length === 0;

    while (!isNullOrEmpty(path)) {
        if (!isCategoryLikeTreeElement(currentElement)) {
            break;
        }

        if (isLast) {
            const categs = currentElement.categories.map(x => ({ element: x, match: matchForSubstring(x.name, path, true), leaf: true }))
                .filter(x => x.match.match !== 'none');
            result.push(...categs);

            const res = currentElement.resources.map(x => ({ element: x, match: matchForSubstring(x.name, path, true), leaf: true }))
                .filter(x => x.match.match !== 'none');
            result.push(...res);
        } else {
            currentElement = currentElement.getCategory(path);
        }

        path = paths.shift() ?? '';
        isLast = paths.length === 0;
    }

    return result;
}


export function matchForSubstring(value: string, searchString: string, ignoreCase: boolean = false): MatchForSubstringResult {
    if (isNullOrEmpty(value) || isNullOrEmpty(searchString)) {
        return { match: 'none' };
    }

    const result: MatchForSubstringResult = {
        match: strCompare(value, searchString, ignoreCase) ? 'equal' : 'none',
    };

    if (result.match === 'none') {
        if (ignoreCase) {
            value = value.toLowerCase();
            searchString = searchString.toLowerCase();
        }

        result.match = value.includes(searchString) ? 'contains' : 'none';
    }

    if (result.match !== 'none') {
        if (result.match === 'equal' && ignoreCase) {
            value = value.toLowerCase();
            searchString = searchString.toLowerCase();
        }

        const startIndex = value.indexOf(searchString);
        if (startIndex > -1) {
            result.highlights ??= [];
            result.highlights.push([startIndex, startIndex + searchString.length]);
        }
    }

    return result;
}

export function generateNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}


export const DefaultFormattingOptions: FormattingOptions = {
    indentation: { amount: 2, type: 'space', indent: '  ' },
    eol: '\n'
};

export function getGeneratorAppErrorMessage(err: Error): string {
    return err instanceof AppError ? err.message : '';
}