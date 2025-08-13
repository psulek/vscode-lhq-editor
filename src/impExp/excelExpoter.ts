import * as ExcelJS from 'exceljs';
import { isNullOrEmpty, type ICategoryElement, type IResourceElement, type IRootModelElement } from '@lhq/lhq-generators';
import { excelWorksheetName, ExporterEngine, IDataExporter } from './types';
import path from 'path';
import { FileFilter } from '../utils';

export class ExcelDataExporter implements IDataExporter {
    public get engine(): ExporterEngine {
        return 'MsExcel';
    }

    public get name(): string {
        return 'Microsoft Excel';
    }

    public get description(): string {
        return 'Exports localization data to Microsoft Excel files (*.xlsx).';
    }

    public get fileFilter(): FileFilter {
        return {
            'Excel files': ['xlsx']
        };
    }

    public async exportToFile(filePath: string, model: IRootModelElement, modelFileName: string, languages?: string[]): Promise<void> {
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet(excelWorksheetName);

        // Add headers
        const headerRowStyle: Partial<ExcelJS.Style> = {
            fill: {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {
                    argb: 'fff5f5f5' // whitesmoke
                }
            },
            font: { bold: true, size: 13 },
            border: { right: { style: 'thin' } }
        };
        const rows = ['Resource Key'];
        languages = languages || [...model.languages];
        const primaryLanguage = model.primaryLanguage ?? 'en';
        const primaryCulture = appContext.findCulture(primaryLanguage);
        const name = primaryCulture?.name ?? primaryLanguage;
        const engName = primaryCulture?.engName ?? primaryLanguage;
        rows.push(`${name.toUpperCase()} (${engName}) [Primary]`);

        model.languages.filter(lang => lang !== primaryLanguage).forEach(lang => {
            const culture = appContext.findCulture(lang);
            const langName = culture?.name ?? lang;
            const langEngName = culture?.engName ?? lang;
            rows.push(`${langName.toUpperCase()} (${langEngName})`);
        });

        ws.addRow(rows).eachCell(cell => {
            cell.style = headerRowStyle;
        });

        const languagesToExport = [primaryLanguage, ...languages.filter(lang => lang !== primaryLanguage)];
        let cellRow = 1;

        const columnKeyStyle: Partial<ExcelJS.Style> = {
            fill: {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {
                    argb: 'fff5f5f5' // whitesmoke
                }
            },
            border: {
                right: {
                    style: 'thin'
                }
            },
            alignment: {
                vertical: 'middle'
            }
        };

        const columnPrimaryStyle: Partial<ExcelJS.Style> = {
            fill: {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {
                    argb: 'fff5f5dc' // Beige
                }
            },
            border: {
                right: {
                    style: 'medium'
                }
            },
            alignment: {
                vertical: 'middle',
            }
        };


        const exportCategories = (categories: Readonly<ICategoryElement[]>, parentPath: string): void => {
            categories.forEach(category => {
                const categoryPath = `${parentPath}/${category.name}`;

                if (category.resources.length > 0) {
                    exportResources(category.resources, categoryPath);
                }

                if (category.categories.length > 0) {
                    exportCategories(category.categories, categoryPath);
                }
            });
        };

        const exportResources = (resources: Readonly<IResourceElement[]>, categoryPath: string): void => {
            resources.forEach(resource => {
                cellRow++;
                const resourcePath = categoryPath === '' ? resource.name : `${categoryPath}/${resource.name}`;

                const cellKey = ws.getCell(cellRow, 1);
                cellKey.value = resourcePath;
                cellKey.style = Object.assign({}, columnKeyStyle, {
                    alignment: {
                        horizontal: 'left',
                        vertical: 'top'
                    }
                });


                let cellValueCol = 1;
                languagesToExport.forEach(lang => {
                    cellValueCol++;
                    const cellValue = ws.getCell(cellRow, cellValueCol);
                    cellValue.value = resource.getValue(lang, false) ?? '';
                    const alignStyle: Partial<ExcelJS.Style> = {
                        alignment: {
                            horizontal: 'left',
                            vertical: 'top'
                        }
                    };

                    cellValue.style = cellValueCol === 2 ? Object.assign({}, columnPrimaryStyle, alignStyle) : alignStyle;
                });
            });
        };

        const columnKey = ws.getColumn(1);
        this.autoWidth(columnKey, 50, 50);

        columnKey.style = columnKeyStyle;

        const columnPrimary = ws.getColumn(2);
        columnPrimary.style = columnPrimaryStyle;

        if (model.categories.length > 0) {
            exportCategories(model.categories, '');
        }
        exportResources(model.resources, '');

        for (let i = 2; i <= ws.actualColumnCount; i++) {
            this.autoWidth(ws.getColumn(i), 50, 70);
        }

        if (ws.actualRowCount > 1) {
            ws.eachRow(row => {
                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    cell.style = Object.assign({}, cell.style, {
                        border: {
                            right: colNumber < 3 ? { style: 'thin' } : undefined,
                            bottom: row.number === 1 ? { style: 'medium' } : { style: 'thin' }
                        },
                        alignment: colNumber > 1 ? { wrapText: true } : { vertical: 'middle' }
                    });
                });
            });
        }

        ws.views = [
            { state: 'frozen', xSplit: 2, ySplit: 0 }
        ];

        const dateNow = new Date();
        ws.workbook.created = dateNow;
        ws.workbook.creator = 'LHQ Editor (vscode)';
        const filename = path.basename(modelFileName);
        ws.workbook.title = `Localization Export from ${filename}`;

        await workbook.xlsx.writeFile(filePath);
    }

    private autoWidth(column: ExcelJS.Column, min: number, max: number): void {
        let maxColumnLength = 0;
        if (typeof column.eachCell === 'function') {
            column.eachCell({ includeEmpty: true }, (cell) => {
                maxColumnLength = Math.max(
                    maxColumnLength,
                    min,
                    cell.value ? cell.value.toString().length : 0
                );
            });
        }
        const width = maxColumnLength + 2;
        column.width = width < min ? min : (width > max ? max : width);
    };
}