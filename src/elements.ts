import { ICategoryLikeTreeElement, IRootModelElement, ITreeElement, ITreeElementPaths, TreeElementType } from '@lhq/lhq-generators';
import { createTreeElementPaths, MatchForSubstringResult } from './utils';

export type SearchTreeKind = 'path' | 'name' | 'translation' | 'language';

export type SearchTreeOptionsBase = {
    uid: string;
    searchText: string;
    filter?: string;
    elems: Array<MatchingElement>;
    elemIdx?: number;
};

export type MatchingElement = {
    element: ITreeElement; match: MatchForSubstringResult; leaf: boolean;
};

export type SearchTreeOptions =
    SearchTreeOptionsBase & { type: Exclude<SearchTreeKind, 'path'> } |
    SearchTreeOptionsBase & {
        type: 'path';
        paths: string[];
    };


export type VirtualElementType = 'treeRoot' | 'languages' | 'language';

export function isVirtualTreeElement(element: ITreeElement | undefined, elementType?: VirtualElementType): boolean {
    return element !== undefined && element instanceof VirtualTreeElement && (!elementType || element.virtualElementType === elementType);
}

export class VirtualTreeElement implements ITreeElement {
    private _root: IRootModelElement;
    private _name: string;
    private _paths: ITreeElementPaths;
    private _virtualElementType: VirtualElementType;

    constructor(root: IRootModelElement, name: string, virtualElementType: VirtualElementType) {
        this._root = root;
        this._name = name;
        this._virtualElementType = virtualElementType;
        this._paths = createTreeElementPaths('/');
    }

    get virtualElementType(): VirtualElementType {
        return this._virtualElementType;
    }

    get parent(): Readonly<ICategoryLikeTreeElement | undefined> {
        return undefined;
    }

    get root(): Readonly<IRootModelElement> {
        return this._root;
    }

    get name(): string {
        return this._name;
    }

    set name(value: string) {
        this._name = value;
    }
    get elementType(): TreeElementType {
        return this.virtualElementType as TreeElementType;
    }

    get description(): string | undefined {
        return '';
    }

    set description(value: string | undefined) {
    }

    get paths(): Readonly<ITreeElementPaths> {
        return this._paths;
    }

    get isRoot(): boolean {
        return false;
    }

    get data(): Readonly<Record<string, unknown>> {
        return {};
    }

    changeParent(newParent: ICategoryLikeTreeElement | undefined): boolean {
        return true;
    }

    public getLevel(): number {
        let level = 0;
        let current: ICategoryLikeTreeElement | undefined = this.parent;

        while (current) {
            level++;
            current = current.parent;
        }

        return level;
    }
}

export class VirtualRootElement extends VirtualTreeElement {
    private _languagesRoot: LanguagesElement;

    constructor(root: IRootModelElement) {
        super(root, root.name, 'treeRoot');
        this._languagesRoot = new LanguagesElement(root, 'Languages');
    }

    get languagesRoot(): LanguagesElement {
        return this._languagesRoot;
    }

    get isRoot(): boolean {
        return true;
    }
}

export class LanguagesElement extends VirtualTreeElement {
    private _virtualLangs: VirtualTreeElement[] = [];

    constructor(root: IRootModelElement, name: string) {
        super(root, name, 'languages');
        this._virtualLangs = root.languages.map(lang => new LanguageElement(root, lang));
    }

    get virtualLanguages(): ReadonlyArray<VirtualTreeElement> {
        return this._virtualLangs;
    }

    public find(langName: string): VirtualTreeElement | undefined {
        return this._virtualLangs.find(lang => lang.name === langName);
    }
}

export class LanguageElement extends VirtualTreeElement {
    constructor(root: IRootModelElement, name: string) {
        super(root, name, 'language');
    }
}