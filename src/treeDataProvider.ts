import * as vscode from 'vscode';
import { QuickPickItemKind } from 'vscode';
import path from 'node:path';

import type {
    CategoryOrResourceType, FormattingOptions, ICategoryLikeTreeElement, IRootModelElement,
    ITreeElement, LhqModel, LhqValidationResult, TreeElementType
} from '@lhq/lhq-generators';
import { detectFormatting, generatorUtils, isNullOrEmpty, ModelUtils } from '@lhq/lhq-generators';

import { LhqTreeItem } from './treeItem';
import { validateName } from './validator';
import { filterTreeElements, filterVirtualTreeElements, isVirtualTreeElement, VirtualRootElement } from './elements';
import type { SearchTreeOptions, MatchingElement, CultureInfo, IVirtualLanguageElement } from './types';
import { appContext } from './context';
import { getMessageBoxText, createTreeElementPaths, findChildsByPaths, matchForSubstring, 
    logger, getElementFullPath, showMessageBox, getCultureDesc, showConfirmBox, loadCultures, isValidDocument } from './utils';

const actions = {
    refresh: 'lhqTreeView.refresh',
    addElement: 'lhqTreeView.addElement',
    renameElement: 'lhqTreeView.renameElement',
    deleteElement: 'lhqTreeView.deleteElement',
    findInTreeView: 'lhqTreeView.findInTreeView',
    advancedFind: 'lhqTreeView.advancedFind',
    addCategory: 'lhqTreeView.addCategory',
    addResource: 'lhqTreeView.addResource',
    addLanguage: 'lhqTreeView.addLanguage',
    deleteLanguage: 'lhqTreeView.deleteLanguage',
    markLanguageAsPrimary: 'lhqTreeView.markLanguageAsPrimary',
    showLanguages: 'lhqTreeView.showLanguages',
    hideLanguages: 'lhqTreeView.hideLanguages',
    projectProperties: 'lhqTreeView.projectProperties'
};

type DragTreeItem = {
    path: string;
    type: CategoryOrResourceType;
}


interface LanguageQuickPickItem extends vscode.QuickPickItem {
    culture: CultureInfo;
}

type LangTypeMode = 'all' | 'neutral' | 'country';

// let languagesQuickPickItems: LanguageQuickPickItem[] | undefined;
// let lastSelectedLangTypeMode: LangTypeMode = 'all';

interface LangTypeQuickPickItem extends vscode.QuickPickItem {
    mode: LangTypeMode;
}

const LanguageTypeModes = [
    {
        label: 'All languages',
        description: 'Select from all available languages',
        mode: 'all',
    },
    {
        kind: QuickPickItemKind.Separator
    },
    {
        label: 'Neutral languages',
        detail: `Example: en, de, ...`,
        mode: 'neutral'
    },
    {
        label: 'Country-specific languages',
        detail: `Example: en-US , de-DE, ...`,
        mode: 'country'
    }
] as LangTypeQuickPickItem[];

