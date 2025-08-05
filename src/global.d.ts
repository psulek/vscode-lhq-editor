import { IAppConfig, IAppContext } from './types';

declare global {
    let appContext: IAppContext;

    let appConfig: IAppConfig;
}