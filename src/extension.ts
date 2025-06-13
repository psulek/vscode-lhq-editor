import * as vscode from 'vscode';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { initializeDebugMode, loadCultures, logger } from './utils';
import { updateLanguageVisibility } from './elements';
//import { test1 } from './test1';

export async function activate(context: vscode.ExtensionContext) {

    initializeDebugMode(context.extensionMode);
    await loadCultures(context);
    updateLanguageVisibility(true);

            //const wasLanguagesVisible = context.globalState.get<boolean>('languagesVisible', false);
        // context.globalState.update('languagesVisible', visible);


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