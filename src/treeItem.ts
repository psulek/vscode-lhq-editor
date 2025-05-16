import { ICategoryLikeTreeElement, ITreeElement, TreeElementType } from '@lhq/lhq-generators';
import * as vscode from 'vscode';
import { getElementFullPath, toPascalCasing } from './utils';

const icons: Record<TreeElementType, string> = {
    model: 'symbol-method',
    category: 'symbol-folder',
    //resource: 'symbol-file',
    // resource: 'primitive-square',
    resource: 'debug-breakpoint-unverified',
};

export class LhqTreeItem extends vscode.TreeItem {
    constructor(
        public readonly element: ITreeElement
    ) {
        const elementType = element.elementType;
        let collapsibleState = elementType === 'resource'
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Expanded;

        if (elementType === 'category') {
            const categLike = element as ICategoryLikeTreeElement;
            collapsibleState = categLike.hasCategories || categLike.hasResources ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }

        const elementName = element.name;
        super(elementName, collapsibleState);
        this.parentPath = getElementFullPath(element);
        this.contextValue = elementType;

        const icon = icons[elementType];
        const elemTypeStr = toPascalCasing(elementType === 'model' ? 'root' : elementType);
        this.tooltip = new vscode.MarkdownString(`**${elemTypeStr}**: ${elementName} \`${this.parentPath}\``, true);

        this.iconPath = new vscode.ThemeIcon(icon);
    }

    public readonly parentPath: string;
}