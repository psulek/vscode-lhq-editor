import * as vscode from 'vscode';
import { ILogger, VsCodeLogger } from './logger';

const isEditorActiveContextKey = 'lhqEditorIsActive';

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