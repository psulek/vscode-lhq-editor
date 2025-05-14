import { ITreeElement, TreeElementType } from '@lhq/lhq-generators';
import * as vscode from 'vscode';

const icons: Record<TreeElementType, string> = {
    model: 'symbol-method',
    category: 'symbol-folder',
    resource: 'symbol-file',
};

export class LhqTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly element: ITreeElement
    ) {
        // const lbl: vscode.TreeItemLabel | string =
        //     element.elementType === 'resource'
        //         ? label
        //         : { label, highlights: [[0, label.length]] };
        super({ label, highlights: [[0, label.length]] }, collapsibleState);
        this.description = `(${this.element.elementType})`;
        this.parentPath = element.paths.getParentPath('/', true);

        const icon = icons[this.element.elementType];
        this.tooltip = new vscode.MarkdownString(`$(${icon}) ${this.parentPath}`, true);
        //this.tooltip = this.parentPath;

        this.contextValue = element.elementType;
        this.iconPath = new vscode.ThemeIcon(icon);
    }

    public readonly parentPath: string;
}