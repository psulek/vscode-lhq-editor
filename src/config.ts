import * as vscode from 'vscode';
import type { IAppConfig } from './types';

const sectionName = 'lhqeditor';

const configKeys = {
    runGeneratorOnSave: 'runGeneratorOnSave',
};

export class AppConfig implements IAppConfig {
    public get runGeneratorOnSave(): boolean {
        const cfg = vscode.workspace.getConfiguration(sectionName);
        const value = cfg.get<boolean>(configKeys.runGeneratorOnSave);
        return value ?? true; 
    }

    public async updateConfig(newConfig: Partial<IAppConfig>): Promise<void> {
        const cfg = vscode.workspace.getConfiguration(sectionName);

        for (const key of Object.keys(newConfig) as (keyof IAppConfig)[]) {
            if (newConfig[key] !== undefined) {
                await cfg.update(key, newConfig[key], vscode.ConfigurationTarget.Global);
            }
        }
    }
}