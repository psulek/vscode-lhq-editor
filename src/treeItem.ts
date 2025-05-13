import * as vscode from 'vscode';

export class LhqTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly data?: any // Store original data
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}`;
        if (data && typeof data !== 'object') {
            this.description = String(data);
        }
        // Assign context value based on data type for icons or specific actions
        if (data && data.folders) {
            this.contextValue = 'projectNode';
        } else if (data && data.files) {
            this.contextValue = 'folderNode';
        } else if (typeof data === 'object' && data !== null) {
            this.contextValue = 'objectNode';
        } else {
            this.contextValue = 'valueNode';
        }
    }
}