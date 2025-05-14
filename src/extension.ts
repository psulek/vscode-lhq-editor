import * as vscode from 'vscode';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { initializeDebugMode } from './utils';

export function activate(context: vscode.ExtensionContext) {
    initializeDebugMode(context.extensionMode);

    console.log('Congratulations, your extension "lhq-editor-extension" is now active!');

    const lhqTreeDataProvider = new LhqTreeDataProvider(context);
    vscode.window.registerTreeDataProvider('lhqTreeView', lhqTreeDataProvider);
	//vscode.commands.registerCommand('lhqTreeView.refresh', () => lhqTreeDataProvider.refresh());
    
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('lhqTreeView.addItem', () => {
    //         // Placeholder for add item logic
    //         vscode.window.showInformationMessage('Add item clicked!');
    //     })
    // );

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