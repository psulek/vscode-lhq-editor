import { IAppConfig, IAppContext } from './types';

declare global {
    // eslint-disable-next-line no-var
    let appContext: IAppContext;

    let appConfig: IAppConfig;
}