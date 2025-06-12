import * as vscode from 'vscode';
import { ICategoryLikeTreeElement, ITreeElement, TreeElementType } from '@lhq/lhq-generators';
import { getElementFullPath, isSubsetOfArray, toPascalCasing } from './utils';
import { isVirtualTreeElement, SearchTreeOptions, VirtualElementType, VirtualTreeElement } from './elements';

const icons: Record<TreeElementType | VirtualElementType, string> = {
    model: 'symbol-method',
    category: 'symbol-folder',
    resource: 'debug-breakpoint-unverified',
    treeRoot: 'target',
    languages: 'globe', //open-editors-view-icon
    language: 'debug-breakpoint-log',
};

export class LhqTreeItem extends vscode.TreeItem {

    constructor(
        public readonly element: ITreeElement,
        public readonly searchOptions: SearchTreeOptions
    ) {
        const elementType = element.elementType as TreeElementType | VirtualElementType;
        const hasNoChilds = elementType === 'resource' || elementType === 'language';
        let collapsibleState = hasNoChilds
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Expanded;

        if (elementType === 'category') {
            const categLike = element as ICategoryLikeTreeElement;
            collapsibleState = categLike.hasCategories || categLike.hasResources ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }

        const elementName = element.name;
        let highlights: [number, number][] | undefined;

        if (searchOptions.type === 'path') {
            const elem = searchOptions.elems?.find(x => x.element === element);
            if (elem && elem.match && elem.match.match !== 'none' && elem.leaf === true) {
                highlights = elem!.match.highlights;
            }
        }
        else if (highlights === undefined && searchOptions.elems?.length > 0) {
            const elem = searchOptions.elems.find(x => x.element === element);
            if (elem && elem.match && elem.match.match !== 'none') {
                highlights = elem.match.highlights;
            }
        }
        
        // else {
        //     let doHighlight = false;
        //     const searchText = searchOptions.filter ?? ''; // ?? searchOptions.text;
        //     if (searchText && searchText.length > 0 && elementType !== 'languages' && elementType !== 'treeRoot') {
        //         switch (searchOptions.type) {
        //             case 'name':
        //                 //doHighlight = elementType !== 'languages' && elementType !== 'treeRoot';
        //                 break;
        //             case 'translation':
        //                 //doHighlight = searchOptions.filter === 'translation' || searchOptions.text.length > 0;
        //                 break;
        //             case 'language':
        //                 doHighlight = isVirtualTreeElement(element, 'language');
        //                 break;
        //         }
        //     }

        //     if (doHighlight) {
        //         const searchLower = searchText.toLowerCase();
        //         const nameLower = elementName.toLowerCase();
        //         const startIndex = nameLower.indexOf(searchLower);
        //         if (startIndex !== -1) {
        //             highlights = [[startIndex, startIndex + searchText.length]];
        //         }
        //     }
        // }

        const label = { label: elementName, highlights };
        super(label, collapsibleState);
        this.contextValue = elementType;
        const icon = icons[elementType];
        this.iconPath = new vscode.ThemeIcon(icon);

        if (isVirtualTreeElement(element)) {
            const virtElement = element as VirtualTreeElement;
            this.parentPath = '';
            if (virtElement.virtualElementType === 'languages') {
                this.tooltip = new vscode.MarkdownString(`**Languages**`, true);
            } else if (virtElement.virtualElementType === 'language') {
                this.tooltip = new vscode.MarkdownString(`**Language**: ${elementName}`, true);
            }
        } else {
            const elemTypeStr = toPascalCasing(elementType === 'model' ? 'root' : elementType);
            this.parentPath = getElementFullPath(element);
            this.tooltip = new vscode.MarkdownString(`**${elemTypeStr}**: ${elementName} \`${this.parentPath}\``, true);
        }
    }

    public readonly parentPath: string;
}