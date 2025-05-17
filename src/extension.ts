import * as vscode from 'vscode';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { initializeDebugMode } from './utils';
import { test1 } from './test1';

export function activate(context: vscode.ExtensionContext) {
    initializeDebugMode(context.extensionMode);

    console.log('Congratulations, your extension "lhq-editor-extension" is now active!');

    const lhqTreeDataProvider = new LhqTreeDataProvider(context);

    const lhqEditorProvider = new LhqEditorProvider(context, lhqTreeDataProvider);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(LhqEditorProvider.viewType, lhqEditorProvider, {
            webviewOptions: {
                retainContextWhenHidden: true,
            },
            supportsMultipleEditorsPerDocument: false,
        })
    );
}

export function deactivate() { }