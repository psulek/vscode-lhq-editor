import * as vscode from 'vscode';
import path from 'path';
import fse from 'fs-extra';
import type { FileInfo, ReadFileInfoOptions, ITreeElementPaths, ITreeElement, IRootModelElement, ICategoryLikeTreeElement } from '@lhq/lhq-generators';
import { fileUtils, isNullOrEmpty, ModelUtils, strCompare } from '@lhq/lhq-generators';

import { ILogger, VsCodeLogger } from './logger';
import { CultureInfo, CulturesMap, MatchForSubstringResult } from '../shared/types';

const messageBoxPrefix = '[LHQ Editor]';

let _logger: VsCodeLogger = new VsCodeLogger();
let _cultures: CulturesMap = {};

let _isDebugMode = false; // Default to false

export function initializeDebugMode(mode: vscode.ExtensionMode) {
    _isDebugMode = mode === vscode.ExtensionMode.Development;
    _logger.updateDebugMode(_isDebugMode);
    if (_isDebugMode) {
        _logger.log('debug', 'LHQ Editor extension activated in Development mode.');
    } else {
        _logger.log('info', 'LHQ Editor extension activated');
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

export function getElementFullPath(element: ITreeElement): string {
    return element.paths.getParentPath('/', true);
}

export function createTreeElementPaths(parentPath: string, anySlash: boolean = false): ITreeElementPaths {
    if (anySlash) {
        parentPath = parentPath.replace(/\\/g, '/');
    }

    return ModelUtils.createTreePaths(parentPath, '/');
}

export async function showConfirmBox(message: string, detail?: string, warn?: boolean): Promise<boolean> {
    const msg = getMessageBoxText(message);
    warn = warn ?? false;
    return (warn ?
        await vscode.window.showWarningMessage(msg, { modal: true, detail }, 'Yes', 'No') :
        await vscode.window.showInformationMessage(msg, { modal: true, detail }, 'Yes', 'No')) 
        === 'Yes';
}


export async function showMessageBox(type: 'warn' | 'info' | 'err', message: string, options?: vscode.MessageOptions): Promise<void> {
    const msg = getMessageBoxText(message);

    if (type === 'err' && isNullOrEmpty(options)) {
        options = { modal: true };
    }

    options = options ?? {};

    if (type === 'warn') {
        await vscode.window.showWarningMessage(msg, options);
    } else if (type === 'err') {
        await vscode.window.showErrorMessage(msg, options);
    } else {
        await vscode.window.showInformationMessage(msg, options);
    }
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

// export function sequentialEquals(arr1: string[], arr2: string[], ignoreCase: boolean = false, maxLength?: number): boolean {
//     const arr1Length = Math.max(0, Math.min(maxLength ?? 0, arr1.length));
//     const arr2Length = Math.max(0, Math.min(maxLength ?? 0, arr2.length));

//     if (arr1Length !== arr2Length) {
//         return false;
//     }

//     for (let i = 0; i < arr1Length; i++) {
//         if (!strCompare(arr1[i], arr2[i], ignoreCase)) {
//             return false;
//         }
//     }

//     return true;
// }


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
            // if (currentElement) {
            //     result.push({
            //         element: currentElement, match: { match: 'equal' }, leaf: false
            //     });
            // }
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
        // if (result.match !== 'none') {
        //     const startIndex = value.indexOf(searchString);
        //     if (startIndex > -1) {
        //         result.highlights ??= [];
        //         result.highlights.push([startIndex, startIndex + searchString.length]);
        //     }
        // }
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

export async function loadCultures(context?: vscode.ExtensionContext): Promise<CulturesMap> {
    if (Object.keys(_cultures).length === 0) {
        if (context === undefined) {
            await showMessageBox('err', 'Failed to load list of cultures. Context is undefined. Please report this issue.');
            return {};
        }
        const culturesFileUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cultures.json');
        try {
            const rawContent = await vscode.workspace.fs.readFile(culturesFileUri);
            const contentString = new TextDecoder().decode(rawContent);
            const items = JSON.parse(contentString) as CultureInfo[];
            for (const culture of items) {
                _cultures[culture.name] = culture;
            }

        } catch (error) {
            logger().log('error', 'Failed to read or parse dist/cultures.json');
            await showMessageBox('err', 'Failed to load list of cultures. Please reinstall the extension or report this issue.');
        }
    }

    return _cultures;
}

export function findCulture(name: string): CultureInfo | undefined {
    if (isNullOrEmpty(name)) {
        return undefined;
    }
    return _cultures[name];
}

export function getCultureDesc(name: string): string {
    const culture = findCulture(name);
    return culture ? `${culture?.engName ?? ''} (${culture?.name ?? ''})` : name;
}