import { IDataImporter, ImporterEngine, ImportPreparedData } from './types';

export class LhqModelDataImporter implements IDataImporter {
    get engine(): ImporterEngine {
        return 'Lhq';
    }
    
    get name(): string {
        return 'LHQ Model';
    }
    
    get description(): string {
        return 'Imports localization data from LHQ model files (*.lhq).';
    }

    getDataFromFile(filePath: string): Promise<ImportPreparedData> {
        throw new Error('Method not implemented.');
    }
}