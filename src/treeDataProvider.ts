import * as vscode from 'vscode';
import { LhqTreeItem } from './treeItem';
import { isEditorActive, isValidDocument, logger, setEditorActive } from './utils';

export class LhqTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();

    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentData: any = null;
    private currentDocument: vscode.TextDocument | null = null;

    constructor(private context: vscode.ExtensionContext) {

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(e => this.onActiveEditorChanged(e)),
            vscode.window.onDidChangeVisibleTextEditors(e => this.onDidChangeVisibleTextEditors(e)),

            vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
            vscode.workspace.onDidOpenTextDocument(e => this.onDidOpenTextDocument(e))
        );

        this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }

    private onDidChangeVisibleTextEditors(e: readonly vscode.TextEditor[]): any {
        const editor = e.find(x => x.document.fileName === vscode.window.activeTextEditor?.document.fileName);
        if (editor) {
            logger().log('debug', `LhqTreeDataProvider.onDidChangeVisibleTextEditors: Active editor found: ${editor.document?.fileName ?? '-'}`);
        } else {
            logger().log('debug', "LhqTreeDataProvider.onDidChangeVisibleTextEditors: No active editor found");
        }
    }

    private onDidOpenTextDocument(e: vscode.TextDocument): any {
        logger().log('debug', `LhqTreeDataProvider.onDidOpenTextDocument: ${e?.fileName ?? '-'}`);
    }


    private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
        logger().log('debug', `LhqTreeDataProvider.onDocumentChanged: ${e.document?.fileName ?? '-'}`);
        this.updateDocument(e.document);
    }

    public onActiveEditorChanged(e: vscode.TextEditor | undefined): void {
        logger().log('debug', `LhqTreeDataProvider.onActiveEditorChanged: ${e?.document.fileName ?? '-'}`);
        this.updateDocument(e?.document);
    }

    public hasActiveDocument(): boolean {
        return this.currentDocument !== null && isEditorActive();
    }

    public isSameDocument(document: vscode.TextDocument): boolean {
        return this.currentDocument !== null && this.currentDocument.uri.toString() === document.uri.toString();
    }

    // flag whenever that last active editor (not null) is other type than LHQ (tasks window, etc...)
    private _lastActiveEditorNonLhq = false;

    public updateDocument(document: vscode.TextDocument | undefined) {
        if (document && !isValidDocument(document)) {
            this._lastActiveEditorNonLhq = true;
            logger().log('debug', `LhqTreeDataProvider.updateDocument skipped due to invalid document.`);
            return;
        }

        logger().log('debug', `LhqTreeDataProvider.updateDocument with: ${document?.fileName ?? '-'}`);
        if (isValidDocument(document)) {
            setEditorActive(true);
            if (this.currentDocument?.uri.toString() !== document.uri.toString() || !this.currentData) {
                this.currentDocument = document;
                this.refresh();
            }
        } else {
            if (isEditorActive()) {
                if (!this._lastActiveEditorNonLhq) {
                    this._lastActiveEditorNonLhq = false;
                    setEditorActive(false);
                    this.currentDocument = null;
                    this.refresh();
                } else {
                    this._lastActiveEditorNonLhq = false;
                }
            }
        }
    }

    refresh(): void {
        if (this.currentDocument) {
            try {
                // Attempt to parse the document content as JSON for the tree view
                // In a real scenario, you'd parse your specific LHQ format
                this.currentData = JSON.parse(this.currentDocument.getText());
            } catch (e) {
                logger().log('error', 'Error parsing LHQ file :', e as Error);
                this.currentData = {};
                vscode.window.showWarningMessage('Could not parse LHQ file for TreeView.');
            }
        } else {
            this.currentData = null;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!this.currentData) {
            return Promise.resolve([]);
        }

        let items: vscode.TreeItem[] = [];
        if (!element) { // Root
            if (this.currentData.project && this.currentData.project.name) {
                items.push(new LhqTreeItem(this.currentData.project.name, vscode.TreeItemCollapsibleState.Expanded, this.currentData.project));
            } else { // If no project structure, maybe list top-level keys
                Object.keys(this.currentData).forEach(key => {
                    const value = this.currentData[key];
                    const collapsibleState = typeof value === 'object' && value !== null ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
                    items.push(new LhqTreeItem(key, collapsibleState, value));
                });
            }
        } else if (element instanceof LhqTreeItem && element.data) {
            const data = element.data;
            if (data.folders && Array.isArray(data.folders)) {
                items = data.folders.map((folder: any) => new LhqTreeItem(folder.name, vscode.TreeItemCollapsibleState.Collapsed, folder));
            } else if (data.files && Array.isArray(data.files)) {
                items = data.files.map((file: any) => new LhqTreeItem(file.name, vscode.TreeItemCollapsibleState.None, file));
            } else if (typeof data === 'object') { // Generic object explorer
                Object.keys(data).forEach(key => {
                    const value = data[key];
                    const collapsibleState = typeof value === 'object' && value !== null && Object.keys(value).length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
                    items.push(new LhqTreeItem(key, collapsibleState, value));
                });
            }
        }
        return Promise.resolve(items);
    }
}


// Sample data for the TreeView
export const sampleLhqData = {
    "project": {
        "name": "My LHQ Project",
        "version": "1.0.0",
        "folders": [
            {
                "name": "src",
                "files": [
                    { "name": "main.lhq" },
                    { "name": "utils.lhq" }
                ]
            },
            {
                "name": "docs",
                "files": [
                    { "name": "readme.md" }
                ]
            }
        ]
    }
};