import path from 'node:path';
import { HostEnvironment } from '@lhq/lhq-generators';

export class HostEnvironmentCli extends HostEnvironment {
    public pathCombine(path1: string, path2: string): string {
        return path.join(path1, path2);
    }
}