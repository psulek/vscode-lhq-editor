import * as vscode from 'vscode';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { initializeDebugMode } from './utils';

export function activate(context: vscode.ExtensionContext) {
    initializeDebugMode(context.extensionMode);

    const lhqTreeDataProvider = new LhqTreeDataProvider(context);
    vscode.window.registerTreeDataProvider('lhqTreeView', lhqTreeDataProvider);
	//vscode.commands.registerCommand('lhqTreeView.refresh', () => lhqTreeDataProvider.refresh());
    
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