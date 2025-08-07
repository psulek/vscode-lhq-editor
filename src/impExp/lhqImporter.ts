import fse from 'fs-extra';

import { generatorUtils, ImportModelOptions, ModelUtils } from '@lhq/lhq-generators';

import { DataImporterBase, ImporterEngine } from './types';
import { FileFilter, safeReadFile } from '../utils';

export class LhqModelDataImporter extends DataImporterBase {
    get engine(): ImporterEngine {
        return 'Lhq';
    }

    get name(): string {
        return 'LHQ Model';
    }

    get description(): string {
        return 'Imports localization data from LHQ model files (*.lhq).';
    }

    public get fileFilter(): FileFilter {
        return {
            'LHQ model files': ['lhq'],
            'All files': ['*']
        };
    }

    public get allowNewElements(): boolean {
        return true;
    }

    public async getImportData(filePath: string): Promise<Partial<ImportModelOptions> | string> {
        if (await fse.pathExists(filePath) === false) {
            return `Could not find file: ${filePath}`;
        }

        const modelStr = await safeReadFile(filePath);

        const validateResult = generatorUtils.validateLhqModel(modelStr);
        if (validateResult.success && validateResult.model) {
            return {
                sourceKind: 'model',
                source: ModelUtils.createRootElement(validateResult.model!)
            };
        }

        return `Invalid LHQ model, ${validateResult.error}`;
    }
}