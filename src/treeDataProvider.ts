import path from 'node:path';
import * as vscode from 'vscode';

import type {
    CategoryOrResourceType, ICategoryLikeTreeElement, IRootModelElement,
    ITreeElement, TreeElementType
} from '@lhq/lhq-generators';

import { isNullOrEmpty } from '@lhq/lhq-generators';

import { LhqTreeItem } from './treeItem';
import { isVirtualTreeElement, VirtualElementLoading, VirtualTreeElement } from './elements';
import type { SearchTreeOptions, MatchingElement, ITreeContext, IDocumentContext, IVirtualRootElement, SelectionBackup } from './types';

import {
    getMessageBoxText, createTreeElementPaths, findChildsByPaths, matchForSubstring,
    logger, getElementFullPath, showMessageBox,
    showNotificationBox
} from './utils';


type DragTreeItem = {
    path: string;
    type: CategoryOrResourceType;
}

const loadingNodeVisibleTimeout = 200;

export class LhqTreeDataProvider implements vscode.TreeDataProvider<ITreeElement>,
    vscode.TreeDragAndDropController<ITreeElement>, ITreeContext {
    dropMimeTypes = ['application/vnd.code.tree.lhqTreeView'];
    dragMimeTypes = ['text/uri-list'];

    // flag whenever that last active editor (not null) is other type than LHQ (tasks window, etc...)
    private _currentSearch: SearchTreeOptions = {
        searchText: '',
        type: 'name',
        uid: crypto.randomUUID(),
        elems: []
    };

    private _onDidChangeTreeData: vscode.EventEmitter<(ITreeElement | undefined)[] | undefined> = new vscode.EventEmitter<ITreeElement[] | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    private selectedElements: ITreeElement[] = [];
    private view: vscode.TreeView<any>;

    private _activeDoc: IDocumentContext | undefined;

    private _loadingTreeElement: VirtualElementLoading;
    private _loadingNodeVisible = false;

    constructor(context: vscode.ExtensionContext) {
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
                appContext.setTreeSelection(this.selectedElements);
            })
        );

        this._loadingTreeElement = new VirtualElementLoading();
    }

    public get activeDocument(): IDocumentContext | undefined {
        return this._activeDoc;
    }

    private get resourcesUnderRoot(): boolean {
        return this._activeDoc?.resourcesUnderRoot ?? false;
    }

    private get isTreeStructure(): boolean {
        return this._activeDoc?.isTreeStructure ?? false;
    }

    private get currentRootModel(): IRootModelElement | undefined {
        return this._activeDoc?.rootModel;
    }

    private get currentVirtualRootElement(): IVirtualRootElement | undefined {
        return this._activeDoc?.virtualRootElement;
    }

    public refreshTree(elements: ITreeElement[] | undefined): void {
        this._onDidChangeTreeData.fire(elements);
    }

    public getElementByPath(elementType: TreeElementType, path: string[]): ITreeElement | undefined {
        if (!this.checkActiveDoc('getElementByPath')) {
            return undefined;
        }

        const paths = createTreeElementPaths('/' + path.join('/'), true);
        return elementType === 'model'
            ? this.currentRootModel
            : this.currentRootModel!.getElementByPath(paths, elementType as CategoryOrResourceType);
    }

    public async selectElementByPath(elementType: TreeElementType, path: string[], expand?: boolean): Promise<void> {
        const elem = this.getElementByPath(elementType, path);

        if (elem) {
            await this.revealElement(elem, { select: true, focus: true, expand: expand ?? false });
        }
    }

    public async advancedFind(): Promise<void> {
        if (!this.checkActiveDoc('advancedFind')) {
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

        if (searchText === undefined || !this.checkActiveDoc('advancedFind_exec')) {
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
            // TODO: implement translation search
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
        }

        this.refreshTree(undefined);

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

                    elemToFocus = elems.at(elemIdx)?.element;
                }
            }

            if (elemToFocus) {
                //await this.clearSelection();
                await this.revealElement(elemToFocus, { expand: true, select: true, focus: true });
            }
        }
    }

    public async revealElement(item: ITreeElement, options?: {
        select?: boolean; focus?: boolean; expand?: boolean | number
    }): Promise<void> {
        if (this.view && item) {
            options = options ?? {};
            await this.view.reveal(item, {
                select: options.select,
                focus: options.focus,
                expand: options.expand
            });
        } else {
            logger().log(this, 'debug', `revealElement -> TreeView is not available or item is undefined.`);
        }
    }

    public async clearSelection(reselect?: boolean): Promise<void> {
        appContext.clearTreeContextValues();
        reselect = reselect ?? false;

        if (!this.view || this.view.selection.length === 0) {
            return;
        }

        if (!this.checkActiveDoc('clearSelection')) {
            return;
        }

        let itemToUse: ITreeElement | undefined = this.view.selection[0];

        if (!itemToUse) {
            itemToUse = this.currentRootModel;
        }

        if (itemToUse) {
            try {
                // select 'lang root' to hack clear/set selection
                const langRoot = this.currentVirtualRootElement!.languagesRoot;
                await this.revealElement(langRoot, { select: true, focus: false, expand: false });

                if (reselect) {
                    await this.revealElement(itemToUse, { select: true, focus: true, expand: false });
                } else {
                    await this.revealElement(itemToUse, { select: false, focus: false, expand: false });
                }
            } catch (error) {
                console.error("Failed to clear selection using two-step reveal:", error);
            }
        }
    }

    public async selectRootElement(): Promise<void> {
        if (this.currentRootModel) {
            await this.setSelectedItems([this.currentRootModel!], { focus: true, expand: false });
        }
    }

    public async setSelectedItems(itemsToSelect: ITreeElement[], options?: { focus?: boolean; expand?: boolean | number }): Promise<void> {
        if (!this.view) {
            logger().log(this, 'debug', 'setSelectedItems -> TreeView is not available.');
            return;
        }

        if (!this.checkActiveDoc('setSelectedItems')) {
            return;
        }

        if (!itemsToSelect || itemsToSelect.length === 0) {
            return;
        }

        // select 'lang root' to hack clear/set selection
        const langRoot = this.currentVirtualRootElement!.languagesRoot;
        await this.revealElement(langRoot, { select: true, focus: false, expand: false });

        for (let i = 0; i < itemsToSelect.length; i++) {
            const item = itemsToSelect[i];
            const revealOptions = {
                select: true,
                focus: options?.focus !== undefined ? options.focus : (i === itemsToSelect.length - 1),
                expand: options?.expand !== undefined ? options.expand : false
            };
            try {
                await this.revealElement(item, revealOptions);
            } catch (error) {
                logger().log(this, 'error', `setSelectedItems -> Failed to reveal/select item '${getElementFullPath(item)}'`, error as Error);
            }
        }
    }

    public async handleDrag(source: ITreeElement[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const items = source.filter(x => x.elementType === 'category' || x.elementType === 'resource').map<DragTreeItem>(x => ({
            path: getElementFullPath(x),
            type: x.elementType as CategoryOrResourceType,
        }));

        if (items.length === 0 || _token.isCancellationRequested) {
            return Promise.reject();
        }

        if (!this.checkActiveDoc('handleDrag')) {
            return Promise.reject();
        }

        if (items.length === 1) {
            logger().log(this, 'debug', `handleDrag -> Dragging single item: ${items[0].path} [${items[0].type}]`);
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

    private checkActiveDoc(action: string): boolean {
        const docInvalid = !this._activeDoc || !this._activeDoc.isActive;
        if (docInvalid || !this.currentRootModel) {
            let msg = 'Current root model is not available.';
            if (docInvalid) {
                msg = this._activeDoc ? `Document ${this._activeDoc.fileName} is not active anymore.` : 'No active document found.';
            }
            logger().log(this, 'debug', `${action} -> ${msg}`);
            return false;
        }

        return true;
    }

    public async handleDrop(target: ITreeElement | undefined, sources: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        if (!this._activeDoc || !this._activeDoc.isActive) {
            logger().log(this, 'debug', 'handleDrop -> No active document found.');
            return;
        }

        if (!target || (target.elementType !== 'model' && target.elementType !== 'category')) {
            return;
        }

        const transferItem = sources.get('application/vnd.code.tree.lhqTreeView');
        // drag&drop can be cancelled by user
        if (!transferItem || _token.isCancellationRequested) {
            return;
        }

        const items: DragTreeItem[] = transferItem.value;
        // no items to drop
        if (!items || items.length === 0) {
            return;
        }

        if (!this._activeDoc) {
            return;
        }

        let sourceItems = this.getTreeItems(items);
        const itemCount = sourceItems.length;
        const firstParent = sourceItems[0].parent;
        const elemText = `${itemCount} element(s)`;

        logger().log(this, 'debug', `handleDrop -> Dropped single item: ${items[0].path} [${items[0].type}]`);

        if (target.elementType === 'model' && !this.resourcesUnderRoot && sourceItems.some(x => x.elementType === 'resource')) {
            const detail = `Cannot move ${elemText} to root element '${getElementFullPath(target)}'.\n\n` +
                `NOTE: 'Resources under root' can be enabled in project properties.`;
            return await showMessageBox('warn', `Resources are not allowed under root!`, detail);
        }

        // diff parents
        if (sourceItems.length > 1) {
            if (!sourceItems.every(item => item.parent === firstParent)) {
                showNotificationBox('warn', `Cannot move ${elemText} with different parents.`);
                return;
            }
        }

        // move to the same parent
        if (target === firstParent) {
            showNotificationBox('warn', `Cannot move ${elemText} to the same parent element '${getElementFullPath(target)}'.`);
            return;
        }

        const targetElement = target as ICategoryLikeTreeElement;
        // filter out items (by name and element type) that are already in the target element
        sourceItems = sourceItems.filter(x => !targetElement.contains(x.name, x.elementType as CategoryOrResourceType));

        // reveal target element
        await this.revealElement(targetElement, { expand: true, select: false, focus: false });

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

                if (!changed) {
                    logger().log(this, 'debug', `handleDrop -> ${item.elementType} '${oldPath}' move to '${getElementFullPath(item)}', failed to change parent.`);
                }
            }
        });

        if (changedCount > 0) {
            await this._activeDoc.commitChanges('handleDrop');

            this.refreshTree(undefined);
            const toFocus = sourceItems.length === 1 ? sourceItems[0] : targetElement;
            await this.revealElement(toFocus, { expand: true, select: true, focus: true });

            const moved = sourceItems.length === 1
                ? `${sourceItems[0].elementType} '${getElementFullPath(sourceItems[0])}'`
                : `${sourceItems.length} element(s)`;

            showNotificationBox('info', `Moved ${moved} under '${getElementFullPath(target)}'`);
        }
    }

    public updateDocument(docCtx: IDocumentContext): void {
        this._activeDoc = docCtx;

        if (docCtx) {
            const baseName = path.basename(docCtx.fileName);
            this.view.title = `${baseName}`;
        } else {
            this.view.title = `LHQ Structure`;
            void this.clearSelection();
        }

        this.refreshTree(undefined);
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
            if (this._loadingNodeVisible) {
                result.push(this._loadingTreeElement);
            } else {
                result.push(this.currentVirtualRootElement!.languagesRoot);
                result.push(this.currentRootModel);
            }
        }

        return Promise.resolve(result);
    }

    getParent(element: ITreeElement): vscode.ProviderResult<ITreeElement> {
        if (isVirtualTreeElement(element)) {
            if (element instanceof VirtualTreeElement) {
                logger().log(this, 'debug', `getParent -> VirtualTreeElement '${element.name}' [${element.virtualElementType}] has no parent.`);
            }
            //debugger;
            //console.warn('!!!!!');
        }
        return element.parent;
    }

    public showLoading(text: string): Promise<void> {
        return new Promise((resolve) => {
            if (this._loadingNodeVisible) {
                return resolve();
            }

            this._loadingTreeElement.name = text;
            this._loadingNodeVisible = true;
            setTimeout(() => {
                try {
                    if (this._loadingNodeVisible) {
                        this._loadingNodeVisible = false;
                        this.refreshTree(undefined);
                    }
                } finally {
                    return resolve();
                }

            }, loadingNodeVisibleTimeout);

            this.refreshTree(undefined);
        });
    }

    public backupSelection(): SelectionBackup {
        return this.selectedElements.map(x => ({
            type: x.elementType,
            fullPath: getElementFullPath(x),
        }));
    }

    public getElementsFromSelection(selection: SelectionBackup): ITreeElement[] {
        const root = this.currentRootModel!;
        const restoredElements: ITreeElement[] = [];
        selection.forEach(item => {
            const paths = createTreeElementPaths(item.fullPath);
            const elem = item.type === 'model' ? root : root.getElementByPath(paths, item.type);
            if (elem) {
                restoredElements.push(elem);
            }
        });

        return restoredElements;
    }

    public async restoreSelection(selection: SelectionBackup): Promise<void> {
        if (!this.checkActiveDoc('restoreSelection') || !selection || selection.length === 0) {
            return;
        }

        const restoredElements = this.getElementsFromSelection(selection);
        // await this.clearSelection();
        await this.setSelectedItems(restoredElements);
    }
}