import * as vscode from 'vscode';
import type { IAppConfig } from './types';

const sectionName = 'lhqeditor';

const configKeys = {
    runGeneratorOnSave: 'runGeneratorOnSave',
    suggestRunGeneratorOnSave: 'suggestRunGeneratorOnSave'
};

export class AppConfig implements IAppConfig {
    public get runGeneratorOnSave(): boolean {
        const cfg = vscode.workspace.getConfiguration(sectionName);
        const value = cfg.get<boolean>(configKeys.runGeneratorOnSave);
        return value ?? true; 
    }

    public get suggestRunGeneratorOnSave(): boolean {
        const cfg = vscode.workspace.getConfiguration(sectionName);
        const value = cfg.get<boolean>(configKeys.suggestRunGeneratorOnSave);
        return value ?? true; 
    }

    public async updateConfig(newConfig: Partial<IAppConfig>, target?: vscode.ConfigurationTarget): Promise<void> {
        const cfg = vscode.workspace.getConfiguration(sectionName);

        for (const key of Object.keys(newConfig) as (keyof IAppConfig)[]) {
            if (newConfig[key] !== undefined) {
                await cfg.update(key, newConfig[key], target ?? vscode.ConfigurationTarget.Global);
            }
        }
    }
}