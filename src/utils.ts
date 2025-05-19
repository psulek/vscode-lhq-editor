import * as vscode from 'vscode';
import path from 'path';
import fse from 'fs-extra';
import type { FileInfo, ReadFileInfoOptions, ITreeElementPaths, ITreeElement } from '@lhq/lhq-generators';
import { fileUtils, generatorUtils, isNullOrEmpty, detectLineEndings, getLineEndingsRaw, ModelSerializer } from '@lhq/lhq-generators';

import {
    modify as jsonModify, parseTree, type EditResult, type FormattingOptions, type ParseError, type JSONPath
} from 'jsonc-parser';

// @ts-ignore
import detectIndent from 'detect-indent';

import { ILogger, VsCodeLogger } from './logger';

export type IdentationType = ReturnType<typeof detectIndent>;


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
    return ModelSerializer.createTreePaths(parentPath, '/');
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

function getElementJsonPathInModel(element: ITreeElement | undefined): JSONPath {
    if (element === undefined) {
        return [];
    }

    const elementType = element.elementType;
    if (elementType === 'model') {
        return ['model'];
    }

    const paths = element.paths.getPaths(false);
    const lastPath = paths.pop() ?? '';
    const result: string[] = [];

    if (!isNullOrEmpty(lastPath)) {
        paths.every(p => result.push(...[`categories`, p]));
        result.push(...[elementType === 'resource' ? 'resources' : 'categories', lastPath]);
    }

    return result;
}

export function renameJsonProperty(treeElement: ITreeElement, newPropertyName: string,
    jsonText: string, indentation: IdentationType): EditResult | undefined {
    const errs: ParseError[] = [];
    const tree = parseTree(jsonText, errs, { allowEmptyContent: true, allowTrailingComma: true });

    if (tree && errs?.length === 0) {
        const query = getElementJsonPathInModel(treeElement);
        indentation = indentation ?? detectIndent(jsonText);

        const le = detectLineEndings(jsonText, undefined);
        const eol = le ? getLineEndingsRaw(le) : undefined;
        const formattingOptions = {
            insertSpaces: (indentation.type ?? 'space') === 'space',
            tabSize: indentation.amount,
            keepLines: true,
            eol
        } as unknown as FormattingOptions;

        return jsonModify(jsonText, query, undefined, { formattingOptions, newPropertyName } as any);
    }

    if (errs?.length > 0) {
        throw new Error('Parsing model failed: ' + errs.map(e => e.error).join(', '));
    }

    return undefined;
}

export function moveJsonProperty(sourceElement: ITreeElement, targetElement: ITreeElement,
    jsonText: string, indentation: IdentationType): EditResult | undefined {
    const errs: ParseError[] = [];
    const tree = parseTree(jsonText, errs, { allowEmptyContent: true, allowTrailingComma: true });

    if (tree && errs?.length === 0) {
        indentation = indentation ?? detectIndent(jsonText);

        const le = detectLineEndings(jsonText, undefined);
        const eol = le ? getLineEndingsRaw(le) : undefined;
        const formattingOptions = {
            insertSpaces: (indentation.type ?? 'space') === 'space',
            tabSize: indentation.amount,
            keepLines: true,
            eol
        } as unknown as FormattingOptions;

        // remove property from its parent
        const sourceQuery = getElementJsonPathInModel(sourceElement);
        return jsonModify(jsonText, sourceQuery, undefined, { formattingOptions } as any);
    }

    if (errs?.length > 0) {
        throw new Error('Parsing model failed: ' + errs.map(e => e.error).join(', '));
    }

    return undefined;
}