export class LhqTreeDataProvider implements vscode.TreeDataProvider<ITreeElement>,
    vscode.TreeDragAndDropController<ITreeElement> {
    dropMimeTypes = ['application/vnd.code.tree.lhqTreeView'];
    dragMimeTypes = ['text/uri-list'];

    // flag whenever that last active editor (not null) is other type than LHQ (tasks window, etc...)
    // private _lastActiveEditorNonLhq = false;
    private _currentSearch: SearchTreeOptions = {
        searchText: '',
        type: 'name',
        uid: crypto.randomUUID(),
        elems: []
    };

    private _onDidChangeTreeData: vscode.EventEmitter<(ITreeElement | undefined)[] | undefined> = new vscode.EventEmitter<ITreeElement[] | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    //private currentRootModel: IRootModelElement | null = null;
    private currentRootModel: IRootModelElement | undefined;
    private currentVirtualRootElement: VirtualRootElement | null = null;
    private currentDocument: vscode.TextDocument | null = null;
    private currentJsonModel: LhqModel | null = null;
    private currentFormatting: FormattingOptions = { indentation: { amount: 2, type: 'space', indent: '  ' }, eol: '\n' };
    // private selectedElement: ITreeElement | undefined = undefined;
    private selectedElements: ITreeElement[] = [];
    private view: vscode.TreeView<any>;

    constructor(private context: vscode.ExtensionContext) {

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(e => this.onActiveEditorChanged(e)),
            vscode.window.onDidChangeVisibleTextEditors(e => this.onDidChangeVisibleTextEditors(e)),

            vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
            vscode.workspace.onDidOpenTextDocument(e => this.onDidOpenTextDocument(e)),

            vscode.commands.registerCommand(actions.refresh, () => this.refresh()),
            vscode.commands.registerCommand(actions.addElement, args => this.addItem(args)),
            vscode.commands.registerCommand(actions.renameElement, args => this.renameItem(args)),
            vscode.commands.registerCommand(actions.deleteElement, args => this.deleteElement(args)),
            vscode.commands.registerCommand(actions.findInTreeView, () => this.findInTreeView()),
            vscode.commands.registerCommand(actions.advancedFind, () => this.advancedFind()),
            vscode.commands.registerCommand(actions.addCategory, args => this.addCategory(args)),
            vscode.commands.registerCommand(actions.addResource, args => this.addResource(args)),
            vscode.commands.registerCommand(actions.addLanguage, args => this.addLanguage(args)),
            vscode.commands.registerCommand(actions.deleteLanguage, args => this.deleteLanguage(args)),
            vscode.commands.registerCommand(actions.markLanguageAsPrimary, args => this.markLanguageAsPrimary(args)),
            vscode.commands.registerCommand(actions.showLanguages, () => this.toggleLanguages(true)),
            vscode.commands.registerCommand(actions.hideLanguages, () => this.toggleLanguages(false))
        );


        this.onActiveEditorChanged(vscode.window.activeTextEditor);

        this.view = vscode.window.createTreeView('lhqTreeView', {
            treeDataProvider: this,
            showCollapseAll: true,
            canSelectMany: true,
            dragAndDropController: this
        });
        context.subscriptions.push(this.view);

        context.subscriptions.push(
            this.view.onDidChangeSelection(e => {
                this.selectedElements = [...(e.selection && e.selection.length > 0 ? e.selection : [])];
                appContext.setTreeViewHasSelectedItem(this.selectedElements);
            })
        );
    }

    private toggleLanguages(visible: boolean): void {
        appContext.languagesVisible = visible;

        if (!this.currentVirtualRootElement) {
            return;
        }
        this.refresh();
    }

    private async advancedFind(): Promise<any> {
        if (!this.currentDocument) {
            return;
        }

        const prompt = 'Enter search text [empty to clear search, enter on same text to advance to next match]';
        const placeHolder = 'Use # to filter by name, / for path, @ for language, ! for translations';

        let searchText = await vscode.window.showInputBox({
            prompt,
            ignoreFocusOut: true,
            placeHolder,
            value: this._currentSearch.searchText,
            title: getMessageBoxText('Advanced search in LHQ structure')
        });

        if (searchText === undefined || !this.currentDocument) {
            return;
        }

        searchText = (searchText ?? '').trim();

        const searchUid = this._currentSearch.searchText !== searchText ? crypto.randomUUID() : this._currentSearch.uid;
        const sameSearch = this._currentSearch.uid === searchUid;

        // by path
        if (searchText.startsWith('/') || searchText.startsWith('\\')) {
            if (sameSearch) {
                const elemIdx = this._currentSearch.type === 'path' ? this._currentSearch.elemIdx : -1;
                if (this._currentSearch.type === 'path') {
                    this._currentSearch.elemIdx = elemIdx;
                }
            } else {
                const filter = searchText.substring(1);
                const searchTreePaths = createTreeElementPaths(filter.length === 0 ? '/' : filter, true);
                const paths = searchTreePaths.getPaths(true);
                const elems = findChildsByPaths(this.currentRootModel!, searchTreePaths!);
                const elemIdx = -1;
                this._currentSearch = { type: 'path', searchText, filter, paths, elems, uid: searchUid, elemIdx };
            }
        } else if (searchText.startsWith('@')) { // by language
            this._currentSearch = { type: 'language', searchText, elems: [], filter: searchText.substring(1), uid: searchUid };
        } else if (searchText.startsWith('!')) { // by translation
            this._currentSearch = { type: 'translation', searchText, elems: [], filter: searchText.substring(1), uid: searchUid };
        } else { // by name 
            // # or other...
            const filter = searchText.startsWith('#') ? searchText.substring(1) : searchText;

            if (sameSearch) {
                const elemIdx = this._currentSearch.type === 'name' ? this._currentSearch.elemIdx : -1;
                if (this._currentSearch.type === 'name') {
                    this._currentSearch.elemIdx = elemIdx;
                }
            } else {
                const elems: MatchingElement[] = [];

                this.currentRootModel!.iterateTree((elem, leaf) => {
                    let match = matchForSubstring(elem.name, filter, true);
                    if (match.match !== 'none') {
                        elems.push({ element: elem, match, leaf });
                    }
                });

                const elemIdx = -1;
                this._currentSearch = { type: 'name', searchText, elems, elemIdx, uid: searchUid };
            }


            // this._currentSearch = { type: 'name', searchText, filter, last, uid: searchUid };
        }

        this._onDidChangeTreeData.fire(undefined);

        if (this.currentRootModel) {
            let elemToFocus: ITreeElement | undefined;

            if (this._currentSearch.type === 'language') {
                elemToFocus = this.currentVirtualRootElement!.languagesRoot.find(this._currentSearch.filter ?? '');
            } else if (this._currentSearch.type === 'path') {
                if (this._currentSearch.searchText === '/' || this._currentSearch.searchText === '\\') {
                    elemToFocus = this.currentRootModel;
                    this._currentSearch.elemIdx = -1;
                } else {
                    // const elems = this._currentSearch.elems;
                    // if (elems && elems.length > 0) {
                    //     let elemIdx = 0;
                    //     if (sameSearch) {
                    //         elemIdx = (this._currentSearch.elemIdx ?? -1) + 1;
                    //         elemIdx = elemIdx >= elems.length ? 0 : elemIdx;
                    //     }
                    //     this._currentSearch.elemIdx = elemIdx;

                    //     const sortedElems = arraySortBy(elems, x => x.leaf ? 0 : 1, 'asc');
                    //     elemToFocus = sortedElems.at(elemIdx)?.element;
                    // }
                }
            }

            if (elemToFocus === undefined) {
                const elems = this._currentSearch.elems;
                if (elems && elems.length > 0) {
                    let elemIdx = 0;
                    if (sameSearch) {
                        elemIdx = (this._currentSearch.elemIdx ?? -1) + 1;
                        elemIdx = elemIdx >= elems.length ? 0 : elemIdx;
                    }
                    this._currentSearch.elemIdx = elemIdx;

                    // const sortedElems = arraySortBy(elems, x => x.leaf ? 0 : 1, 'asc');
                    // elemToFocus = sortedElems.at(elemIdx)?.element;
                    elemToFocus = elems.at(elemIdx)?.element;
                }
            }

            if (elemToFocus) {
                //await this.clearSelection();
                await this.view.reveal(elemToFocus, { expand: true, select: true, focus: true });
            }
        }
    }

    async findInTreeView(): Promise<any> {
        await vscode.commands.executeCommand('lhqTreeView.focus'); // Focus the tree view itself
        await vscode.commands.executeCommand('list.find', 'lhqTreeView');
    }

    public async clearSelection(): Promise<void> {
        if (!this.view || this.view.selection.length === 0) {
            return;
        }

        let itemToUse: ITreeElement | undefined = this.view.selection[0];

        if (!itemToUse) {
            itemToUse = this.currentRootModel;
        }

        if (itemToUse) {
            try {
                // select/deselect trick
                await this.view.reveal(itemToUse, { select: true, focus: false, expand: false });
                await this.view.reveal(itemToUse, { select: false, focus: false, expand: false });
            } catch (error) {
                console.error("Failed to clear selection using two-step reveal:", error);
            }
        }
    }

    private async setSelectedItems(itemsToSelect: ITreeElement[], options?: { focus?: boolean; expand?: boolean | number }): Promise<void> {
        if (!this.view) {
            logger().log('warn', 'setSelectedItems: TreeView is not available.');
            return;
        }

        if (!itemsToSelect || itemsToSelect.length === 0) {
            // If you want to clear selection, there isn't a direct API.
            // One common way is to reveal a known "unselectable" or root item without selecting it,
            // or if the last reveal with select:true clears previous selections,
            // revealing a single item with select:true would effectively set the selection to just that item.
            // For now, this method will only add to selection or set it if items are provided.
            // To truly "clear" selection, you might need to manage it more complexly or rely on user interaction.
            logger().log('debug', 'setSelectedItems: No items provided to select.');
            return;
        }

        for (let i = 0; i < itemsToSelect.length; i++) {
            const item = itemsToSelect[i];
            const revealOptions = {
                select: true,
                focus: options?.focus !== undefined ? options.focus : (i === itemsToSelect.length - 1),
                expand: options?.expand !== undefined ? options.expand : false
            };
            try {
                await this.view.reveal(item, revealOptions);
            } catch (error) {
                logger().log('error', `setSelectedItems: Failed to reveal/select item '${getElementFullPath(item)}'`, error as Error);
            }
        }
    }

    private getCategoryLikeParent(element: ITreeElement): ICategoryLikeTreeElement | undefined {
        if (!element) {
            return undefined;
        }

        if (element.elementType === 'resource') {
            return element.parent ?? this.currentRootModel;
        }

        return element.parent;
    }

    // private get selectedCategoryLike(): ICategoryLikeTreeElement | undefined {
    //     let element = this.selectedElement ?? this.currentRootModel;
    //     if (!element) {
    //         return undefined;
    //     }

    //     if (element.elementType === 'resource') {
    //         element = element.parent ?? this.currentRootModel;
    //     }

    //     return element as ICategoryLikeTreeElement;
    // }

    public async handleDrag(source: ITreeElement[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const items = source.filter(x => x.elementType === 'category' || x.elementType === 'resource').map<DragTreeItem>(x => ({
            path: getElementFullPath(x),
            type: x.elementType as CategoryOrResourceType,
        }));

        if (items.length === 0 || _token.isCancellationRequested) {
            return Promise.reject();
        }

        treeDataTransfer.set('application/vnd.code.tree.lhqTreeView', new vscode.DataTransferItem(items));
    }

    private getTreeItems(source: DragTreeItem[]): ITreeElement[] {
        const root = this.currentRootModel;
        return isNullOrEmpty(root)
            ? []
            : source.map(item => {
                const treeItem = root.getElementByPath(createTreeElementPaths(item.path), item.type);
                return treeItem;
            }).filter(item => item !== undefined && item.elementType !== 'model') as ITreeElement[];
    }

    public async handleDrop(target: ITreeElement | undefined, sources: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        if (!target || (target.elementType !== 'model' && target.elementType !== 'category')) {
            return;
        }

        const transferItem = sources.get('application/vnd.code.tree.lhqTreeView');
        if (!transferItem || _token.isCancellationRequested) {
            return;
        }

        const items: DragTreeItem[] = transferItem.value;
        if (!items || items.length === 0) {
            return;
        }

        if (!this.currentDocument) {
            return;
        }

        let sourceItems = this.getTreeItems(items);
        const itemCount = sourceItems.length;
        const firstParent = sourceItems[0].parent;
        const elemText = `${itemCount} element(s)`;

        if (sourceItems.length > 1) {
            if (!sourceItems.every(item => item.parent === firstParent)) {
                return await showMessageBox('warn', `Cannot move ${elemText} with different parents.`);
            }
        }

        if (target === firstParent) {
            return await showMessageBox('warn', `Cannot move ${elemText} to the same parent element '${getElementFullPath(target)}'.`);
        }

        const targetElement = target as ICategoryLikeTreeElement;

        sourceItems = sourceItems.filter(x => !targetElement.contains(x.name, x.elementType as CategoryOrResourceType));

        await this.view.reveal(targetElement, { expand: true, select: false, focus: false });

        if (sourceItems.length === 0) {
            return;
        }

        let changedCount = 0;
        sourceItems.forEach(item => {
            const containsElement = targetElement.contains(item.name, item.elementType as CategoryOrResourceType);
            if (!containsElement) {
                const oldPath = getElementFullPath(item);
                const changed = item.changeParent(targetElement);
                if (changed) {
                    changedCount++;
                }
                logger().log('debug', `LhqTreeDataProvider.handleDrop: ${item.elementType} '${oldPath}' moved to '${getElementFullPath(item)}', successfully: ${changed}`);
            }
        });

        await this.updateTextDocument();
        this._onDidChangeTreeData.fire([target]);
        const toFocus = sourceItems.length === 1 ? sourceItems[0] : targetElement;
        await this.view.reveal(toFocus, { expand: true, select: true, focus: true });

        if (changedCount > 0) {
            const moved = sourceItems.length === 1
                ? `${sourceItems[0].elementType} '${getElementFullPath(sourceItems[0])}'`
                : `${sourceItems.length} element(s)`;

            await showMessageBox('info', `Moved ${moved} under '${getElementFullPath(target)}'`);
        }
    }

    private async markLanguageAsPrimary(element: ITreeElement): Promise<void> {
        if (!this.currentDocument) {
            return;
        }

        const selElems = element && this.selectedElements.length <= 1 ? [element] : this.selectedElements;
        const selectedElements = filterVirtualTreeElements<IVirtualLanguageElement>(selElems, 'language');
        const selectedCount = selectedElements.length;
        if (selectedCount === 0) { return; }

        if (selectedCount > 1) {
            return await showMessageBox('warn', `Cannot mark multiple languages as primary. Please select only one language.`, { modal: true });
        }

        const langElement = selectedElements[0];

        if (this.currentRootModel!.primaryLanguage === langElement.name) {
            return await showMessageBox('info', `Language '${getCultureDesc(langElement.name)}' is already marked as primary.`);
        }

        this.currentRootModel!.primaryLanguage = langElement.name;

        const success = await this.updateTextDocument();
        await showMessageBox(success ? 'info' : 'err', success
            ? `Successfully marked '${getCultureDesc(langElement.name)}' as primary language.`
            : `Failed to mark '${getCultureDesc(langElement.name)}' as primary language.`, { modal: !success });
    }

    private async deleteLanguage(element: ITreeElement): Promise<void> {
        if (!this.currentDocument) {
            return;
        }

        const selElems = element && this.selectedElements.length <= 1 ? [element] : this.selectedElements;
        const elemsToDelete = filterVirtualTreeElements<IVirtualLanguageElement>(selElems, 'language');
        const selectedCount = elemsToDelete.length;
        if (selectedCount === 0) { return; }

        const restCount = Math.max(0, this.currentRootModel!.languages.length - selectedCount);
        if (restCount === 0) {
            return await showMessageBox('warn', `Cannot delete all languages. At least one language must remain.`, { modal: true });
        }

        const primaryLang = elemsToDelete.find(x => x.isPrimary);
        if (primaryLang) {
            const msg = selectedCount === 1
                ? `Primary language '${getCultureDesc(primaryLang.name)}' cannot be deleted.`
                : `Selected languages contain primary language '${getCultureDesc(primaryLang.name)}' which cannot be deleted.`;
            return await showMessageBox('warn', msg, { modal: true });
        }

        const maxDisplayCount = 10;

        const elemIdent = selectedCount === 1
            ? getCultureDesc(elemsToDelete[0].name)
            : selectedCount <= maxDisplayCount
                ? elemsToDelete.slice(0, maxDisplayCount).map(x => `'${getCultureDesc(x.name)}'`).join(', ')
                : '';


        const detail = selectedCount > maxDisplayCount ? '' : `Selected languages to delete: \n${elemIdent}\n\n` + 'This will remove all translations for those languages!';
        if (!(await showConfirmBox(`Delete ${selectedCount} languages ?`, detail, true))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        const root = this.currentRootModel!;
        elemsToDelete.forEach(elem => {
            if (!root.removeLanguage(elem.name)) {
                logger().log('warn', `LhqTreeDataProvider.deleteLanguage: Cannot delete language '${elem.name}' - not found in model.`);
            }
        });

        const success = await this.updateTextDocument();
        await showMessageBox(success ? 'info' : 'err',
            success ? `Successfully deleted ${elemIdent}.` : `Failed to delete ${elemIdent}.`, { modal: !success });
    }

    private async deleteElement(element: ITreeElement): Promise<void> {
        if (!this.currentDocument) {
            return;
        }

        const elemsToDelete = filterTreeElements(element && this.selectedElements.length <= 1 ? [element] : this.selectedElements);
        const selectedCount = elemsToDelete.length;
        if (selectedCount === 0) { return; }

        const firstSelected = elemsToDelete[0];
        if (firstSelected.isRoot) {
            return await showMessageBox('warn', `Cannot delete root element '${getElementFullPath(firstSelected)}'.`, { modal: true });
        }

        const elemIdent = selectedCount === 1
            ? `${firstSelected.elementType} '${getElementFullPath(firstSelected)}'`
            : `${selectedCount} selected elements`;

        if (selectedCount > 1) {
            const firstParent = firstSelected.parent;
            if (!elemsToDelete.every(item => item.parent === firstParent)) {
                return await showMessageBox('warn', `Cannot delete ${elemIdent} with different parents.`, { modal: true });
            }
        }

        if (!(await showConfirmBox(`Delete ${elemIdent} ?`))) {
            return;
        }

        elemsToDelete.forEach(elem => {
            const parent = this.getCategoryLikeParent(elem);
            if (parent) {
                parent.removeElement(elem);
                logger().log('debug', `LhqTreeDataProvider.deleteItem: ${elem.elementType} '${getElementFullPath(elem)}' deleted.`);
            } else {
                logger().log('warn', `LhqTreeDataProvider.deleteItem: Cannot delete ${elem.elementType} '${getElementFullPath(elem)}' - no parent found.`);
            }
        });

        const success = await this.updateTextDocument();
        await showMessageBox(success ? 'info' : 'err', success ? `Successfully deleted ${elemIdent}.` : `Failed to delete ${elemIdent}.`, { modal: !success });
    }

    private validateElementName(elementType: TreeElementType, name: string, parentElement?: ICategoryLikeTreeElement, ignoreElementPath?: string): string | null {
        const valRes = validateName(name);
        if (valRes === 'valid') {
            if (parentElement && !isNullOrEmpty(name)) {
                const found = parentElement.find(name, elementType as CategoryOrResourceType);
                if (found && (!ignoreElementPath || getElementFullPath(found) !== ignoreElementPath)) {
                    const root = parentElement.elementType === 'model' ? '/' : getElementFullPath(parentElement);
                    return `${elementType} '${name}' already exists in ${root}`;
                }
            }
        } else {
            switch (valRes) {
                case 'nameIsEmpty':
                    return 'Name cannot be empty.';
                case 'nameCannotBeginWithNumber':
                    return 'Name cannot start with a number.';
                case 'nameCanContainOnlyAlphaNumeric':
                    return 'Name can only contain alphanumeric characters and underscores.';
            }
        }

        return null;
    }

    private async renameItem(element: ITreeElement): Promise<void> {
        const selectedCount = this.selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        if (element && selectedCount === 1 && element !== this.selectedElements[0]) {
            await this.setSelectedItems([element], { focus: true, expand: false });
        }

        //element = element || this.selectedElement;
        element = element || (this.selectedElements.length > 0 ? this.selectedElements[0] : undefined);
        if (!this.currentDocument || !element) {
            return;
        }

        const originalName = element.name;
        const elemPath = getElementFullPath(element);

        const elementType = element.elementType;
        const parentElement = this.getCategoryLikeParent(element);
        const newName = await vscode.window.showInputBox({
            prompt: `Enter new name for ${elementType} '${originalName}' (${elemPath})`,
            value: originalName,
            ignoreFocusOut: true,
            validateInput: value => this.validateElementName(elementType, value, parentElement, elemPath)
        });

        if (!newName || newName === originalName) {
            return;
        }

        const validationError = this.validateElementName(elementType, newName, parentElement, elemPath);
        if (validationError) {
            return showMessageBox('warn', validationError);
        }

        element.name = newName;
        const success = await this.updateTextDocument();

        this._onDidChangeTreeData.fire([element]);
        await this.view.reveal(element, { expand: true, select: true, focus: true });


        if (!success) {
            logger().log('error', `RenameItem: vscode.workspace.applyEdit failed for '${originalName}' to '${newName}' (${elemPath})`);
            return await showMessageBox('err', `Failed to apply rename for item '${originalName}'.`);
        }
    }

    private updateTextDocument(): Thenable<boolean> {
        logger().log('debug', `LhqTreeDataProvider.updateTextDocument for: ${this.documentPath}`);

        const serializedRoot = ModelUtils.serializeTreeElement(this.currentRootModel!, this.currentFormatting);
        const edit = new vscode.WorkspaceEdit();
        const doc = this.currentDocument!;
        edit.replace(
            doc.uri,
            new vscode.Range(0, 0, doc.lineCount, 0),
            serializedRoot);

        return vscode.workspace.applyEdit(edit);
    }

    private async addItem(element: ITreeElement, newItemType?: CategoryOrResourceType): Promise<any> {
        const selectedCount = this.selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        if (element && selectedCount === 1 && element !== this.selectedElements[0]) {
            await this.setSelectedItems([element], { focus: true, expand: false });
        }

        element = element || (this.selectedElements.length > 0 ? this.selectedElements[0] : undefined);
        element = element ?? this.currentRootModel!;

        if (!this.currentDocument || !element) {
            return;
        }

        if (element.elementType === 'resource') {
            element = element.parent || element.root;
        }

        const elemPath = getElementFullPath(element);

        const itemType = isNullOrEmpty(newItemType)
            ? await vscode.window.showQuickPick([
                {
                    label: 'Category',
                    elementType: 'category' as TreeElementType
                },
                {
                    label: 'Resource',
                    elementType: 'resource' as TreeElementType
                }
            ], { placeHolder: `Select element type to add under ${elemPath}` })
            : { elementType: newItemType };

        if (!itemType) {
            return;
        }

        setTimeout(() => {
            void this.addItemComplete(element, itemType.elementType);
        }, 100);
    }

    private async addCategory(element: ITreeElement): Promise<void> {
        return await this.addItem(element, 'category');
    }

    private async addResource(element: ITreeElement): Promise<void> {
        return await this.addItem(element, 'resource');
    }

    private async addLanguage(element: ITreeElement): Promise<void> {
        const selected = await vscode.window.showQuickPick(LanguageTypeModes, {
            placeHolder: `Select type of languages to select from`,
            ignoreFocusOut: true
        });

        if (!selected) {
            return;
        }

        setTimeout(() => {
            void this.addLanguageComplete(selected.mode);
        }, 100);
    }

    async addLanguageComplete(langTypeMode: LangTypeMode): Promise<void> {
        const cultures = await loadCultures();
        const langRoot = this.currentVirtualRootElement!.languagesRoot;

        const languagesQuickPickItems = Object.values(cultures)
            .filter(culture => {
                if (langRoot.contains(culture.name)) {
                    return false;
                }

                if (langTypeMode === 'all') {
                    return true;
                }

                return langTypeMode === 'neutral' ? culture.isNeutral : !culture.isNeutral;
            })
            .map(culture => ({
                label: culture.name + (culture.isNeutral ? ' (neutral)' : ''),
                description: culture.engName,
                detail: culture.nativeName,
                culture
            }) as LanguageQuickPickItem);

        const result = await vscode.window.showQuickPick(languagesQuickPickItems, {
            canPickMany: true, ignoreFocusOut: true,
            matchOnDescription: true, matchOnDetail: true, placeHolder: 'Select languages to add'
        });

        if (!result || result.length === 0) {
            return;
        }

        if (!this.currentDocument) {
            return;
        }

        const added: string[] = [];
        result.map(item => item.culture.name).forEach(cultureName => {
            if (this.currentRootModel?.addLanguage(cultureName)) {
                const culture = cultures[cultureName];
                if (culture) {
                    added.push(`${culture.engName} (${culture.name})`);
                }
            }
        });

        await this.updateTextDocument();

        this._onDidChangeTreeData.fire([langRoot]);
        await this.view.reveal(langRoot, { expand: true, select: true, focus: true });

        if (added.length > 0) {
            const maxDisplayCount = 5;
            const addedStr = added.length === 1
                ? `language: ${added[0]}`
                : added.length <= maxDisplayCount
                    ? `${added.length} languages: ` + added.slice(0, maxDisplayCount).join(', ')
                    : `${added.length} languages`;
            await showMessageBox('info', `Succesfully added ${addedStr} .`);
        } else {
            await showMessageBox('warn', `No languages were added as they already exist in the model.`);
        }
    }

    private async addItemComplete(parent: ITreeElement, elementType: TreeElementType) {
        const isResource = elementType === 'resource';
        const parentCategory = parent as ICategoryLikeTreeElement;
        const elemPath = getElementFullPath(parent);
        const itemName = await vscode.window.showInputBox({
            prompt: `Enter new ${elementType} name (${elemPath})`,
            ignoreFocusOut: true,
            validateInput: value => this.validateElementName(elementType, value, parentCategory)
        });

        if (!itemName) {
            return;
        }

        const validationError = this.validateElementName(elementType, itemName, parentCategory);
        if (validationError) {
            return await showMessageBox('warn', validationError);
        }

        let newElement: ITreeElement;
        if (isResource) {
            newElement = parentCategory.addResource(itemName);
        } else {
            newElement = parentCategory.addCategory(itemName);
        }

        await this.updateTextDocument();
        this._onDidChangeTreeData.fire([parent]);
        await this.view.reveal(newElement, { expand: true, select: true, focus: true });

        return await showMessageBox('info', `Added new ${elementType} '${itemName}' under '${getElementFullPath(parent)}'`);
    }

    private onDidChangeVisibleTextEditors(e: readonly vscode.TextEditor[]): any {
        // const editor = e.find(x => x.document.fileName === vscode.window.activeTextEditor?.document.fileName);
        // if (editor) {
        //     logger().log('debug', `LhqTreeDataProvider.onDidChangeVisibleTextEditors: Active editor found: ${editor.document?.fileName ?? '-'}`);
        // } else {
        //     logger().log('debug', "LhqTreeDataProvider.onDidChangeVisibleTextEditors: No active editor found");
        // }
    }

    private onDidOpenTextDocument(e: vscode.TextDocument): any {
        // logger().log('debug', `LhqTreeDataProvider.onDidOpenTextDocument: ${e?.fileName ?? '-'}`);
    }


    private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
        // logger().log('debug', `LhqTreeDataProvider.onDocumentChanged: ${e.document?.fileName ?? '-'}`);
        this.updateDocument(e.document);
    }

    public onActiveEditorChanged(e: vscode.TextEditor | undefined): void {
        // logger().log('debug', `LhqTreeDataProvider.onActiveEditorChanged: ${e?.document.fileName ?? '-'}`);
        this.updateDocument(e?.document);
    }

    public hasActiveDocument(): boolean {
        return this.currentDocument !== null && appContext.isEditorActive;
    }

    private get documentPath(): string {
        return this.currentDocument ? this.currentDocument.uri.fsPath : '';
    }

    public isSameDocument(document: vscode.TextDocument): boolean {
        return this.currentDocument !== null && this.currentDocument.uri.toString() === document.uri.toString();
    }

    public updateDocument(document: vscode.TextDocument | undefined, forceRefresh = false): void {
        if (isValidDocument(document)) {
            logger().log('debug', `LhqTreeDataProvider.updateDocument [VALID] with: ${document.uri.fsPath}`);
            appContext.isEditorActive = true;

            const baseName = path.basename(document.uri.fsPath);
            this.view.title = `${baseName} [LHQ Structure]`;

            if (this.currentDocument?.uri.toString() !== document.uri.toString() || !this.currentRootModel || forceRefresh === true) {
                this.currentDocument = document;
                this.refresh();
            }
        } else if (appContext.isEditorActive) {
            // @ts-ignore
            logger().log('debug', `LhqTreeDataProvider.updateDocument [INVALID] with: ${document?.uri?.fsPath}`);
            this.view.title = `LHQ Structure`;
            appContext.isEditorActive = false;
            this.currentDocument = null;
            this.refresh();
        }
    }

    refresh(): void {
        if (this.currentDocument) {
            this.currentJsonModel = null;

            this.currentRootModel = undefined;
            this.currentVirtualRootElement = null;
            try {
                const docText = this.currentDocument.getText();
                this.currentJsonModel = docText?.length > 0 ? JSON.parse(docText) as LhqModel : null;
                //this.currentIndentation = docText?.length > 0 ? Object.assign({}, defaultIdent, detectIndent(docText)) : defaultIdent;
                this.currentFormatting = detectFormatting(docText);

            } catch (ex) {
                const error = `Error parsing LHQ file '${this.documentPath}'`;
                logger().log('error', error, ex as Error);
                this.currentJsonModel = null;
                void showMessageBox('err', error);
                return;
            }

            if (this.currentJsonModel) {
                let validateResult: LhqValidationResult | undefined;

                try {
                    validateResult = generatorUtils.validateLhqModel(this.currentJsonModel);
                    if (validateResult.success && validateResult.model) {
                        this.currentRootModel = ModelUtils.createRootElement(validateResult.model);
                        this.currentVirtualRootElement = new VirtualRootElement(this.currentRootModel, appContext.languagesVisible);
                    } else {
                        this.currentJsonModel = null;
                    }
                } catch (ex) {
                    this.currentJsonModel = null;
                    const error = `Error validating LHQ file '${this.documentPath}': ${ex}`;
                    logger().log('error', error, ex as Error);
                    void showMessageBox('err', error);
                    return;
                }

                if (this.currentRootModel === undefined) {
                    const error = validateResult
                        ? `Validation errors while parsing LHQ file '${this.documentPath}': \n${validateResult.error}`
                        : `Error validating LHQ file '${this.documentPath}'`;
                    logger().log('error', error);
                    void showMessageBox('err', error);
                    return;
                }
            }

        } else {
            this.currentRootModel = undefined;
            this.currentVirtualRootElement = null;
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ITreeElement): vscode.TreeItem {
        return new LhqTreeItem(element, this._currentSearch);
    }

    getChildren(element?: ITreeElement): Thenable<ITreeElement[]> {
        if (!this.currentRootModel) {
            return Promise.resolve([]);
        }

        let result: ITreeElement[] = [];

        if (element) {
            if (isVirtualTreeElement(element, 'languages')) {
                if (appContext.languagesVisible) {
                    result.push(...this.currentVirtualRootElement!.languagesRoot.virtualLanguages);
                }
            } else if (isVirtualTreeElement(element) || element.elementType === 'resource') {
                // nothing...
            } else {
                const categLikeElement = element as ICategoryLikeTreeElement;
                result.push(...categLikeElement.categories);
                result.push(...categLikeElement.resources);
            }
        } else {
            //if (languagesVisible()) {
            result.push(this.currentVirtualRootElement!.languagesRoot);
            //}
            result.push(this.currentRootModel);
        }

        return Promise.resolve(result);
    }

    getParent(element: ITreeElement): vscode.ProviderResult<ITreeElement> {
        // if (isVirtualTreeElement(element)) {
        //     debugger;
        //     console.warn('!!!!!');
        // }
        return element.parent;
    }
} 