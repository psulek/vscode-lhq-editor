import * as vscode from 'vscode';
import { IVirtualLanguageElement } from '../shared/types';
import { ITreeElement } from '@lhq/lhq-generators';
import { VirtualTreeElement } from './elements';

const globalStateKeys = {
    languagesVisible: 'languagesVisible'
};

const contextKeys = {
    isEditorActive: 'lhqEditorIsActive',
    hasSelectedItem: 'lhqTreeHasSelectedItem',
    hasMultiSelection: 'lhqTreeHasMultiSelection',
    hasSelectedDiffParents: 'lhqTreeHasSelectedDiffParents',
    hasLanguageSelection: 'lhqTreeHasLanguageSelection',
    hasPrimaryLanguageSelected: 'lhqTreeHasPrimaryLanguageSelected',
    hasSelectedResource: 'lhqTreeHasSelectedResource',
    hasLanguagesVisible: 'lhqTreeHasLanguagesVisible',
};

export class AppContext {
    private _ctx!: vscode.ExtensionContext;
    private _isEditorActive = false;

    public init(ctx: vscode.ExtensionContext) {
        this._ctx = ctx;

        // to trigger setContext calls
        this.languagesVisible = this.languagesVisible;
        this.isEditorActive = false;
        this.setTreeViewHasSelectedItem([]);
    }

    public get languagesVisible(): boolean {
        return this._ctx.globalState.get<boolean>(globalStateKeys.languagesVisible, true);
    }

    public set languagesVisible(visible: boolean) {
        this._ctx.globalState.update(globalStateKeys.languagesVisible, visible);
        vscode.commands.executeCommand('setContext', contextKeys.hasLanguagesVisible, visible);
    }

    public get isEditorActive(): boolean {
        return this._isEditorActive;
    }

    public set isEditorActive(active: boolean) {
        if (this._isEditorActive !== active) {
            this._isEditorActive = active;
            vscode.commands.executeCommand('setContext', contextKeys.isEditorActive, active);
        }
    }

    public setTreeViewHasSelectedItem(selectedElements: ITreeElement[]): void {
        const hasSelectedItem = selectedElements.length === 1;
        const hasMultiSelection = selectedElements.length > 1;
        let hasSelectedDiffParents = false;
        let hasLanguageSelection = false;
        let hasPrimaryLanguageSelected = false;
        let hasSelectedResource = hasSelectedItem && selectedElements[0].elementType === 'resource';

        if (selectedElements.length > 1) {
            const firstParent = selectedElements[0].parent;
            hasSelectedDiffParents = selectedElements.some(x => x.parent !== firstParent);
        }

        const virtualElements = selectedElements.filter(x => x instanceof VirtualTreeElement);
        if (virtualElements.length > 0) {
            hasLanguageSelection = virtualElements.some(x => x.virtualElementType === 'language' || x.virtualElementType === 'languages');
            hasPrimaryLanguageSelected = virtualElements.some(x => x.virtualElementType === 'language' && (x as unknown as IVirtualLanguageElement).isPrimary);
        }

        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedItem, hasSelectedItem);
        vscode.commands.executeCommand('setContext', contextKeys.hasMultiSelection, hasMultiSelection);
        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedDiffParents, hasSelectedDiffParents);
        vscode.commands.executeCommand('setContext', contextKeys.hasLanguageSelection, hasLanguageSelection);
        vscode.commands.executeCommand('setContext', contextKeys.hasPrimaryLanguageSelected, hasPrimaryLanguageSelected);
        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedResource, hasSelectedResource);
    }
}

export const appContext = new AppContext();