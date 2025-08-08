import * as vscode from 'vscode';
import { isNullOrEmpty } from '@lhq/lhq-generators';
import type { ImportModelMode } from '@lhq/lhq-generators';

import { showOpenFileDialog, showMessageBox } from '../utils';
import type { ImporterEngine, ImportFileSelectedData } from './types';
import { ImportExportManager } from './manager';

interface ImportFromFilePickItem extends vscode.QuickPickItem {
    type: 'importerEngine' | 'importerFile' | 'allowNewElements' | 'importMode' | 'import';
}

interface ImporterEnginePickItem extends vscode.QuickPickItem {
    engine: ImporterEngine;
}

interface ImportModelPickItem extends vscode.QuickPickItem {
    mode: ImportModelMode;
}

export class ImportFileSelector {
    public static async showRoot(data: ImportFileSelectedData): Promise<ImportFileSelectedData | undefined> {
        const result: ImportFileSelectedData = structuredClone(data);

        do {
            const selectedImporter = ImportExportManager.getImporterByEngine(result.engine);
            const selectedImporterName = selectedImporter!.name;
            const allowNewElements = selectedImporter?.allowNewElements;
            const selectedFile = isNullOrEmpty(result.file) ? 'none' : result.file;
            const selectedModeMerge = result.mode === 'merge';
            const selectedAllowNewElements = result.allowNewElements;
            const ImportFileSelectorItems = [
                {
                    type: 'importerEngine',
                    label: selectedImporterName,
                    detail: 'Importer engine',
                    iconPath: new vscode.ThemeIcon('beaker'),
                },
                {
                    type: 'importerFile',
                    label: selectedFile,
                    detail: 'File to import',
                    iconPath: new vscode.ThemeIcon('file'),
                },
                {
                    type: 'importMode',
                    label: selectedModeMerge ? 'Merge with existing data' : 'Import into new category',
                    detail: 'Mode',
                    iconPath: new vscode.ThemeIcon(selectedModeMerge ? 'merge' : 'new-folder'),
                },
                {
                    kind: vscode.QuickPickItemKind.Separator
                },
                {
                    type: 'import',
                    label: 'Start Import',
                }
            ] as ImportFromFilePickItem[];

            if (allowNewElements) {
                ImportFileSelectorItems.splice(3, 0, {
                    type: 'allowNewElements',
                    label: selectedAllowNewElements ? 'Allowed new elements' : 'Not allowed new elements',
                    detail: 'Import new elements',
                    iconPath: new vscode.ThemeIcon(selectedAllowNewElements ? 'check' : 'x')
                });
            }

            const selected = await vscode.window.showQuickPick(ImportFileSelectorItems, {
                placeHolder: 'Import resources from file',
                ignoreFocusOut: true,
                matchOnDescription: false,
                matchOnDetail: false
            });

            if (!selected) {
                return undefined;
            }

            switch (selected.type) {
                case 'importerEngine': {
                    const newEngine = await ImportFileSelector.showImporterEngine(result);
                    if (newEngine && newEngine !== result.engine) {
                        result.engine = newEngine;
                        result.file = undefined;
                    }

                    break;
                }
                case 'importerFile': {
                    const newFile = await showOpenFileDialog('Select file to import', {
                        filters: selectedImporter!.fileFilter,
                        defaultUri: result.file ? vscode.Uri.file(result.file) : undefined,
                    });

                    if (newFile) {
                        result.file = newFile.fsPath;
                    }

                    break;
                }
                case 'importMode': {
                    const newMode = await ImportFileSelector.showMode(result);
                    if (newMode && newMode !== result.mode) {
                        result.mode = newMode;
                        if (newMode === 'importAsNew') {
                            result.allowNewElements = true;
                        }
                    }

                    break;
                }
                case 'allowNewElements': {
                    const newAllowed = await ImportFileSelector.showAllowNewElements(result);
                    if (newAllowed !== undefined) {
                        result.allowNewElements = newAllowed;
                    }
                    break;
                }
                case 'import': {
                    if (result.file) {
                        return result;
                    } else {
                        await showMessageBox('err', 'Please select file to import first.', undefined, false);
                    }
                    break;
                }
            }
        } while (true);
    }

    private static async showImporterEngine(data: ImportFileSelectedData): Promise<ImporterEngine | undefined> {
        const items: ImporterEnginePickItem[] = [];
        ImportExportManager.availableImporters.forEach(function (importer) {
            const selected = importer.engine === data.engine;
            items.push({
                label: importer.name + (selected ? ' (selected)' : ''),
                engine: importer.engine,
                detail: importer.description,
            });
        });


        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select importer engine',
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected ? selected.engine : undefined;
    }

    private static async showMode(data: ImportFileSelectedData): Promise<ImportModelMode | undefined> {
        const isMerge = data.mode === 'merge';

        const items = [
            {
                label: 'Merge with existing data' + (isMerge ? ' (selected)' : ''),
                mode: 'merge',
                detail: 'Merge imported data with existing resources',
                iconPath: new vscode.ThemeIcon('merge'),
            },
            {
                label: 'Import into new category' + (!isMerge ? ' (selected)' : ''),
                mode: 'importAsNew',
                detail: 'Import data into new category',
                iconPath: new vscode.ThemeIcon('new-folder'),
            }
        ] as ImportModelPickItem[];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select import mode',
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected ? selected.mode as ImportModelMode : undefined;
    }

    private static async showAllowNewElements(data: ImportFileSelectedData): Promise<boolean | undefined> {
        type Item = { allowNewElements: boolean } & vscode.QuickPickItem;

        const isAllowed = data.allowNewElements;
        const items = [
            {
                label: 'Allow new elements' + (isAllowed ? ' (selected)' : ''),
                allowNewElements: true,
                detail: 'Allows importing new elements during import',
                iconPath: new vscode.ThemeIcon('check'),
            },
            {
                label: 'Do not allow new elements' + (!isAllowed ? ' (selected)' : ''),
                allowNewElements: false,
                detail: 'Disallows importing new elements during import',
                iconPath: new vscode.ThemeIcon('x'),
            }
        ] as Item[];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Allow new elements during import',
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected ? selected.allowNewElements : undefined;
    }
}