import * as vscode from 'vscode';
import type { CategoryOrResourceType, FormattingOptions, ICategoryLikeTreeElement, IRootModelElement, ITreeElement, ITreeElementPaths, LhqModel, LhqValidationResult, TreeElementType } from '@lhq/lhq-generators';
import { arraySortBy, detectFormatting, generatorUtils, isNullOrEmpty, ModelUtils } from '@lhq/lhq-generators';
import { createTreeElementPaths, delay, findChildsByPaths, getElementFullPath, getMessageBoxText, isEditorActive, isValidDocument, logger, matchForSubstring, setEditorActive, setTreeViewHasSelectedItem, showMessageBox } from './utils';
import { LhqTreeItem } from './treeItem';
import { validateName } from './validator';
import { isVirtualTreeElement, SearchTreeKind, SearchTreeOptions, VirtualRootElement } from './elements';

const actions = {
    refresh: 'lhqTreeView.refresh',
    addItem: 'lhqTreeView.addItem',
    renameItem: 'lhqTreeView.renameItem',
    deleteItem: 'lhqTreeView.deleteItem',
    findInTreeView: 'lhqTreeView.findInTreeView',
    advancedFind: 'lhqTreeView.advancedFind'
};

type DragTreeItem = {
    path: string;
    type: CategoryOrResourceType;
}

const themeIcons = {
    structure: 'list-tree',
    nameAndDesc: 'files',
    translated: 'globe',
    language: 'debug-breakpoint-log',
    clearAll: 'clear-all'
};

interface SearchQuickPickItem extends vscode.QuickPickItem {
    searchKind?: SearchTreeKind;
}

