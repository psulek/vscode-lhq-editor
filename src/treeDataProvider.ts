import * as vscode from 'vscode';
import { LhqTreeItem } from './treeItem';

export class LhqTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();

    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentData: any = null;
    private currentDocument: vscode.TextDocument | null = null;

    private _lhqEditorEnabled: boolean = false;;

    constructor(private context: vscode.ExtensionContext) {

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(e => this.onActiveEditorChanged(e)),
            vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
        );

        this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }

    private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
        console.log("LhqTreeDataProvider.onDocumentChanged:", e.document.fileName);
        if (this.currentDocument && e.document.uri.toString() === this.currentDocument.uri.toString() && e.document.fileName.endsWith('.lhq')) {
            this.currentDocument = e.document;
            this.refresh();
        }
    }

    private isValidDocument(document: vscode.TextDocument): boolean {
        return document && document.uri.scheme === 'file' && document.fileName.endsWith('.lhq');
    }


    // public isSameDocument(document: vscode.TextDocument): boolean {
    //     return this.currentDocument!! && document.uri.toString() === this.currentDocument.uri.toString();
    // }

    public onActiveEditorChanged(e: vscode.TextEditor | undefined): void {
        const activeDocument = e?.document;
        console.log("Active editor changed:", activeDocument?.fileName ?? '-none-');

        if (activeDocument && activeDocument.uri.scheme === 'file' && activeDocument.fileName.endsWith('.lhq')) {
            this.lhqEditorEnabled = true;
            // Update tree to this document if it's different from current, or if tree was empty/not for this doc
            if (this.currentDocument?.uri.toString() !== activeDocument.uri.toString() || !this.currentData) {
                this.currentDocument = activeDocument;
                this.refresh();
            }

        } else {
            if (this.lhqEditorEnabled) { // Only change context and clear tree if it was previously enabled
                this.lhqEditorEnabled = false;
                this.currentDocument = null;
                this.refresh(); // Clear the tree
            }
        }
    }

    public get lhqEditorEnabled(): boolean {
        return this._lhqEditorEnabled;
    }

    public set lhqEditorEnabled(value: boolean) {
        if (this._lhqEditorEnabled !== value) {
            this._lhqEditorEnabled = value;
            console.log("LhqTreeDataProviderlhqEditorEnabled changed to: ", value);
            vscode.commands.executeCommand('setContext', 'lhqEditorEnabled', value);
        }
    }

    public updateDocument(document: vscode.TextDocument | null) {
        console.log("LhqTreeDataProvider.updateDocument with:", document?.fileName ?? 'null');

        this.currentDocument = document;
        this.lhqEditorEnabled = !!document;
        this.refresh();
    }

    refresh(): void {
        if (this.currentDocument) {
            try {
                // Attempt to parse the document content as JSON for the tree view
                // In a real scenario, you'd parse your specific LHQ format
                this.currentData = JSON.parse(this.currentDocument.getText());
            } catch (e) {
                console.error("Error parsing LHQ file for TreeView:", e);
                // Fallback to sample data or clear if parsing fails
                this.currentData = sampleLhqData; // Or set to null to show an empty tree
                vscode.window.showWarningMessage("Could not parse LHQ file for TreeView. Displaying sample data.");
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