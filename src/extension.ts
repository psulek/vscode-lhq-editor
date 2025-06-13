import * as vscode from 'vscode';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { initializeDebugMode, loadCultures } from './utils';
import { appContext } from './context';
//import { test1 } from './test1';

export async function activate(context: vscode.ExtensionContext) {
    appContext.init(context);

    initializeDebugMode(context.extensionMode);
    await loadCultures(context);

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