export class LhqTreeDataProvider implements vscode.TreeDataProvider<ITreeElement>,
    vscode.TreeDragAndDropController<ITreeElement> {
    dropMimeTypes = ['application/vnd.code.tree.lhqTreeView'];
    dragMimeTypes = ['text/uri-list'];

    // flag whenever that last active editor (not null) is other type than LHQ (tasks window, etc...)
    private _lastActiveEditorNonLhq = false;
    private _currentSearch: SearchTreeOptions = {
        searchText: '',
        type: 'name',
        uid: crypto.randomUUID()
    };

    private _onDidChangeTreeData: vscode.EventEmitter<(ITreeElement | undefined)[] | undefined> = new vscode.EventEmitter<ITreeElement[] | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    private currentRootModel: IRootModelElement | null = null;
    private currentVirtualRootElement: VirtualRootElement | null = null;
    private currentDocument: vscode.TextDocument | null = null;
    private currentJsonModel: LhqModel | null = null;
    private currentFormatting: FormattingOptions = { indentation: { amount: 2, type: 'space', indent: '  ' }, eol: '\n' };
    private selectedElement: ITreeElement | undefined = undefined;
    private view: vscode.TreeView<any>;

    constructor(private context: vscode.ExtensionContext) {

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(e => this.onActiveEditorChanged(e)),
            vscode.window.onDidChangeVisibleTextEditors(e => this.onDidChangeVisibleTextEditors(e)),

            vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
            vscode.workspace.onDidOpenTextDocument(e => this.onDidOpenTextDocument(e)),

            vscode.commands.registerCommand(actions.refresh, () => this.refresh()),
            vscode.commands.registerCommand(actions.addItem, args => this.addItem(args)),
            vscode.commands.registerCommand(actions.renameItem, args => this.renameItem(args)),
            vscode.commands.registerCommand(actions.deleteItem, args => this.deleteItem(args)),
            vscode.commands.registerCommand(actions.findInTreeView, () => this.findInTreeView()),
            vscode.commands.registerCommand(actions.advancedFind, () => this.advancedFind())
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
                const element = e.selection && e.selection.length > 0 ? e.selection[0] : undefined;
                this.selectedElement = element;
                logger().log('debug', `LhqTreeDataProvider.setSelectedElement: ${element ? getElementFullPath(element) : '-'}`);
                setTreeViewHasSelectedItem(!isNullOrEmpty(element));
            })
        );
    }

    private async advancedFind(): Promise<any> {
        const prompt = 'Enter search text (empty to clear search)';
        const placeHolder = 'Use # to filter by name/description, / for path, @ for language, ! for translations';

        let searchText = await vscode.window.showInputBox({
            prompt,
            ignoreFocusOut: true,
            placeHolder,
            value: this._currentSearch.searchText,
            title: getMessageBoxText('Advanced search in LHQ structure')
        });

        if (searchText === undefined) {
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
                this._currentSearch = { type: 'path', searchText, paths, elems, uid: searchUid, elemIdx };
            }
        } else if (searchText.startsWith('@')) { // by language
            this._currentSearch = { type: 'language', searchText, filter: searchText.substring(1), uid: searchUid };
        } else if (searchText.startsWith('!')) { // by translation
            this._currentSearch = { type: 'translation', searchText, filter: searchText.substring(1), uid: searchUid };
        } else { // by name or description
            // # or other...
            const filter = searchText.startsWith('#') ? searchText.substring(1) : searchText;

            if (sameSearch) {
            } else {
                ModelUtils.iterateTree(this.currentRootModel!, (elem) => {
                    const match = matchForSubstring(elem.name, filter, true);
                    if (match.match !== 'none') {
                        
                    }
                });
            }

            this._currentSearch = { type: 'name', searchText, filter, last, uid: searchUid };
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
                    const elems = this._currentSearch.elems;
                    if (elems && elems.length > 0) {
                        let elemIdx = 0;
                        if (sameSearch) {
                            elemIdx = (this._currentSearch.elemIdx ?? -1) + 1;
                            elemIdx = elemIdx >= elems.length ? 0 : elemIdx;
                        }
                        this._currentSearch.elemIdx = elemIdx;

                        const sortedElems = arraySortBy(elems, x => x.leaf ? 0 : 1, 'asc');
                        elemToFocus = sortedElems.at(elemIdx)?.element;
                    }
                }
            }

            if (elemToFocus) {
                await this.view.reveal(elemToFocus, { expand: true, select: false, focus: true });
            }
        }
    }

    async findInTreeView(): Promise<any> {
        await vscode.commands.executeCommand('lhqTreeView.focus'); // Focus the tree view itself
        await vscode.commands.executeCommand('list.find', 'lhqTreeView');
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

    // private setSelectedElement(element: ITreeElement | undefined): void {
    //     this.selectedElement = element;
    //     logger().log('debug', `LhqTreeDataProvider.setSelectedElement: ${element ? getElementFullPath(element) : '-'}`);
    //     setTreeViewHasSelectedItem(!isNullOrEmpty(element));
    // }

    private get selectedCategoryLike(): ICategoryLikeTreeElement | undefined {
        let element = this.selectedElement ?? this.currentRootModel;
        if (!element) {
            return undefined;
        }

        if (element.elementType === 'resource') {
            element = element.parent ?? this.currentRootModel;
        }

        return element as ICategoryLikeTreeElement;
    }

    public async handleDrag(source: ITreeElement[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const items = source.filter(x => x.elementType !== 'model').map<DragTreeItem>(x => ({
            path: getElementFullPath(x),
            type: x.elementType as CategoryOrResourceType,
        }));

        if (items.length === 0 || _token.isCancellationRequested) {
            return Promise.reject();
        }

        treeDataTransfer.set('application/vnd.code.tree.lhqTreeView', new vscode.DataTransferItem(items));
    }

    private getTreeItems(source: DragTreeItem[]): ITreeElement[] {
        return isNullOrEmpty(this.currentRootModel)
            ? []
            : source.map(item => {
                const treeItem = this.currentRootModel!.getElementByPath(createTreeElementPaths(item.path), item.type);
                return treeItem;
            }).filter(item => item !== undefined && item.elementType !== 'model') as ITreeElement[];
    }

    public async handleDrop(target: ITreeElement | undefined, sources: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        if (!target || target.elementType === 'resource') {
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
                showMessageBox('warn', `Cannot move ${elemText} with different parents.`);
                return;
            }
        }

        if (target === firstParent) {
            showMessageBox('warn', `Cannot move ${elemText} to the same parent element '${getElementFullPath(target)}'.`);
            return;
        }

        const targetElement = target as ICategoryLikeTreeElement;

        sourceItems = sourceItems.filter(x => !targetElement.contains(x.name, x.elementType as CategoryOrResourceType));

        // sourceItems.forEach(item => {
        //     const containsElement = targetElement.hasElement(item.name, item.elementType as CategoryOrResourceType);
        //     if (!containsElement) {
        //         const oldPath = getElementFullPath(item);
        //         const changed = item.changeParent(targetElement);
        //         logger().log('debug', `LhqTreeDataProvider.handleDrop: ${item.elementType} '${oldPath}' moved to '${getElementFullPath(item)}', successfully: ${changed}`);
        //     }
        // });

        // // move JSON properties in text document
        // const documentText = this.currentDocument.getText();
        // const workspaceEdits: vscode.TextEdit[] = [];

        // sourceItems.forEach(sourceItem => {
        //     try {
        //         const edits = moveOrDeleteJsonProperty('move', sourceItem, targetElement, documentText, this.currentIndentation);
        //         if (edits) {
        //             edits.forEach(edit => {
        //                 workspaceEdits.push(new vscode.TextEdit(
        //                     new vscode.Range(
        //                         this.currentDocument!.positionAt(edit.offset),
        //                         this.currentDocument!.positionAt(edit.offset + edit.length)
        //                     ),
        //                     edit.content
        //                 ));
        //             });
        //         }

        //     } catch (error) {
        //         logger().log('error', 'move json property error', error as Error);
        //     }
        // });


        if (targetElement) {
            this.view.reveal(targetElement, { expand: true, select: false, focus: false });
        }
    }

    private async deleteItem(element: ITreeElement): Promise<void> {
        if (!this.currentDocument) {
            showMessageBox('info', 'No active document to rename item in.');
            return;
        }

        element = element || this.selectedElement;

        const elementName = element.name;
        const elemPath = getElementFullPath(element);

        const confirmation = await showMessageBox('info',
            `Delete ${element.elementType} "${elementName}" ?`,
            { modal: true, detail: elemPath },
            'Yes',
            'No'
        );

        if (confirmation !== 'Yes') {
            return;
        }

        // const documentText = this.currentDocument.getText();
        // let edits: EditResult | undefined;
        // try {
        //     edits = moveOrDeleteJsonProperty('delete', element, undefined, documentText, this.currentIndentation);
        //     if (!edits) {
        //         //logger().log('debug', `DeleteItem: jsonc-parser 'modify' produced no edits for path '${elemPath}' and new name '${newName}'. This might happen if the path is incorrect or value is already set.`);
        //         showMessageBox('info', 'No changes were applied. The name might already be set or the item structure is unexpected.');
        //         return;
        //     }
        // } catch (error) {
        //     logger().log('error', `DeleteItem: Error while deleting item ${elemPath}`, error as Error);
        //     showMessageBox('err', `Error while deleting item ${elemPath}: ${(error as Error).message}`);
        //     return;
        // }

        // const workspaceEdits: vscode.TextEdit[] = edits.map(edit =>
        //     new vscode.TextEdit(
        //         new vscode.Range(
        //             this.currentDocument!.positionAt(edit.offset),
        //             this.currentDocument!.positionAt(edit.offset + edit.length)
        //         ),
        //         edit.content
        //     )
        // );

        // const workspaceEdit = new vscode.WorkspaceEdit();
        // workspaceEdit.set(this.currentDocument.uri, workspaceEdits);

        // const success = await vscode.workspace.applyEdit(workspaceEdit);

        const parent = element.parent ?? element.root;
        parent.removeElement(element);
        const success = await this.updateTextDocument();

        if (!success) {
            logger().log('error', `DeleteItem: vscode.workspace.applyEdit failed for ${elemPath}`);
            showMessageBox('err', `Failed to delete item ${elemPath}.`);
        }
    }

    private validateElementName(elementType: TreeElementType, name: string, ignoreElementPath?: string): string | null {
        const valRes = validateName(name);
        if (valRes === 'valid') {
            if (this.selectedCategoryLike && !isNullOrEmpty(name)) {
                const found = this.selectedCategoryLike.find(name, elementType as CategoryOrResourceType);
                if (found && (!ignoreElementPath || getElementFullPath(found) !== ignoreElementPath)) {
                    const root = this.selectedCategoryLike.elementType === 'model' ? '/' : getElementFullPath(this.selectedCategoryLike);
                    return `${elementType} '${name}' already exists in ${root}`;
                }

                // if (this.selectedCategoryLike.contains(name, elementType as CategoryOrResourceType)) {
                //     const root = this.selectedCategoryLike.elementType === 'model' ? '/' : getElementFullPath(this.selectedCategoryLike);
                //     return `${elementType} '${name}' already exists in ${root}`;
                // }
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
        if (element && element !== this.selectedElement) {
            await this.setSelectedItems([element], { focus: true, expand: false });
        }

        //element = this.selectedElement || element;
        if (!this.currentDocument || !element) {
            return;
        }

        const originalName = element.name;
        const elemPath = getElementFullPath(element);

        const elementType = element.elementType;
        const newName = await vscode.window.showInputBox({
            prompt: `Enter new name for ${elementType} '${originalName}' (${elemPath})`,
            value: originalName,
            validateInput: value => this.validateElementName(elementType, value, elemPath)
        });

        if (!newName || newName === originalName) {
            return;
        }

        const validationError = this.validateElementName(elementType, newName);
        if (validationError) {
            showMessageBox('warn', validationError);
            return;

        }

        // const documentText = this.currentDocument.getText();
        // let edits: EditResult | undefined;
        // try {
        //     edits = renameJsonProperty(element, newName, documentText, this.documentIndent);
        //     if (!edits) {
        //         logger().log('debug', `RenameItem: jsonc-parser 'modify' produced no edits for path '${elemPath}' and new name '${newName}'. This might happen if the path is incorrect or value is already set.`);
        //         showMessageBox('info', 'No changes were applied. The name might already be set or the item structure is unexpected.');
        //         return;
        //     }
        // } catch (error) {
        //     logger().log('error', `RenameItem: Error while renaming item '${originalName}' to '${newName}' (${elemPath})`, error as Error);
        //     showMessageBox('err', `Error while renaming item '${originalName}' to '${newName}': ${(error as Error).message}`);
        //     return;
        // }

        // const workspaceEdits: vscode.TextEdit[] = edits.map(edit =>
        //     new vscode.TextEdit(
        //         new vscode.Range(
        //             this.currentDocument!.positionAt(edit.offset),
        //             this.currentDocument!.positionAt(edit.offset + edit.length)
        //         ),
        //         edit.content
        //     )
        // );

        element.name = newName;
        const success = await this.updateTextDocument();


        // const workspaceEdit = new vscode.WorkspaceEdit();
        // workspaceEdit.set(this.currentDocument.uri, workspaceEdits);

        // const success = await vscode.workspace.applyEdit(workspaceEdit);
        // if (success) {
        //     element.name = newName;
        // }

        //this._onDidChangeTreeData.fire([element]);

        if (!success) {
            logger().log('error', `RenameItem: vscode.workspace.applyEdit failed for '${originalName}' to '${newName}' (${elemPath})`);
            showMessageBox('err', `Failed to apply rename for item '${originalName}'.`);
        }
    }

    private updateTextDocument(): Thenable<boolean> {
        const serializedRoot = ModelUtils.serializeTreeElement(this.currentRootModel!, this.currentFormatting);
        const edit = new vscode.WorkspaceEdit();
        const doc = this.currentDocument!;
        edit.replace(
            doc.uri,
            new vscode.Range(0, 0, doc.lineCount, 0),
            serializedRoot);

        return vscode.workspace.applyEdit(edit);
    }

    private async addItem(element: ITreeElement): Promise<any> {
        if (element && element !== this.selectedElement) {
            await this.setSelectedItems([element], { focus: true, expand: false });
        }
        //let element = this.selectedElement ?? this.currentRootModel!;
        element = element ?? this.currentRootModel!;
        if (!this.currentDocument || !element) {
            return;
        }

        if (element.elementType === 'resource') {
            element = element.parent || element.root;
        }

        const elemPath = getElementFullPath(element);

        const itemType = await vscode.window.showQuickPick([
            {
                label: 'Category',
                elementType: 'category' as TreeElementType
            },
            {
                label: 'Resource',
                elementType: 'resource' as TreeElementType
            }
        ], { placeHolder: `Select element type to add under ${elemPath}` });

        if (!itemType) {
            return;
        }

        setTimeout(() => {
            void this.addItemComplete(element, itemType.elementType);
        }, 100);
    }

    async addItemComplete(parent: ITreeElement, elementType: TreeElementType) {
        const elemPath = getElementFullPath(parent);
        const itemName = await vscode.window.showInputBox({
            prompt: `Enter new ${elementType} name (${elemPath})`,
            ignoreFocusOut: true,
            validateInput: value => this.validateElementName(elementType, value)
        });

        if (!itemName) {
            return;
        }

        const validationError = this.validateElementName(elementType, itemName);
        if (validationError) {
            showMessageBox('warn', validationError);
            return;

        }

        const isResource = elementType === 'resource';
        const parentCategory = parent as ICategoryLikeTreeElement;
        let newElement: ITreeElement;
        if (isResource) {
            newElement = parentCategory.addResource(itemName);
        } else {
            newElement = parentCategory.addCategory(itemName);
        }

        await this.updateTextDocument();
        this._onDidChangeTreeData.fire([parent]);
        //await this.view.reveal(element, { expand: true, select: false, focus: false });
        await this.view.reveal(newElement, { expand: true, select: true, focus: true });

        showMessageBox('info', `Added new ${elementType} '${itemName}' under '${getElementFullPath(parent)}'`);
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
        return this.currentDocument !== null && isEditorActive();
    }

    private get documentPath(): string {
        return this.currentDocument ? this.currentDocument.uri.fsPath : '';
    }

    public isSameDocument(document: vscode.TextDocument): boolean {
        return this.currentDocument !== null && this.currentDocument.uri.toString() === document.uri.toString();
    }

    public updateDocument(document: vscode.TextDocument | undefined, forceRefresh = false): void {
        if (document && !isValidDocument(document)) {
            this._lastActiveEditorNonLhq = true;
            // logger().log('debug', `LhqTreeDataProvider.updateDocument skipped due to invalid document.`);
            return;
        }

        // logger().log('debug', `LhqTreeDataProvider.updateDocument with: ${document?.fileName ?? '-'}`);
        if (isValidDocument(document)) {
            setEditorActive(true);
            if (this.currentDocument?.uri.toString() !== document.uri.toString() || !this.currentRootModel || forceRefresh === true) {
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
            this.currentJsonModel = null;

            // setTimeout(() => {
            //     test1();
            // }, 10);

            this.currentRootModel = null;
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
                showMessageBox('err', error);
            }

            if (this.currentJsonModel) {
                let validateResult: LhqValidationResult | undefined;

                try {
                    validateResult = generatorUtils.validateLhqModel(this.currentJsonModel);
                    if (validateResult.success && validateResult.model) {
                        this.currentRootModel = ModelUtils.createRootElement(validateResult.model);
                        this.currentVirtualRootElement = new VirtualRootElement(this.currentRootModel);
                    } else {
                        this.currentJsonModel = null;
                    }
                } catch (ex) {
                    this.currentJsonModel = null;
                    const error = `Error validating LHQ file '${this.documentPath}': ${ex}`;
                    logger().log('error', error, ex as Error);
                    showMessageBox('err', error);
                }

                if (this.currentRootModel === null || this.currentRootModel === undefined) {
                    const error = validateResult
                        ? `Validation errors while parsing LHQ file '${this.documentPath}': \n${validateResult.error}`
                        : `Error validating LHQ file '${this.documentPath}'`;
                    logger().log('error', error);
                    showMessageBox('err', error);
                }
            }

        } else {
            this.currentRootModel = null;
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
                result.push(...this.currentVirtualRootElement!.languagesRoot.virtualLanguages);
            } else if (isVirtualTreeElement(element) || element.elementType === 'resource') {
                // nothing...
            } else {
                const categLikeElement = element as ICategoryLikeTreeElement;
                result.push(...categLikeElement.categories);
                result.push(...categLikeElement.resources);
            }
        } else {
            // If no element is provided, return the root(s)
            //result.push(this.currentRootModel);
            result.push(this.currentRootModel);
            result.push(this.currentVirtualRootElement!.languagesRoot);
        }

        return Promise.resolve(result);
    }

    getParent(element: ITreeElement): vscode.ProviderResult<ITreeElement> {
        if (isVirtualTreeElement(element)) {
            debugger;
            console.warn('!!!!!');
        }
        return element.parent;
    }
}