import * as vscode from 'vscode';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';

export function activate(context: vscode.ExtensionContext) {
    const lhqTreeDataProvider = new LhqTreeDataProvider(context);
    vscode.window.registerTreeDataProvider('lhqTreeView', lhqTreeDataProvider);
	vscode.commands.registerCommand('lhqTreeView.refresh', () => lhqTreeDataProvider.refresh());
    
    const lhqEditorProvider = new LhqEditorProvider(context, lhqTreeDataProvider);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(LhqEditorProvider.viewType, lhqEditorProvider, {
            webviewOptions: {
                retainContextWhenHidden: true,
            },
            supportsMultipleEditorsPerDocument: false,
        })
    );

    // // Function to update context key, tree data, and focus the TreeView
    // const updateEditorStateAndTreeView = (editor: vscode.TextEditor | undefined) => {
    //     console.log('updateEditorStateAndTreeView called. Active editor:', editor?.document.fileName);
    //     const document = editor?.document;
    //     const lhqEditorEnabled = editor && document?.uri.scheme === 'file' && document.fileName.endsWith('.lhq');

    //     vscode.commands.executeCommand('setContext', 'lhqEditorEnabled', lhqEditorEnabled);

    //     if (lhqEditorEnabled) {
    //         lhqTreeDataProvider.updateDocument(document);
    //         setTimeout(() => {
    //             vscode.commands.executeCommand('workbench.actions.treeView.lhqTreeView.focus');
    //         }, 150);
    //     } else {
    //         lhqTreeDataProvider.updateDocument(null);
    //     }
    // };

    // // Initial check for the active editor when the extension activates
    // updateEditorStateAndTreeView(vscode.window.activeTextEditor);

    // // Listen for changes to the active text editor
    // context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
    //     updateEditorStateAndTreeView(editor);
    // }));
}

export function deactivate() { }
