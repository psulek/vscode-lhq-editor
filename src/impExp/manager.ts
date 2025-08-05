import { ExcelDataImporter } from './excelImporter';
import { IDataImporter, ImporterEngine, ImportPreparedData } from './types';

const importers: IDataImporter[] = [
    new ExcelDataImporter()
];

export class ImportExportManager {
    public static get availableImporters(): IDataImporter[] {
        return importers;
    }

    public static getImporterByEngine(engine: ImporterEngine): IDataImporter | undefined {
        return importers.find(i => i.engine === engine);
    }

    public static async getDataFromFile(filePath: string, engine: ImporterEngine): Promise<ImportPreparedData> {
        const importer = this.getImporterByEngine(engine);
        if (!importer) {
            return { error: `No importer found for engine: ${engine}` };
        }
        return importer.getDataFromFile(filePath);
    }
}