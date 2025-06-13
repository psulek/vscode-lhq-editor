import * as vscode from 'vscode';
import { ICategoryLikeTreeElement, ITreeElement } from '@lhq/lhq-generators';
import { getElementFullPath, toPascalCasing } from './utils';
import { isVirtualTreeElement, languagesVisible, VirtualTreeElement } from './elements';
import { SearchTreeOptions, AppTreeElementType, IVirtualLanguageElement } from './types';

// https://code.visualstudio.com/api/references/icons-in-labels#icon-listing
const icons: Record<AppTreeElementType, string> = {
    model: 'symbol-method',
    category: 'symbol-folder',
    resource: 'debug-breakpoint-unverified',
    treeRoot: 'target',
    languages: 'globe', //open-editors-view-icon
    language: 'debug-breakpoint-log-unverified'
};

const primaryLangIcon = 'debug-breakpoint-log';

export class LhqTreeItem extends vscode.TreeItem {

    constructor(
        public readonly element: ITreeElement,
        public readonly searchOptions: SearchTreeOptions
    ) {
        const elementType = element.elementType as AppTreeElementType;

        let virtualElement: VirtualTreeElement | undefined;
        if (isVirtualTreeElement(element)) {
            virtualElement = element as VirtualTreeElement;
        }

        const hasNoChilds = elementType === 'resource' || elementType === 'language';
        let collapsibleState = hasNoChilds
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Expanded;

        if (elementType === 'category') {
            const categLike = element as ICategoryLikeTreeElement;
            collapsibleState = categLike.hasCategories || categLike.hasResources ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }

        if (virtualElement?.virtualElementType === 'languages') {
            if (!languagesVisible()) {
                collapsibleState = vscode.TreeItemCollapsibleState.None;
            }
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

        const label = { label: elementName, highlights };
        super(label, collapsibleState);
        this.contextValue = elementType;
        let icon = icons[elementType];

        if (virtualElement) {
            //const virtualElement = element as VirtualTreeElement;
            this.parentPath = '';
            if (virtualElement.virtualElementType === 'languages') {
                this.tooltip = new vscode.MarkdownString(`**Languages**`, true);
            } else if (virtualElement.virtualElementType === 'language') {
                const isPrimary = (virtualElement as unknown as IVirtualLanguageElement).isPrimary;
                const tpName = isPrimary ? 'Primary Language' : 'Language';
                this.tooltip = new vscode.MarkdownString(`**${tpName}**: ${elementName}`, true);
                if (isPrimary) {
                    icon = primaryLangIcon;
                }
            }
        } else {
            const elemTypeStr = toPascalCasing(elementType === 'model' ? 'root' : elementType);
            this.parentPath = getElementFullPath(element);
            this.tooltip = new vscode.MarkdownString(`**${elemTypeStr}**: ${elementName} \`${this.parentPath}\``, true);
        }
        this.iconPath = new vscode.ThemeIcon(icon);
    }

    public readonly parentPath: string;
}