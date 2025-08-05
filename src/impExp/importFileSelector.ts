import * as vscode from 'vscode';
import { isNullOrEmpty } from '@lhq/lhq-generators';
import type { ImportModelMode } from '@lhq/lhq-generators';

import { showFileDialog, showMessageBox } from '../utils';
import type { ImporterEngine, ImportFileSelectedData } from './types';
import { ImportExportManager } from './manager';

interface ImportFromFilePickItem extends vscode.QuickPickItem {
    type: 'importerEngine' | 'importerFile' | 'importMode' | 'import';
}

interface ImporterEnginePickItem extends vscode.QuickPickItem {
    engine: ImporterEngine;
}

interface ImportModelPickItem extends vscode.QuickPickItem {
    mode: ImportModelMode;
}

const filtersExcel = {
    'Excel files': ['xlsx'],
    'All files': ['*']
};

const filtersResX = {
    'ResX files': ['resx'],
    'All files': ['*']
};

export class ImportFileSelector {
    public static async showRoot(data: ImportFileSelectedData): Promise<ImportFileSelectedData | undefined> {
        const result: ImportFileSelectedData = structuredClone(data);

        do {
            const selectedImporter = ImportExportManager.getImporterByEngine(result.engine)!.name;
            const selectedFile = isNullOrEmpty(result.file) ? 'none' : result.file;
            const selectedModeMerge = result.mode === 'merge';
            const ImportFileSelectorItems = [
                {
                    type: 'importerEngine',
                    label: selectedImporter,
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
                    if (newEngine) {
                        result.engine = newEngine;
                    }

                    break;
                }
                case 'importerFile': {
                    const filters = result.engine === 'MsExcel' ? filtersExcel : filtersResX;
                    const newFile = await showFileDialog('Select file to import', {
                        filters,
                        defaultUri: result.file ? vscode.Uri.file(result.file) : undefined,
                    });

                    if (newFile) {
                        result.file = newFile.fsPath;
                    }

                    break;
                }
                case 'importMode': {
                    const newMode = await ImportFileSelector.showMode(result);
                    if (newMode) {
                        result.mode = newMode;
                    }

                    break;
                }
                case 'import': {
                    if (result.file) {
                        return result;
                    } else {
                        await showMessageBox('err', 'Please select file to import first.', { logger: false, modal: true });
                    }
                    break;
                }
            }
        } while (true);
    }

    private static async showImporterEngine(data: ImportFileSelectedData): Promise<ImporterEngine | undefined> {
        const isExcel = data.engine === 'MsExcel';

        const items = [
            {
                label: 'Microsoft Excel' + (isExcel ? ' (selected)' : ''),
                engine: 'MsExcel',
                detail: 'Import from Microsoft Excel file (*.xlsx)',
            },
            {
                label: '.NET ResX' + (!isExcel ? ' (selected)' : ''),
                engine: 'ResX',
                detail: 'Import from .NET resource file (*.resx)',
            }
        ] as ImporterEnginePickItem[];


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
}