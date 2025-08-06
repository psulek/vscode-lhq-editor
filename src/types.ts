import type { FormattingOptions, ICodeGeneratorElement, IRootModelElement, ITreeElement, LhqModel, LhqModelOptionsResources, TemplateMetadataDefinition, TreeElementType } from '@lhq/lhq-generators';
import type { MarkdownString, MessageOptions, TextDocument, ThemeColor, Uri, Webview } from 'vscode';

export type SearchTreeKind = 'path' | 'name' | 'translation' | 'language';

export type SearchTreeOptionsBase = {
    uid: string;
    searchText: string;
    filter?: string;
    elems: Array<MatchingElement>;
    elemIdx?: number;
};

export type MatchForSubstringResult = {
    match: 'equal' | 'contains' | 'none';
    highlights?: [number, number][];
}

export type MatchingElement = {
    element: ITreeElement; match: MatchForSubstringResult; leaf: boolean;
};

export type SearchTreeOptions =
    SearchTreeOptionsBase & { type: Exclude<SearchTreeKind, 'path'> } |
    SearchTreeOptionsBase & {
        type: 'path';
        paths: string[];
    };


export type VirtualElementType = 'treeRoot' | 'languages' | 'language' | 'loading';

export interface IVirtualTreeElement extends ITreeElement {
    get virtualElementType(): VirtualElementType;
}

export interface IVirtualLanguageElement extends IVirtualTreeElement {
    get isPrimary(): boolean;
}

export interface ILanguagesElement extends IVirtualTreeElement {
    get virtualLanguages(): ReadonlyArray<IVirtualTreeElement>;

    refresh(): void;
    find(langName: string): IVirtualTreeElement | undefined;
    contains(langName: string): boolean;
}

export interface IVirtualRootElement extends IVirtualTreeElement {
    refresh(): void;

    get languagesRoot(): ILanguagesElement;
}

export type AppTreeElementType = TreeElementType | VirtualElementType;

export type CultureInfo = {
    name: string;
    engName: string;
    nativeName: string;
    lcid: number;
    isNeutral: boolean;
}

//export type CulturesMap = Record<string, CultureInfo>;

export type ValidationError = { message: string, detail?: string };

export type ClientPageError = {
    field: string;
    fullPath: string;
    message: string;
};

export type ClientPageModelProperties = {
    resources: LhqModelOptionsResources;
    categories: boolean;
    modelVersion: number;
    visible: boolean;
    codeGenerator: ICodeGeneratorElement;
}

export type ClientPageSettingsError = {
    group: string;
    name: string;
    message: string;
}

export type ConfirmQuestionTypes = 'resetSettings' | 'cancelSettingsChanges';

export type AppToPageMessage = {
    command: 'init';
    templatesMetadata: Record<string, TemplateMetadataDefinition>;
} | {
    command: 'loadPage';
    element: Object;
    file: string;
    cultures: CultureInfo[];
    primaryLang: string;
    modelProperties: ClientPageModelProperties;
    autoFocus: boolean;
    restoreFocusedInput?: boolean;
} | {
    command: 'invalidData';
    action: 'add' | 'remove';
} & ClientPageError |
{
    command: 'updatePaths'
    paths: string[];
} |
{
    command: 'showProperties';
} |
{
    command: 'savePropertiesResult';
    error?: ClientPageSettingsError | undefined;
} | {
    command: 'confirmQuestionResult';
    id: ConfirmQuestionTypes;
    confirmed: boolean;
    result: unknown | undefined;
} | {
    command: 'requestPageReload'
} | {
    command: 'focus'
} | {
    command: 'showInputBoxResult';
    id: string;
    result: string | undefined;
} | {
    command: 'requestRename'
} | {
    command: 'blockEditor',
    block: boolean
};

export type PageToAppMessage = {
    command: 'update';
    data: Record<string, unknown>;
} | {
    command: 'select',
    paths: string[];
    elementType: TreeElementType;
    reload?: boolean;
} | {
    command: 'saveProperties';
    modelProperties: ClientPageModelProperties;
} | {
    command: 'confirmQuestion';
    id: ConfirmQuestionTypes;
    message: string;
    detail?: string;
    warning?: boolean;
} | {
    command: 'showInputBox';
    id: 'editElementName' | string;
    data: unknown;
    prompt: string;
    placeHolder?: string;
    title?: string;
    value?: string;
} | {
    command: 'focusTree';
    paths: string[];
    elementType: TreeElementType;
};

