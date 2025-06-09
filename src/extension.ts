import * as vscode from 'vscode';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { initializeDebugMode, logger } from './utils';
//import { test1 } from './test1';

export function activate(context: vscode.ExtensionContext) {
    // Due to the bug in the upstream https://github.com/microsoft/vscode/issues/214787 it is not possible to show
    // several sequential popups. To prevent popup disappear it needs to add a small delay between two popups.
    // Keep the original functions
    const _showQuickPick = vscode.window.showQuickPick;
    const _showInputBox = vscode.window.showInputBox;

    // Replace with functions with a small delay 
    // Object.assign(vscode.window, {
    //     // @ts-ignore
    //     showQuickPick: async (items, options, token) => {
    //         const result = await _showQuickPick(items, options, token);
    //         await new Promise(resolve => setTimeout(resolve, 300));
    //         return result;
    //     },

    //     // @ts-ignore
    //     showInputBox: async (options, token) => {
    //         const result = await _showInputBox(options, token);
    //         await new Promise(resolve => setTimeout(resolve, 300));
    //         return result;
    //     }
    // });

    initializeDebugMode(context.extensionMode);

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