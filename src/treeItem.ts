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
        super(label, collapsibleState);
        this.description = `(${this.element.elementType})`;
        const parentPath = element.paths.getParentPath('/', true);
        this.tooltip = parentPath; //`${this.label} (${element.elementType})`;

        this.contextValue = element.elementType;

        // const icon = `${this.element.elementType}.svg`;
        // this.iconPath = {
        //     light: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'light', icon)),
        //     dark: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'dark', icon))
        // };

        this.iconPath = new vscode.ThemeIcon(icons[this.element.elementType]);
    }
}