export interface IAppConfig {
    get runGeneratorOnSave(): boolean;
}


export interface IAppContext {
    updateConfig(newConfig: Partial<IAppConfig>): Promise<void>;

    getAllCultures(): CultureInfo[];
    findCulture(name: string, ignoreCase?: boolean): CultureInfo | undefined;
    getCultureDesc(name: string): string;

    get treeContext(): ITreeContext;

    get selectedElements(): ITreeElement[];

    get isEditorActive(): boolean;

    get languagesVisible(): boolean;
    set languagesVisible(visible: boolean);

    get firstTimeRun(): boolean;
    set firstTimeRun(value: boolean);

    get readonlyMode(): boolean;
    set readonlyMode(value: boolean);

    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;

    clearTreeContextValues(): void;
    getFileUri(...pathParts: string[]): Uri;
    getPageHtml(): Promise<string>;
    getMediaUri(webview: Webview, filename: string, themed?: boolean): Uri

    setSelectionChangedCallback(callback: SelectionChangedCallback): void;
    setTreeSelection(selectedElements: ITreeElement[]): void;

    sendMessageToHtmlPage(message: AppToPageMessage): void;

    enableEditorActive(): void;
    disableEditorActive(): void;
    setCheckAnyActiveDocumentCallback(callback: CheckAnyActiveDocumentCallback): void;
}

export interface ITreeContext {
    updateDocument(docCtx: IDocumentContext | undefined): void;

    selectRootElement(): Promise<void>;

    setSelectedItems(itemsToSelect: ITreeElement[], options?: { focus?: boolean; expand?: boolean | number }): Promise<void>;

    revealElement(item: ITreeElement, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Promise<void>

    clearSelection(reselect?: boolean): Promise<void>;

    getElementByPath(elementType: TreeElementType, path: string[]): ITreeElement | undefined;

    selectElementByPath(elementType: TreeElementType, path: string[], expand?: boolean): Promise<void>;

    refreshTree(elements: ITreeElement[] | undefined): unknown;

    advancedFind(): Promise<void>;

    showLoading(text: string): Promise<void>;

    backupSelection(): SelectionBackup;

    restoreSelection(selection: SelectionBackup): Promise<void>;

    getElementsFromSelection(selection: SelectionBackup): ITreeElement[];
}

export type NotifyDocumentActiveChangedCallback = (docContext: IDocumentContext, active: boolean) => void;

export interface IDocumentContext {
    get documentUri(): Uri | undefined;

    get fileName(): string;

    get isReadonly(): boolean;

    get isActive(): boolean;

    get codeGeneratorTemplateId(): string;

    get documentFormatting(): FormattingOptions;

    get jsonModel(): LhqModel | undefined;

    get rootModel(): IRootModelElement | undefined;

    get virtualRootElement(): IVirtualRootElement | undefined;

    get resourcesUnderRoot(): boolean;

    get isTreeStructure(): boolean;

    commitChanges(message: string): Promise<boolean>;

    isSameDocument(document: TextDocument): boolean;
}

export type SelectionChangedCallback = (selectedElements: ITreeElement[]) => void;
export type CheckAnyActiveDocumentCallback = () => boolean;

export type SelectionBackup = Array<{
    type: TreeElementType;
    fullPath: string;
}>;

// export type MessageBoxOptions = {
//     logger?: boolean
//     detail?: string;
//     showDetail?: boolean;
// }

export type NotificationBoxOptions = {
    logger?: boolean
}

export type ConfirmBoxOptions = {
    logger?: boolean
    warn?: boolean;
    yesText?: string;
    noText?: string
}

export interface ICodeGenStatus {
    get inProgress(): boolean;
    set inProgress(value: boolean);

    update(info: CodeGeneratorStatusInfo): string
}

export type CodeGeneratorStatusInfo =
    | { kind: 'active'; }
    | { kind: 'idle'; }
    | { kind: 'error'; message: string; detail?: string, timeout?: number; }
    | { kind: 'status'; message: string; success: boolean; timeout: number; };

export type CodeGeneratorStatusKind = CodeGeneratorStatusInfo['kind'];

export type StatusBarItemUpdateInfo = {
    text: string;
    tooltip: string | MarkdownString | undefined;
    command?: string;
    backgroundColor: ThemeColor | undefined;
    color: string | ThemeColor | undefined;
};

export type StatusBarItemUpdateRequestCallback = (docContext: IDocumentContext, updateInfo: StatusBarItemUpdateInfo) => void;