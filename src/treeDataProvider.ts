import path from 'node:path';
import { nextTick } from 'node:process';

import * as vscode from 'vscode';
import { QuickPickItemKind } from 'vscode';

import debounce from 'lodash.debounce';

import type {
    CategoryOrResourceType, FormattingOptions, ICategoryLikeTreeElement, IResourceElement, IResourceParameterElement, IResourceValueElement, IRootModelElement,
    ITreeElement, LhqModel, LhqModelResourceTranslationState, LhqValidationResult, TreeElementType
} from '@lhq/lhq-generators';
import { AppError, detectFormatting, Generator, generatorUtils, isNullOrEmpty, ModelUtils } from '@lhq/lhq-generators';

import { LhqTreeItem } from './treeItem';
import { validateName } from './validator';
import { filterTreeElements, filterVirtualTreeElements, isVirtualTreeElement, VirtualRootElement } from './elements';
import type { SearchTreeOptions, MatchingElement, CultureInfo, IVirtualLanguageElement, ValidationError, ITreeContext, ClientPageError, SelectionBackup, ClientPageModelProperties, ClientPageSettingsError, CodeGeneratorStatusInfo, CodeGeneratorStatusKind } from './types';
import {
    getMessageBoxText, createTreeElementPaths, findChildsByPaths, matchForSubstring,
    logger, getElementFullPath, showMessageBox, getCultureDesc, showConfirmBox, loadCultures, isValidDocument,
    DefaultFormattingOptions
} from './utils';
import { Commands, ContextEvents } from './context';


type DragTreeItem = {
    path: string;
    type: CategoryOrResourceType;
}


interface LanguageQuickPickItem extends vscode.QuickPickItem {
    culture: CultureInfo;
}

type LangTypeMode = 'all' | 'neutral' | 'country';

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


type LastLhqStatus = {
    kind: CodeGeneratorStatusKind;
    uid: string;
}

