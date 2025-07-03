import { isNullOrEmpty } from '@lhq/lhq-generators';

export type NameValidatorFlagsType = 'none' | 'allowEmpty';
export type NameValidatorResultType = 'valid' | 'nameIsEmpty' | 'nameCannotBeginWithNumber' | 'nameCanContainOnlyAlphaNumeric';

const regexStartedWithNumbers = /^[0-9]+[a-zA-Z0-9]*$/;
const regexValidCharacters = /^[a-zA-Z]+[a-zA-Z0-9_]*$/;

export function validateName(name: string | null | undefined, flags: NameValidatorFlagsType = 'none'): NameValidatorResultType {
    let result: NameValidatorResultType = 'valid';

    if (isNullOrEmpty(name)) {
        result = flags === 'allowEmpty' ? 'valid' : 'nameIsEmpty';
    } else {
        if (regexStartedWithNumbers.test(name)) {
            result = 'nameCannotBeginWithNumber';
        } else if (!regexValidCharacters.test(name)) {
            result = 'nameCanContainOnlyAlphaNumeric';
        } else if (name.trim() === '') { // This case seems redundant due to the initial check, but kept for structural similarity
            result = 'nameIsEmpty';
        }
    }

    return result;
}