export class LhqTreeDataProvider implements vscode.TreeDataProvider<ITreeElement>,
    vscode.TreeDragAndDropController<ITreeElement>, ITreeContext {
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

    private _lastLhqStatus: LastLhqStatus | undefined;

    private _onDidChangeTreeData: vscode.EventEmitter<(ITreeElement | undefined)[] | undefined> = new vscode.EventEmitter<ITreeElement[] | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    private _currentRootModel: IRootModelElement | undefined;
    private currentVirtualRootElement: VirtualRootElement | null = null;
    private currentDocument: vscode.TextDocument | null = null;
    private currentJsonModel: LhqModel | null = null;
    private currentFormatting: FormattingOptions = DefaultFormattingOptions;
    private selectedElements: ITreeElement[] = [];
    private view: vscode.TreeView<any>;
    private _validationError: ValidationError | undefined;
    private _pageErrors: ClientPageError[] = [];

    private _codeGeneratorStatus: vscode.StatusBarItem;
    private _debouncedRunCodeGenerator: () => void;
    private _codeGeneratorInProgress = false;

    constructor(private context: vscode.ExtensionContext) {
        appContext.on(ContextEvents.isEditorActiveChanged, (active: boolean) => {
            if (active) {
                this._codeGeneratorStatus.show();
            } else {
                this._codeGeneratorStatus.hide();
            }
        });

        this._codeGeneratorStatus = vscode.window.createStatusBarItem('lhq.codeGeneratorStatus', vscode.StatusBarAlignment.Left, 10);
        this.updateGeneratorStatus({ kind: 'idle' });

        this._codeGeneratorInProgress = false;
        this._debouncedRunCodeGenerator = debounce(this.runCodeGenerator.bind(this), 200, { leading: true, trailing: false });

        context.subscriptions.push(
            vscode.commands.registerCommand(Commands.addElement, args => this.addItem(args)),
            vscode.commands.registerCommand(Commands.renameElement, args => this.renameItem(args)),
            vscode.commands.registerCommand(Commands.deleteElement, args => this.deleteElement(args)),
            vscode.commands.registerCommand(Commands.findInTreeView, () => this.findInTreeView()),
            vscode.commands.registerCommand(Commands.advancedFind, () => this.advancedFind()),
            vscode.commands.registerCommand(Commands.addCategory, args => this.addCategory(args)),
            vscode.commands.registerCommand(Commands.addResource, args => this.addResource(args)),
            vscode.commands.registerCommand(Commands.addLanguage, args => this.addLanguage(args)),
            vscode.commands.registerCommand(Commands.deleteLanguage, args => this.deleteLanguage(args)),
            vscode.commands.registerCommand(Commands.markLanguageAsPrimary, args => this.markLanguageAsPrimary(args)),
            vscode.commands.registerCommand(Commands.showLanguages, () => this.toggleLanguages(true)),
            vscode.commands.registerCommand(Commands.hideLanguages, () => this.toggleLanguages(false)),
            vscode.commands.registerCommand(Commands.projectProperties, () => this.projectProperties()),
            vscode.commands.registerCommand(Commands.runGenerator, () => this._debouncedRunCodeGenerator()),
            this._codeGeneratorStatus
        );

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
    }

    private get resourcesUnderRoot(): boolean {
        return this._currentRootModel?.options.resources === 'All';
    }

    private get isTreeStructure(): boolean {
        return this._currentRootModel?.options.categories === true;
    }

    public get currentRootModel(): IRootModelElement | undefined {
        return this._currentRootModel;
    }

    public async saveModelProperties(modelProperties: ClientPageModelProperties): Promise<ClientPageSettingsError | undefined> {
        if (!this._currentRootModel || !modelProperties) {
            return;
        }

        const root = this._currentRootModel;

        root.options.categories = modelProperties.categories;
        root.options.resources = modelProperties.categories ? modelProperties.resources : 'All';

        const templateId = modelProperties.codeGenerator.templateId;

        const validateResult = ModelUtils
            .getCodeGeneratorSettingsConvertor()
            .validateSettings(templateId, modelProperties.codeGenerator.settings);

        if (!isNullOrEmpty(validateResult.error)) {
            return {
                group: validateResult.group,
                name: validateResult.property,
                message: validateResult.error
            };
        }

        const codeGenerator = ModelUtils.createCodeGeneratorElement(templateId, modelProperties.codeGenerator.settings);
        root.codeGenerator = codeGenerator;

        const success = await this.applyChangesToTextDocument();

        if (success) {
            void showMessageBox('info', 'Project properties changes was applied.');
        }

        return undefined;
    }

    private get codeGeneratorTemplateId(): string | '' {
        return this._currentRootModel?.codeGenerator?.templateId ?? '';
    }

    // returns uid of this status update
    private updateGeneratorStatus(info: CodeGeneratorStatusInfo): string {
        const templateId = this.codeGeneratorTemplateId;

        let text = '';
        let tooltip: string | undefined;
        let command: string | undefined;
        let backgroundId: string | undefined;
        let colorId: string | undefined;
        const result = crypto.randomUUID();

        this._lastLhqStatus = {
            kind: info.kind,
            uid: result
        };

        const suffix = ' (lhq-editor)';
        let textSuffix = true;

        switch (info.kind) {
            case 'active':
                text = `$(sync~spin) LHQ generating code for ${info.filename}`;
                tooltip = `Running code generator template **${templateId}** ...`;
                break;

            case 'idle':
                textSuffix = false;
                text = '$(run-all) LHQ';
                command = Commands.runGenerator;
                // tooltip = `[LHQ] Click to run code generator template \`${templateId}\``;
                tooltip = `Click to run code generator template **${templateId}**`;
                break;

            case 'error':
                text = `$(error) ${info.message}`;
                backgroundId = 'statusBarItem.errorBackground';
                colorId = 'statusBarItem.errorForeground';
                command = Commands.showOutput;
                tooltip = `Click to see error details in output panel `;
                break;

            case 'status':
                text = info.success ? `$(check) ${info.message}` : `$(error) ${info.message}`;
                backgroundId = info.success
                    ? 'statusBarItem.prominentBackground'
                    : 'statusBarItem.errorBackground';
                colorId = info.success
                    ? 'statusBarItem.prominentForeground'
                    : 'statusBarItem.errorForeground';
                //command = info.success ? Commands.runGenerator : undefined;
                break;
            default:
                logger().log(this, 'debug', `updateGeneratorStatus -> Unknown status kind: ${JSON.stringify(info)}`);
        }

        if ((info.kind === 'error' || info.kind === 'status') && info.timeout && info.timeout > 0) {
            const uid = this._lastLhqStatus!.uid;
            setTimeout(() => {
                if (this._lastLhqStatus!.uid === uid) {
                    this.updateGeneratorStatus({ kind: 'idle' });
                }
            }, info.timeout);
        }

        this._codeGeneratorStatus.text = text + (textSuffix ? suffix : '');
        this._codeGeneratorStatus.backgroundColor = backgroundId === undefined ? undefined : new vscode.ThemeColor(backgroundId);
        this._codeGeneratorStatus.color = colorId === undefined ? undefined : new vscode.ThemeColor(colorId);
        this._codeGeneratorStatus.command = command;
        this._codeGeneratorStatus.tooltip = new vscode.MarkdownString(tooltip + suffix, true);

        return result;
    }

    private runCodeGenerator(): void {
        if (!this.currentDocument || !this.currentJsonModel) {
            logger().log(this, 'debug', 'runCodeGenerator -> No current document or model found.');
            return;
        }

        if (this._codeGeneratorInProgress) {
            logger().log(this, 'debug', '[LhqTreeDataProvider] runCodeGenerator -> Code generator is already in progress.');
            void showMessageBox('info', 'Code generator is already running ...');
            return;
        }

        const fileName = this.documentPath;
        if (isNullOrEmpty(fileName)) {
            logger().log(this, 'debug', `runCodeGenerator -> Document fileName is not valid (${fileName}). Cannot run code generator.`);
            return;
        }

        const templateId = this.codeGeneratorTemplateId;
        logger().log(this, 'info', `Running code generator template '${templateId}' for document: ${fileName}`);

        this._codeGeneratorInProgress = true;

        let beginStatusUid = '';
        let idleStatusOnEnd = true;

        try {
            beginStatusUid = this.updateGeneratorStatus({ kind: 'active', filename: fileName });

            const generator = new Generator();
            const result = generator.generate(fileName, this.currentJsonModel, {});

            if (result.generatedFiles) {
                const lhqFileFolder = path.dirname(fileName);
                const fileNames = result.generatedFiles.map(f => path.join(lhqFileFolder, f.fileName));
                logger().log(this, 'info', `Code generator template '${templateId}' successfully generated ${fileNames.length} files:\n` +
                    `${fileNames.join('\n')}`);

                this.updateGeneratorStatus({
                    kind: 'status',
                    message: `Generated ${result.generatedFiles.length} files.`,
                    success: true,
                    timeout: 2000
                });
            } else {
                this.updateGeneratorStatus({ kind: 'error', message: 'Error generating files.', timeout: 5000 });
            }
        }
        catch (error) {
            let msg = '';
            if (error instanceof AppError) {
                msg = error.message;
            }

            logger().log(this, 'error', `Code generator template '${templateId}' failed ${msg}`, error as Error);

            this.updateGeneratorStatus({ kind: 'error', message: `Error generating files. ${msg}` });
        } finally {
            this._codeGeneratorInProgress = false;

            if (idleStatusOnEnd) {
                setTimeout(() => {
                    if (beginStatusUid === this._lastLhqStatus?.uid) {
                        this.updateGeneratorStatus({ kind: 'idle' });
                    }
                }, 2000);
            }
        }
    }

    private async projectProperties(): Promise<void> {
        if (!this.currentDocument) {
            return;
        }

        appContext.sendMessageToHtmlPage({ command: 'showProperties' });
    }

    private toggleLanguages(visible: boolean): void {
        appContext.languagesVisible = visible;

        if (!this.currentVirtualRootElement) {
            return;
        }
        this.refresh();
    }

    public async selectElementByPath(elementType: TreeElementType, path: string[]): Promise<void> {
        if (!this.currentDocument || !this._currentRootModel) {
            return Promise.resolve();
        }

        const paths = createTreeElementPaths('/' + path.join('/'), true);
        const elem = elementType === 'model'
            ? this._currentRootModel
            : this._currentRootModel.getElementByPath(paths, elementType as CategoryOrResourceType);

        //const elemFullPath = paths.getParentPath('/', true);
        //const found = !isNullOrEmpty(elem);
        //logger().log(this, 'debug', `[LhqTreeDataProvider] selectElementByPath -> elementType: ${elementType}, paths: ${elemFullPath} -> found: ${found}`);

        if (elem) {
            await this.setSelectedItems([elem!]);
        }
    }

    public clearPageErrors(): void {
        this._pageErrors = [];
    }

    private setPageError(element: ITreeElement, field: string, message: string): void {
        const elemFullPath = getElementFullPath(element);
        const item = this._pageErrors.find(x => x.fullPath === elemFullPath && x.field === field);
        if (item) {
            item.message = message;
        } else {
            this._pageErrors.push({
                fullPath: elemFullPath,
                field,
                message
            });
        }
    }

    private hasPageError(element: ITreeElement, field: string): boolean {
        const elemFullPath = getElementFullPath(element);
        return this._pageErrors.some(x => x.fullPath === elemFullPath && x.field === field);
    }

    private removePageError(element: ITreeElement, field: string): boolean {
        const elemFullPath = getElementFullPath(element);
        const index = this._pageErrors.findIndex(x => x.fullPath === elemFullPath && x.field === field);
        if (index >= 0) {
            this._pageErrors.splice(index, 1);
        }
        return index >= 0;
    }

    public async updateElement(element: Record<string, unknown>): Promise<void> {
        if (!element || !this._currentRootModel || !this.currentDocument) {
            return;
        }

        const path = element.paths as string[];
        const elementType = element.elementType as TreeElementType;
        const paths = createTreeElementPaths('/' + path.join('/'), true);
        const elem = elementType === 'model'
            ? this._currentRootModel
            : this._currentRootModel.getElementByPath(paths, elementType as CategoryOrResourceType);

        interface ITranslationItem {
            valueRef: Partial<IResourceValueElement>;
            culture: CultureInfo;
            isPrimary: boolean;
        }

        //const elemFullPath = paths.getParentPath('/', true);
        //logger().log('debug', `[LhqTreeDataProvider] updateElement -> elementType: ${elementType}, paths: ${elemFullPath}`);

        if (elem && !isVirtualTreeElement(elem)) {
            const newName = (element.name as string ?? '').trim();

            const elemFullPath = getElementFullPath(elem);
            // always validate name
            const validationError = this.validateElementName(elementType, newName, elem.parent, elemFullPath);
            if (validationError) {
                this.setPageError(elem, 'name', validationError);

                appContext.sendMessageToHtmlPage({
                    command: 'invalidData',
                    fullPath: elemFullPath,
                    message: validationError,
                    action: 'add',
                    field: 'name'
                });
                return;
            } else {
                if (this.removePageError(elem, 'name')) {
                    appContext.sendMessageToHtmlPage({
                        command: 'invalidData',
                        fullPath: elemFullPath,
                        message: '',
                        action: 'remove',
                        field: 'name'
                    });
                }
            }

            let changed = false;
            if (newName !== elem.name) {
                elem.name = newName;
                changed = true;
            }

            const newDescription = element.description as string | undefined;
            if (newDescription !== elem.description) {
                elem.description = newDescription;
                changed = true;
            }

            if (elementType === 'resource') {
                const res = elem as IResourceElement;

                const newState = element.state as LhqModelResourceTranslationState ?? 'New';
                if (res.state !== newState) {
                    res.state = newState;
                    changed = true;
                }

                // parameters
                const oldParams = res.parameters.map(x => `${x.name}:${x.order}`).join(',');
                const params = element.parameters as Array<Partial<IResourceParameterElement>>;
                const newParams = params.map(x => `${x.name}:${x.order}`).join(',');

                if (newParams !== oldParams) {
                    changed = true;
                    res.removeParameters();
                    res.addParameters(params, { existing: 'skip' });
                }

                // values
                const oldValues = res.values.map(x => `${x.languageName}:${x.value}:${x.locked}`).join(',');
                const values: Array<Partial<IResourceValueElement>> = (element.translations as Array<ITranslationItem>)
                    .map(x => ({
                        languageName: x.valueRef.languageName,
                        value: x.valueRef.value,
                        locked: x.valueRef.locked
                    }));
                const newValues = values.map(x => `${x.languageName}:${x.value}:${x.locked}`).join(',');

                if (newValues !== oldValues) {
                    changed = true;
                    res.removeValues();
                    res.addValues(values, { existing: 'skip' });
                }
            }

            if (changed) {
                const success = await this.applyChangesToTextDocument();

                this._onDidChangeTreeData.fire([elem]);
                // if (this.selectedElements.length === 0) {
                //     await this.setSelectedItems([elem]);
                // }
                // await this.view.reveal(elem, { expand: true, select: true, focus: true });

                const elemPath = getElementFullPath(elem);
                if (!success) {
                    logger().log(this, 'error', `updateElement -> apply changes to document failed for: ${elemPath}`);
                    return await showMessageBox('err', `Failed to apply changes.`);
                } else {
                    if (elemPath !== elemFullPath) {
                        appContext.sendMessageToHtmlPage({
                            command: 'updatePaths',
                            paths: elem.paths.getPaths(true)
                        });
                    }
                }
            } else {
                logger().log(this, 'debug', `updateElement -> No changes for element '${getElementFullPath(elem)}'.`);
            }
        } else {
            logger().log(this, 'debug', `updateElement -> Element not found or is virtual: ${path.join('/')}`);
        }
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
                const elems = findChildsByPaths(this._currentRootModel!, searchTreePaths!);
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

                this._currentRootModel!.iterateTree((elem, leaf) => {
                    let match = matchForSubstring(elem.name, filter, true);
                    if (match.match !== 'none') {
                        elems.push({ element: elem, match, leaf });
                    }
                });

                const elemIdx = -1;
                this._currentSearch = { type: 'name', searchText, elems, elemIdx, uid: searchUid };
            }
        }

        this._onDidChangeTreeData.fire(undefined);

        if (this._currentRootModel) {
            let elemToFocus: ITreeElement | undefined;

            if (this._currentSearch.type === 'language') {
                elemToFocus = this.currentVirtualRootElement!.languagesRoot.find(this._currentSearch.filter ?? '');
            } else if (this._currentSearch.type === 'path') {
                if (this._currentSearch.searchText === '/' || this._currentSearch.searchText === '\\') {
                    elemToFocus = this._currentRootModel;
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

    private async revealElement(item: ITreeElement, options: {
        select?: boolean;
        focus?: boolean; expand?: boolean | number
    } = {}): Promise<void> {
        if (this.view && item) {
            await this.view.reveal(item, {
                select: options.select,
                focus: options.focus,
                expand: options.expand
            });
        }
    }

    async findInTreeView(): Promise<any> {
        await vscode.commands.executeCommand('lhqTreeView.focus'); // Focus the tree view itself
        await vscode.commands.executeCommand('list.find', 'lhqTreeView');
    }

    public async clearSelection(reselect: boolean = false): Promise<void> {
        appContext.clearContextValues();

        if (!this.view || this.view.selection.length === 0) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        let itemToUse: ITreeElement | undefined = this.view.selection[0];

        if (!itemToUse) {
            itemToUse = this._currentRootModel;
        }

        if (itemToUse) {
            try {
                // select/deselect trick
                await this.revealElement(itemToUse, { select: true, focus: false, expand: false });
                await this.revealElement(itemToUse, { select: false, focus: false, expand: false });

                if (reselect) {
                    await this.revealElement(itemToUse, { select: true, focus: true, expand: false });
                }
            } catch (error) {
                console.error("Failed to clear selection using two-step reveal:", error);
            }
        }
    }

    public async selectRootElement(): Promise<void> {
        if (this._currentRootModel) {
            await this.setSelectedItems([this._currentRootModel!], { focus: true, expand: false });
        }
    }

    public async setSelectedItems(itemsToSelect: ITreeElement[], options?: { focus?: boolean; expand?: boolean | number }): Promise<void> {
        if (!this.view) {
            logger().log(this, 'debug', 'setSelectedItems -> TreeView is not available.');
            return;
        }

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        if (!itemsToSelect || itemsToSelect.length === 0) {
            // If you want to clear selection, there isn't a direct API.
            // One common way is to reveal a known "unselectable" or root item without selecting it,
            // or if the last reveal with select:true clears previous selections,
            // revealing a single item with select:true would effectively set the selection to just that item.
            // For now, this method will only add to selection or set it if items are provided.
            // To truly "clear" selection, you might need to manage it more complexly or rely on user interaction.
            //logger().log('debug', '[LhqTreeDataProvider] setSelectedItems -> No items provided to select.');
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
                await this.revealElement(item, revealOptions);
            } catch (error) {
                logger().log(this, 'error', `setSelectedItems -> Failed to reveal/select item '${getElementFullPath(item)}'`, error as Error);
            }
        }
    }

    private getCategoryLikeParent(element: ITreeElement): ICategoryLikeTreeElement | undefined {
        if (!element) {
            return undefined;
        }

        if (element.elementType === 'resource') {
            return element.parent ?? this._currentRootModel;
        }

        return element.parent;
    }

    public async handleDrag(source: ITreeElement[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const items = source.filter(x => x.elementType === 'category' || x.elementType === 'resource').map<DragTreeItem>(x => ({
            path: getElementFullPath(x),
            type: x.elementType as CategoryOrResourceType,
        }));

        if (items.length === 0 || _token.isCancellationRequested) {
            return Promise.reject();
        }

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        treeDataTransfer.set('application/vnd.code.tree.lhqTreeView', new vscode.DataTransferItem(items));
    }

    private getTreeItems(source: DragTreeItem[]): ITreeElement[] {
        const root = this._currentRootModel;
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
        // drag&drop can be cancelled by user
        if (!transferItem || _token.isCancellationRequested) {
            return;
        }

        const items: DragTreeItem[] = transferItem.value;
        // no items to drop
        if (!items || items.length === 0) {
            return;
        }

        // document was closed in the meantime
        if (!this.currentDocument) {
            return;
        }

        let sourceItems = this.getTreeItems(items);
        const itemCount = sourceItems.length;
        const firstParent = sourceItems[0].parent;
        const elemText = `${itemCount} element(s)`;

        if (target.elementType === 'model' && !this.resourcesUnderRoot && sourceItems.some(x => x.elementType === 'resource')) {
            return await showMessageBox('warn', `Resources are not allowed under root!`,
                {
                    detail: `Cannot move ${elemText} to root element '${getElementFullPath(target)}'.\n\n` +
                        `NOTE: 'Resources under root' can be enabled in project properties.`, modal: true
                });
        }

        // diff parents
        if (sourceItems.length > 1) {
            if (!sourceItems.every(item => item.parent === firstParent)) {
                return await showMessageBox('warn', `Cannot move ${elemText} with different parents.`);
            }
        }

        // move to the same parent
        if (target === firstParent) {
            return await showMessageBox('warn', `Cannot move ${elemText} to the same parent element '${getElementFullPath(target)}'.`);
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

        if (!await this.applyChangesToTextDocument()) {
            return;
        }

        this._onDidChangeTreeData.fire([target]);
        const toFocus = sourceItems.length === 1 ? sourceItems[0] : targetElement;
        await this.revealElement(toFocus, { expand: true, select: true, focus: true });

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

        if (this._currentRootModel!.primaryLanguage === langElement.name) {
            return await showMessageBox('info', `Language '${getCultureDesc(langElement.name)}' is already marked as primary.`);
        }

        if (!(await showConfirmBox(`Mark language '${getCultureDesc(langElement.name)}' as primary ?`))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        this._currentRootModel!.primaryLanguage = langElement.name;

        const success = await this.applyChangesToTextDocument();

        if (success) {
            //this.reflectSelectedElementToWebview();
            await this.clearSelection(true);
        }

        await showMessageBox(success ? 'info' : 'err', success
            ? `Successfully marked '${getCultureDesc(langElement.name)}' as primary language.`
            : `Failed to mark '${getCultureDesc(langElement.name)}' as primary language.`, { modal: !success });
    }

    private async deleteLanguage(element: ITreeElement): Promise<void> {
        if (!this.currentDocument) {
            return;
        }

        const selectedElems = element && this.selectedElements.length <= 1 ? [element] : this.selectedElements;
        const elemsToDelete = filterVirtualTreeElements<IVirtualLanguageElement>(selectedElems, 'language');
        const selectedCount = elemsToDelete.length;
        if (selectedCount === 0) { return; }

        const restCount = Math.max(0, this._currentRootModel!.languages.length - selectedCount);
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

        const root = this._currentRootModel!;
        elemsToDelete.forEach(elem => {
            if (!root.removeLanguage(elem.name)) {
                logger().log(this, 'error', `deleteLanguage -> Cannot delete language '${elem.name}' - not found in model.`);
            }
        });

        const success = await this.applyChangesToTextDocument();
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

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        logger().log(this, 'info', `Deleting ${elemIdent} ...`);

        let parentToSelect: ICategoryLikeTreeElement | undefined;
        let deletedCount = 0;
        let notDeletedCount = 0;
        elemsToDelete.forEach(elem => {
            const parent = this.getCategoryLikeParent(elem);
            if (parent) {
                if (elemsToDelete.length === 1) {
                    parentToSelect = parent;
                }
                parent.removeElement(elem);
                deletedCount++;
            } else {
                notDeletedCount++;
            }
        });

        const success = await this.applyChangesToTextDocument();

        logger().log(this, 'debug', `Deleting ${elemIdent} ${success ? 'suceed' : 'failed'} where ${deletedCount} element(s) was deleted` +
            (notDeletedCount > 0 ? ` and failed to delete ${notDeletedCount} elements (no parent found).` : '.'));

        this._onDidChangeTreeData.fire([parentToSelect]);
        if (parentToSelect) {
            await this.revealElement(parentToSelect, { expand: true, select: true });
        }

        await showMessageBox(success ? 'info' : 'err', success ? `Successfully deleted ${elemIdent}.` : `Failed to delete ${elemIdent}.`);
    }

    private validateElementName(elementType: TreeElementType, name: string, parentElement?: ICategoryLikeTreeElement, ignoreElementPath?: string): string | null {
        const valRes = validateName(name);
        if (valRes === 'valid') {
            if (parentElement && !isNullOrEmpty(name)) {
                const found = parentElement.find(name, elementType as CategoryOrResourceType);
                if (found && (!ignoreElementPath || getElementFullPath(found) !== ignoreElementPath)) {
                    const root = getElementFullPath(parentElement);
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

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        element.name = newName;
        const success = await this.applyChangesToTextDocument();

        this._onDidChangeTreeData.fire([element]);
        await this.revealElement(element, { expand: true, select: true, focus: true });


        if (!success) {
            const err = `Failed to rename ${elementType} '${originalName}' to '${newName}' (${elemPath})`;
            logger().log(this, 'error', err);
            return await showMessageBox('err', err);
        }
    }

    private async applyChangesToTextDocument(): Promise<boolean> {
        //logger().log(this, 'debug', `[LhqTreeDataProvider] applyChangesToTextDocument -> started (${this.documentPath})`);

        if (!this.currentDocument) {
            return Promise.resolve(false);
        }


        const validationResult = this.validateDocument();
        if (!validationResult.success) {
            logger().log(this, 'warn', ` applyChangesToTextDocument -> Validation failed: ${validationResult.error?.message}`);
        }

        // const serializedRoot = ModelUtils.serializeTreeElement(this._currentRootModel!, this.currentFormatting);
        const newModel = ModelUtils.elementToModel<LhqModel>(this._currentRootModel!);
        const serializedRoot = ModelUtils.serializeModel(newModel, this.currentFormatting);

        const edit = new vscode.WorkspaceEdit();
        const doc = this.currentDocument!;
        edit.replace(
            doc.uri,
            new vscode.Range(0, 0, doc.lineCount, 0),
            serializedRoot);

        const res = await vscode.workspace.applyEdit(edit);
        if (res) {
            this.currentJsonModel = newModel;
        }
        return res;
    }

    public get lastValidationError(): ValidationError | undefined {
        return this._validationError;
    }

    private validateDocument(): { success: boolean, error: ValidationError | undefined } {
        this._validationError = undefined;

        if (this._currentRootModel) {
            if (!this.resourcesUnderRoot && this._currentRootModel.resources.length > 0) {
                this._validationError = {
                    message: `Resources are not allowed under root!`,
                    detail: `Please change project properties to 'Allow resources under root' or move resources to categories.`
                };
            } else if (!this.isTreeStructure && this._currentRootModel.categories.length > 0) {
                this._validationError = {
                    message: `Categories are not allowed in flat structure!`,
                    detail: `Please change project properties 'Layout' to 'Hierarchical tree structure' or remove categories from the root.`
                };
            }
        }

        return { success: this._validationError === undefined, error: this._validationError };
    }

    private async addItem(element: ITreeElement, newItemType?: CategoryOrResourceType): Promise<any> {
        if (!this._currentRootModel) {
            return;
        }

        const selectedCount = this.selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        const rootModel = this._currentRootModel;

        function canCreateCategory(): boolean {
            if (!rootModel.options.categories) {
                void showMessageBox('info', `Cannot add new category!`, {
                    detail: `Categories are disabled in project properties. \nPlease enable 'Categories' in project properties to add new categories.`,
                    modal: true
                });
                return false;
            }

            return true;
        }

        if (newItemType === 'category' && !canCreateCategory()) {
            return;
        }

        if (element && selectedCount === 1 && element !== this.selectedElements[0]) {
            await this.setSelectedItems([element], { focus: true, expand: false });
        }

        element = element || (this.selectedElements.length > 0 ? this.selectedElements[0] : undefined);
        element = element ?? rootModel!;

        if (!this.currentDocument || !element) {
            return;
        }

        if (element.elementType === 'resource') {
            element = element.parent || element.root;
        }

        function canCreateResource(): boolean {
            if (rootModel.options.resources === 'Categories' && element.isRoot) {
                void showMessageBox('info', `Cannot add new resource!`, {
                    detail: `Resources are under root are not allowed (only under category).\n` +
                        `Please enable 'Resources under root' in project properties.`,
                    modal: true
                });

                return false;
            }

            return true;
        }

        if (newItemType === 'resource' && !canCreateResource()) {
            return;
        }

        const elemPath = getElementFullPath(element);
        const showSelector = isNullOrEmpty(newItemType);

        const itemType = showSelector
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

        if (showSelector && (
            (itemType.elementType === 'category' && !canCreateCategory()) ||
            (itemType.elementType === 'resource' && !canCreateResource())
        )) {
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

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        const added: string[] = [];
        result.map(item => item.culture.name).forEach(cultureName => {
            if (this._currentRootModel?.addLanguage(cultureName)) {
                const culture = cultures[cultureName];
                if (culture) {
                    added.push(`${culture.engName} (${culture.name})`);
                }
            }
        });

        await this.applyChangesToTextDocument();

        this._onDidChangeTreeData.fire([langRoot]);
        await this.revealElement(langRoot, { expand: true, select: true, focus: true });

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

        // after previous await, document can be closed now...
        if (!this.currentDocument) {
            return;
        }

        const validationError = this.validateElementName(elementType, itemName, parentCategory);
        if (validationError) {
            return await showMessageBox('warn', validationError);
        }

        // do not allow resources under root if not enabled in project properties
        if (!this.resourcesUnderRoot && isResource && parentCategory.elementType === 'model') {
            return await showMessageBox('warn', `Resources are not allowed under root!`,
                {
                    detail: `Cannot add resource '${itemName}' under root element '${getElementFullPath(parent)}'.\n\n` +
                        `NOTE: 'Resources under root' can be enabled in project properties.`, modal: true
                });
        }
        // do not allow categories in flat structure
        if (!this.isTreeStructure && !isResource && parentCategory.elementType === 'model') {
            return await showMessageBox('warn', `Categories are not allowed in flat structure!`,
                {
                    detail: `Cannot add category '${itemName}' under root element '${getElementFullPath(parent)}'.\n\n` +
                        `NOTE: 'Hierarchical tree structure' can be enabled in project properties.`, modal: true
                });
        }

        let newElement: ITreeElement;
        if (isResource) {
            newElement = parentCategory.addResource(itemName);
        } else {
            newElement = parentCategory.addCategory(itemName);
        }

        await this.applyChangesToTextDocument();
        this._onDidChangeTreeData.fire([parent]);
        await this.revealElement(newElement, { expand: true, select: true, focus: true });

        return await showMessageBox('info', `Added new ${elementType} '${itemName}' under '${getElementFullPath(parent)}'`,
            { logger: true });
    }

    public hasActiveDocument(): boolean {
        return this.currentDocument !== null && appContext.isEditorActive;
    }

    private get documentPath(): string {
        return this.currentDocument ? this.currentDocument.uri.fsPath : '';
    }

    public get documentUri(): string {
        return this.currentDocument ? this.currentDocument.uri.toString() : '';
    }

    public isSameDocument(document: vscode.TextDocument): boolean {
        return this.currentDocument !== null && this.currentDocument.uri.toString() === document.uri.toString();
    }

    public backupSelection(): SelectionBackup {
        return this.selectedElements.map(x => ({
            type: x.elementType,
            fullPath: getElementFullPath(x),
        }));
    }

    public async restoreSelection(selection: SelectionBackup): Promise<void> {
        if (!this.currentDocument || !this._currentRootModel || !selection || selection.length === 0) {
            return;
        }

        const root = this._currentRootModel!;
        const restoredElements: ITreeElement[] = [];
        selection.forEach(item => {
            const paths = createTreeElementPaths(item.fullPath);
            const elem = item.type === 'model' ? root : root.getElementByPath(paths, item.type);
            if (elem) {
                restoredElements.push(elem);
            }
        });

        // await this.clearSelection();
        await this.setSelectedItems(restoredElements);
    }

    public updateDocument(document: vscode.TextDocument | undefined, forceRefresh: boolean = false): Promise<void> {
        return new Promise<void>((resolve) => {
            nextTick(async () => {
                const docUri = document ? document.uri.toString() : '';
                const docPath = document ? document.uri.fsPath : '';
                if (isValidDocument(document)) {
                    //logger().log('debug', `[LhqTreeDataProvider] updateDocument -> [VALID] - ${docPath}`);
                    appContext.isEditorActive = true;

                    const baseName = path.basename(docPath);
                    this.view.title = `${baseName}`; // [LHQ Structure]`;

                    if (this.currentDocument?.uri.toString() !== docUri || !this._currentRootModel || forceRefresh) {
                        this.currentDocument = document;
                        this.refresh();
                    }

                    resolve();
                } else if (appContext.isEditorActive) {
                    logger().log(this, 'debug', `updateDocument -> [INVALID] - ${docPath}`);
                    this.view.title = `LHQ Structure`;
                    this.currentDocument = null;
                    this._validationError = undefined;
                    await this.clearSelection();
                    this.refresh();

                    nextTick(() => {
                        appContext.isEditorActive = false;
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    refresh(): void {
        this.clearPageErrors();

        this._codeGeneratorInProgress = false;

        if (this.currentDocument) {
            this.currentJsonModel = null;

            this._currentRootModel = undefined;
            this.currentVirtualRootElement = null;
            try {
                const docText = this.currentDocument.getText();
                this.currentJsonModel = docText?.length > 0 ? JSON.parse(docText) as LhqModel : null;
                this.currentFormatting = detectFormatting(docText);

            } catch (ex) {
                const error = `Error parsing LHQ file '${this.documentPath}'`;
                logger().log(this, 'error', `refresh failed -> ${error}`, ex as Error);
                this.currentJsonModel = null;
                void showMessageBox('err', error);
                return;
            }

            if (this.currentJsonModel) {
                let validateResult: LhqValidationResult | undefined;

                try {
                    validateResult = generatorUtils.validateLhqModel(this.currentJsonModel);
                    if (validateResult.success && validateResult.model) {
                        this._currentRootModel = ModelUtils.createRootElement(validateResult.model);
                        this.currentVirtualRootElement = new VirtualRootElement(this._currentRootModel, appContext.languagesVisible);
                    } else {
                        this.currentJsonModel = null;
                    }
                } catch (ex) {
                    this.currentJsonModel = null;
                    const error = `Error validating LHQ file '${this.documentPath}': ${ex}`;
                    logger().log(this, 'error', `refresh failed -> ${error}`, ex as Error);
                    void showMessageBox('err', error);
                    return;
                }

                if (this._currentRootModel === undefined) {
                    const error = validateResult
                        ? `Validation errors while parsing LHQ file '${this.documentPath}': \n${validateResult.error}`
                        : `Error validating LHQ file '${this.documentPath}'`;
                    logger().log(this, 'error', `refresh failed -> ${error}`);
                    void showMessageBox('err', error);
                    return;
                } else {
                    this.updateGeneratorStatus({ kind: 'idle' });
                }

                this.validateDocument();
            }

        } else {
            this._currentRootModel = undefined;
            this.currentVirtualRootElement = null;
        }

        // setTimeout(() => {
        //     this._onDidChangeTreeData.fire(undefined);
        // }, 100);

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ITreeElement): vscode.TreeItem {
        return new LhqTreeItem(element, this._currentSearch);
    }

    getChildren(element?: ITreeElement): Thenable<ITreeElement[]> {
        if (!this._currentRootModel) {
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
            result.push(this._currentRootModel);
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