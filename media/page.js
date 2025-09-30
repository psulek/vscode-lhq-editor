/// <reference types="vscode-webview" />

(function () {
    const vscode = acquireVsCodeApi();

    /**
     * @typedef {Object} CultureInfo
     * @property {string} name
     * @property {string} engName
     * @property {string} nativeName
     * @property {number} lcid
     * @property {boolean} isNeutral
     */

    /** @type  CultureInfo[] */
    let usedCultures = [];

    /**
     * @typedef {Object} InvalidDataError
     * @property {string} uid
     * @property {string} message
     * @property {'server' | 'tags' | 'badunicodechars'} type
     * @property {HTMLElement} element
     */

    /**
     * @typedef {Object} InvalidDataInfo
     * @property {InvalidDataError[]} errors
     */

    /**
     * @typedef {Object} SettingsError
     * @property {string} group
     * @property {string} name
     * @property {string} message
     */

    /**
     * @typedef {Object} ModelProperties
     * @property {'All' | 'Categories'} resources
     * @property {boolean} categories
     * @property {number} modelVersion
     * @property {ICodeGeneratorElement} codeGenerator
     */

    /**
     * @typedef {Object} ModelPropsCurrents
     * @property {boolean} visible
     * @property {boolean} saving
     * @property {SettingsError | undefined} codeGeneratorError
     */

    /**
     * @typedef {Object} PageData
     * @property {Object} item
     * @property {boolean} loading
     * @property {boolean} paramsEnabled
     * @property {InvalidDataInfo} invalidData
     * @property {'onetime' | 'infinite' | undefined} supressOnChange
     * @property {boolean} forceOnChange
     * @property {ModelProperties} modelProperties
     * @property {ModelProperties} modelPropertiesBackup
     * @property {ModelPropsCurrents} modelPropsCurrents
     * @property {TemplateMetadataDefinition} templateDefinition
     * @property {boolean} blockPanelVisible
     */

    /**
     * @typedef {Object} ResourceValueElement
     * @property {string} languageName
     * @property {string} value
     * @property {boolean} locked
     * @property {boolean} auto
     */

    /**
     * @typedef {Object} TranslationItem
     * @property {ResourceValueElement} valueRef
     * @property {CultureInfo} culture
     * @property {boolean} isPrimary
     */

    const regexValidCharacters = /^[a-zA-Z]+[a-zA-Z0-9_]*$/;

    let currentPrimaryLang = 'en';
    let templatesMetadata = {};
    let templateGroupsDefs = {}; // Record<string, {displayName: string, description: string}>; key = group name
    let savePropertiesTimer = undefined;
    let cancelSettingsChangesRequestSent = false;

    /** @type {{type: 'input' | 'tags' | 'translation', id?: string} | undefined} */
    let lastFocusedElement = undefined;

    /** @type Array<RegExp> */
    const valuesRegexValidators = [];

    window.addEventListener('blur', function () {
        console.warn('window lost focus ');
    });

    window.addEventListener('focus', function () {
        console.warn('window got focus');
    });

    // returns error string if value is invalid, otherwise returns empty string
    function validateResourceValue(value) {
        if (value !== undefined && value !== null && typeof value === 'string' && value.length > 0) {
            return valuesRegexValidators.every(regex => !regex.test(value));
        }
        return true;
    }


    function arrayRemoveAll(source, predicate, mutate) {
        if (!source || source.length === 0) {
            return [];
        }
        if (mutate) {
            for (let i = source.length - 1; i >= 0; i--) {
                if (predicate(source[i])) {
                    source.splice(i, 1);
                }
            }
            return source;
        }
        return source.filter(item => !predicate(item));
    }


    function getCultureName(lang) {
        if (lang && lang !== '') {
            const culture = usedCultures.find(x => x.name === lang);
            return culture ? `${culture?.engName ?? ''} (${culture?.name ?? ''})` : lang;
        }
        return lang ?? '';
    }

    function logMsg(...args) {
        console.log(`%c[APP]`, 'background:silver;color:black;', ...args);
    }

    function getDefaultModelProperties() {
        return {
            // visible: false,
            // saving: false,
            // codeGeneratorError: undefined,
            codeGenerator: { templateId: '' }
        };
    }

    function getDefaultModelPropsCurrents() {
        return { visible: false, saving: false, codeGeneratorError: undefined };
    }

    function isParametersEditableSpan(htmlElem) {
        return htmlElem.tagName === 'SPAN' && htmlElem.contentEditable === 'true' && htmlElem.closest('tags.tagify') !== undefined;
    }

    function postMessage(message, logText) {
        if (message === undefined || message === null) {
            throw new Error('[postMessage] message is undefined or null!');
        }

        const command = message.command;
        if (command === undefined || command === null) {
            throw new Error('[postMessage] message.command is undefined or null!');
        }

        if (logText === undefined || logText === null) {
            logMsg(`sending message '${command}' , message: `, message);
        } else {
            logMsg(`${logText}, sending message '${command}' , message: `, message);
        }

        vscode.postMessage(message);
    }

    document.addEventListener('focusin', (event) => {
        const target = event.target;
        if (!target) {
            return;
        }

        const divApp = target.closest('div#app');
        if (!divApp) {
            return;
        }

        if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) {
            const blockPanel = target.closest('div#block-panel');
            if (blockPanel) {
                //console.warn('Focused element is inside block panel, ignoring.', target);
                return;
            }

            let type = 'input';
            let id = target.id;
            if (target.tagName === 'TEXTAREA' && !id) {
                type = 'translation';
                id = target.dataset['lang'];
            }

            if (!id) {
                console.warn(`Focused element '${target.tagName}' does not have an id!`, target);
                throw new Error(`Focused element '${target.tagName}' does not have an id nor data-lang!`);
            }

            lastFocusedElement = {
                type: type,
                id: id,
            };
        } else if (isParametersEditableSpan(target)) {
            lastFocusedElement = {
                type: 'tags'
            };
        }
    });

    document.addEventListener('keydown', (event) => {
        // filter out Ctrl+Enter key combination so vscode does not handle it and forward it to tree which will send 'focus' back to this page :-)
        if (event.ctrlKey === true && event.keyCode === 13) { // ENTER
            event.preventDefault();
            event.stopPropagation();

            if (window.pageApp && window.pageApp.modelPropsCurrents.visible) {
                window.pageApp.saveProperties();
            }

        } else if (!event.ctrlKey && !event.shiftKey && !event.metaKey) {
            if (event.keyCode === 27) { // ESC
                // Escape key pressed, close all tooltips
                if (isAnyTooltipVisible()) {
                    logMsg('Escape key pressed, closing all tooltips');
                    tooltipsMap.forEach(item => {
                        removeTooltip(item);
                    });
                }

                if (window.pageApp && window.pageApp.modelPropsCurrents.visible) {
                    window.pageApp.cancelProperties();
                }

                if (isParametersEditableSpan(event.target)) {
                    window.pageApp.internalEditParameters(true);
                    document.getElementById('editParameters').focus();
                }
            } else if (event.key === 'F2') {

                const item = window.pageApp.item;
                const data = { elementType: item.elementType, paths: toRaw(item.paths) };
                postMessage({ command: 'select', reload: false, ...data }, `Page reload for ${item.elementType} (${window.pageApp.fullPath})`);

                event.preventDefault();
                event.stopPropagation();
            }
        }
    });


    const domBody = document.getElementsByTagName('body')[0];

    window.addEventListener('message', event => {
        message = event.data;
        logMsg(`Received message '${message.command}', action: '${message.action}'`, message);
        switch (message.command) {
            case 'init': {
                /*
                command: 'init';
                templatesMetadata: Record<string, TemplateMetadataDefinition>;
                */
                templatesMetadata = structuredClone(message.templatesMetadata) || {};

                const regexValidators = message.valuesRegexValidators;
                if (regexValidators && Array.isArray(regexValidators)) {
                    valuesRegexValidators.length = 0; // clear existing validators
                    regexValidators.forEach(regexStr => {
                        try {
                            // deserialize regex string
                            const match = regexStr.match(/^\/(.*)\/([a-z]*)$/);
                            if (match.length > 2) {
                                const flags = match[2] || '';
                                valuesRegexValidators.push(new RegExp(match[1], flags.replace(/[gy]/g, '')));
                            }
                        } catch (e) {
                            console.error(`Invalid regex '${regex}' in valuesRegexValidators: `, e);
                        }
                    });
                }

                break;
            }
            case 'showProperties': {
                window.pageApp.showProperties();
                break;
            }
            case 'invalidData': {
                /*
                command: 'invalidData';
                field: string
                fullPath: string;
                message: string;
                action: 'add' | 'remove';
                */

                if (!window.pageApp.item || window.pageApp.fullPath !== message.fullPath) {
                    return;
                }

                const elem = document.getElementById(message.field) || domBody;
                const uid = `${message.field}-invalid`;

                if (message.action === 'add') {
                    /** @type {InvalidDataError} */
                    const error = {
                        uid: uid,
                        message: message.message,
                        type: 'server',
                        element: elem
                    };
                    window.pageApp.updateInvalidData(error);
                } else if (message.action === 'remove') {
                    window.pageApp.removeInvalidData(uid, 'server', elem);
                }

                break;
            }
            case 'updatePaths': {
                /*
                command: 'updatePaths'
                paths: string[];
                */

                if (window.pageApp.item && message.paths) {
                    window.pageApp.supressOnChange = 'onetime';

                    window.pageApp.$nextTick(() => {
                        window.pageApp.item.paths = message.paths;
                    });
                }

                break;
            }
            case 'loadPage': {
                /*
                command: 'loadPage';
                element: Object;
                file: string;
                cultures: CultureInfo[];
                primaryLang: string;
                modelProperties: PageModelProperties;
                autoFocus: boolean;
                restoreFocusedInput?: boolean;
                */
                domBody.dataset['loading'] = 'true';
                const element = message.element;
                const modelProperties = message.modelProperties;
                const autoFocus = message.autoFocus ?? false;
                const restoreFocusedInput = message.restoreFocusedInput ?? false;

                usedCultures = message.cultures || [];
                if (usedCultures.length === 0) {
                    usedCultures = [{
                        name: 'en',
                        engName: 'English',
                        nativeName: 'English',
                        lcid: 1033,
                        isNeutral: true
                    }];
                }
                currentPrimaryLang = message.primaryLang ?? 'en';
                const oldElement = window.pageApp.item;

                window.pageApp.loading = true;
                window.pageApp.item = undefined;
                window.pageApp.paramsEnabled = false;
                window.pageApp.supressOnChange = undefined;
                window.pageApp.forceOnChange = false;
                window.pageApp.blockPanelVisible = false;

                window.pageApp.modelProperties = getDefaultModelProperties();
                window.pageApp.modelPropertiesBackup = structuredClone(getDefaultModelProperties());
                window.pageApp.modelPropsCurrents = getDefaultModelPropsCurrents();
                window.pageApp.templateDefinition = {};

                window.pageApp.$nextTick(() => {
                    setNewElement(element, modelProperties);
                    window.pageApp.loading = false;

                    window.pageApp.$nextTick(() => {
                        window.pageApp.bindTagParameters(oldElement);
                        window.pageApp.recheckInvalidData(true);
                        window.pageApp.debouncedResize();
                        window.pageApp.restoreLastFocused(restoreFocusedInput);

                        // if (autoFocus) {
                        //     window.pageApp.focusEditor();
                        // }
                    });
                });
                delete domBody.dataset['loading'];
                break;
            }

            case 'savePropertiesResult': {
                /*
                command: 'savePropertiesResult';
                success: boolean;
                error: string | undefined;
                */

                if (window.pageApp) {
                    window.pageApp.handleSavePropertiesResult(message.error);
                }

                break;
            }

            case 'confirmQuestionResult': {
                /*
                 command: 'resetSettingsResult'
                 id: ConfirmQuestionTypes;
                 confirmed: boolean;
                 result: unknown | undefined;
                */

                switch (message.id) {
                    case 'resetSettings': {
                        if (message.confirmed) {
                            if (message.result && window.pageApp.modelProperties && window.pageApp.modelProperties.codeGenerator) {
                                window.pageApp.modelProperties.codeGenerator.settings = message.result;
                                window.pageApp.modelPropsCurrents.codeGeneratorError = undefined;
                            }
                        }
                        break;
                    }
                    case 'cancelSettingsChanges': {
                        cancelSettingsChangesRequestSent = false;
                        if (message.confirmed) {
                            window.pageApp.closePropertiesDialog(true);
                        } else {
                            window.pageApp.$refs.layoutMode.focus();
                        }
                        break;
                    }
                }

                break;
            }

            case 'requestPageReload': {
                const item = window.pageApp.item;
                const data = { elementType: item.elementType, paths: toRaw(item.paths) };
                postMessage({ command: 'select', reload: true, ...data }, `Page reload for ${item.elementType} (${window.pageApp.fullPath})`);
                break;
            }

            case 'focus': {
                window.pageApp.focusEditor();
                break;
            }

            case 'showInputBoxResult': {
                /*
                command: 'showInputBoxResult';
                id: string;
                result: string | undefined;
                */

                if (message.id === 'editElementName') {
                    window.pageApp.completeEditElementName(message.result);
                }

                break;
            }

            case 'requestRename': {
                window.pageApp.editElementName();
                break;
            }

            case 'blockEditor': {
                /*
                command: 'blockEditor',
                block: boolean
                */

                window.pageApp.blockPanelVisible = message.block;
                break;
            }
        }
    });

    function setNewElement(element, modelProperties) {
        if (!element) { return; }

        /** @type TranslationItem[] */
        const translations = [];

        if (element.values === undefined || element.values === null) {
            element.values = [];
        }

        /** @type ResourceValueElement | undefined */
        const primaryValue = element.values.find(x => x.languageName === currentPrimaryLang);
        translations.push({
            valueRef: primaryValue ?? { languageName: currentPrimaryLang, value: '' },
            culture: getCultureName(currentPrimaryLang),
            isPrimary: true,
            invalidMessage: ''
        });


        /** @type TranslationItem[] */
        const rest_translations = [];
        usedCultures.forEach(culture => {
            if (culture.name !== currentPrimaryLang) {
                const value = element.values.find(x => x.languageName === culture.name);
                rest_translations.push({
                    valueRef: value ?? { languageName: culture.name, value: '' },
                    culture: getCultureName(culture.name),
                    isPrimary: false,
                    invalidMessage: ''
                });
            }
        });
        if (rest_translations.length > 0) {
            rest_translations.sort((a, b) => a.culture.localeCompare(b.culture, undefined, { sensitivity: 'base' }));
            translations.push(...rest_translations);
        }


        element.translations = translations;
        logMsg(`Setting new element:  ${getFullPath(element)} (${element.elementType})`, element, ' and modelProperties: ', modelProperties);
        window.pageApp.item = element;

        window.pageApp.modelProperties = modelProperties ?? getDefaultModelProperties();
        window.pageApp.modelProperties.layoutModes = [{ name: 'Hierarchical tree', value: true }, { 'name': 'Flat list', value: false }];
        window.pageApp.modelProperties.valuesEolOptions = [{ name: 'Default', value: '' }, { name: 'LF', value: 'LF' }, { 'name': 'CRLF', value: 'CRLF' }];
        window.pageApp.modelPropertiesBackup = modelProperties
            ? structuredClone(modelProperties)
            : getDefaultModelProperties();
        window.pageApp.modelPropsCurrents = getDefaultModelPropsCurrents();

        const templateId = modelProperties.codeGenerator?.templateId ?? '';


        const templateDefinition = Object.prototype.hasOwnProperty.call(templatesMetadata, templateId)
            ? structuredClone(templatesMetadata[templateId])
            : undefined;

        templateGroupsDefs = {};
        if (templateDefinition) {
            const settingsObj = {};
            for (const [group, settings] of Object.entries(templateDefinition.settings)) {
                templateGroupsDefs[group] = {
                    displayName: settings.displayName ?? group,
                    description: settings.description ?? ''
                };
                settingsObj[group] = {};
                if (settings && settings.properties && Array.isArray(settings.properties)) {
                    settings.properties.forEach(setting => {
                        settingsObj[group][setting.name] = setting;
                    });
                }
            }

            templateDefinition.settings = settingsObj;
        }

        window.pageApp.templateDefinition = templateDefinition;
    }

    function getFullPath(element, noRoot) {
        let paths = element.paths;
        if (element && paths && paths.length > 0) {
            if (noRoot === true) {
                paths = paths.slice(1);
            }

            return '/' + paths.join('/');
        }
        return '';
    }

    // Add the method to String prototype
    String.prototype.toPascalCase = function () {
        if (!this) {
            return "";
        }

        return _.startCase(this);
    };

    /**
     * @typedef {Object} TooltipItem
     * @property {HTMLDivElement} tooltip
     * @property {string} uid
     * @property {number} date
     * @property {number} hideTimeoutId
     * @property {number} removeTimeoutId
     */

    /** @type {Map<string, TooltipItem>} */
    const tooltipsMap = new Map();

    let handleClickOutsideInitialized = false;

    function isAnyTooltipVisible() {
        return tooltipsMap.size > 0;
    }

    /** @param {TooltipItem} item */
    function removeTooltip(item) {
        if (item && item.tooltip) {
            if (item.hideTimeoutId) { clearTimeout(item.hideTimeoutId); }
            if (item.removeTimeoutId) { clearTimeout(item.removeTimeoutId); }
            if (item.tooltip.isConnected) { item.tooltip.remove(); }
            if (tooltipsMap.has(item.uid)) {
                tooltipsMap.delete(item.uid);
            }
            item.tooltip = null;
        }
    };

    /** @param {TooltipItem} item */
    function cancelRemoval(item) {
        if (item && item.tooltip) {
            if (item.hideTimeoutId) { clearTimeout(item.hideTimeoutId); }
            if (item.removeTimeoutId) { clearTimeout(item.removeTimeoutId); }
            item.tooltip.classList.remove('tooltip-fade-out');
        }
    }

    function hideTooltip(uid) {
        const item = tooltipsMap.get(uid);
        if (item) {
            cancelRemoval(item);
            removeTooltip(item);
        }
    }


    function handleClickOutside(event) {
        const translations = document.getElementById('translations');
        if (translations) {
            const focusedElem = document.activeElement;
            translations.querySelectorAll('tr>td[data-focused]').forEach(td => {
                const next = td.nextElementSibling;
                if (next) {
                    const textArea = next.querySelector('textarea');
                    if (textArea === focusedElem) {
                        return;
                    }
                }

                delete td.dataset['focused'];
            });
        }

        if (!handleClickOutsideInitialized) {
            return;
        }

        // remove all tooltipList
        if (tooltipsMap.size > 0) {
            const now = Date.now();
            tooltipsMap.values().filter(x => (now - x.date) > 300).forEach(item => {
                if (item.tooltip && !item.tooltip.contains(event.target)) {
                    cancelRemoval(item);
                    removeTooltip(item);
                }
            });
        }
    }

    const debouncedHandleClickOutside = _.debounce(handleClickOutside, 200, { leading: false, trailing: true });
    document.addEventListener('click', debouncedHandleClickOutside, true);

    // property - @TemplateMetadataSettings
    function convertValueForProperty(value, property) {
        if (value === undefined || value === null) {
            return property.default;
        }

        const valueType = typeof value;
        switch (property.type) {
            case 'boolean': {
                switch (valueType) {
                    case 'string':
                        if (value === 'true') {
                            return true;
                        } else if (value === 'false') {
                            return false;
                        }
                        break;
                    case 'boolean':
                        return value;
                    case 'number':
                        return value !== 0;
                    default:
                        return property.default;
                }

                break;
            }
            case 'string':
                return valueType === 'string' ? value : String(value);
            case 'list': {
                if (Array.isArray(property.values)) {
                    const found = property.values.find(pv => typeof pv.value === valueType && pv.value === value);
                    return found ? found.value : property.default;
                }

                return property.default;
            }
            case 'number':
                return valueType === 'number' ? value : Number(value);
            default:
                throw new Error(`Unsupported setting type!`);
        }
    }

    function showTooltip(uid, message, anchorEl, useTopAnchor, zIndex) {
        const removeTimeout = 3000;
        const hideTimeout = 1000;
        useTopAnchor = useTopAnchor ?? false;
        const oldTooltipItem = tooltipsMap.get(uid);
        if (oldTooltipItem) {
            removeTooltip(oldTooltipItem);
        }

        let tooltip = document.createElement('div');
        tooltip.textContent = message;
        tooltip.classList.add('tooltip'); // Add the main tooltip class
        const tooltipItem = {
            tooltip: tooltip,
            uid: uid,
            date: Date.now(),
            hideTimeoutId: null,
            removeTimeoutId: null
        };
        tooltipsMap.set(uid, tooltipItem);

        const scheduleRemoval = () => {
            if (tooltipItem.tooltip) {
                tooltipItem.hideTimeoutId = window.setTimeout(() => {
                    if (tooltipItem.tooltip) {
                        tooltipItem.tooltip.classList.add('tooltip-fade-out');
                    }

                    tooltipItem.removeTimeoutId = window.setTimeout(() => {
                        removeTooltip(tooltipItem);
                    }, removeTimeout);
                }, hideTimeout);
            }
        };

        tooltip.addEventListener('mouseenter', () => { cancelRemoval(tooltipItem); });
        tooltip.addEventListener('mouseleave', scheduleRemoval);
        tooltip.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelRemoval(tooltipItem);
            removeTooltip(tooltipItem);
        });

        document.body.appendChild(tooltip);
        const rect = anchorEl.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        const anchorX = useTopAnchor ? rect.top : rect.bottom;
        tooltip.style.top = `${anchorX + window.scrollY + 5}px`;
        if (zIndex) {
            tooltip.style.zIndex = zIndex;
        }

        if (!handleClickOutsideInitialized) {
            setTimeout(() => {
                if (!handleClickOutsideInitialized && tooltipItem.tooltip) {
                    handleClickOutsideInitialized = true;
                }
            }, 200);
        }

        scheduleRemoval();
    }

    let tagifyParams = null;

    const { createApp, toRaw } = Vue;
    const debounceOpts = {
        leading: false,
        trailing: true
    };
    const debounceWait = 500;

    /** @type PageData */
    const newPageItem = {
        item: undefined,
        loading: true,
        paramsEnabled: false,
        invalidData: {
            /** @type InvalidDataError[] */
            errors: []
        },
        supressOnChange: undefined,
        forceOnChange: false,
        modelProperties: getDefaultModelProperties(),
        modelPropertiesBackup: getDefaultModelProperties(),
        modelPropsCurrents: getDefaultModelPropsCurrents(),
        templateDefinition: {},
        blockPanelVisible: false
    };

    window.pageApp = createApp({
        data() { return newPageItem; },

        computed: {
            translationCount() {
                return usedCultures.length;
            },

            fullPath() {
                return getFullPath(this.item);
            },

            fullPathNoRoot() {
                return getFullPath(this.item, true);
            },

            isResource() {
                return this.item && this.item.elementType === 'resource';
            },

            isModelRoot() {
                return this.item && this.item.elementType === 'model';
            },

            isCategoryLike() {
                return this.item && this.item.elementType === 'category' || this.item.elementType === 'model';
            },

            getGroupDisplayName() {
                return (group) => {
                    return Object.prototype.hasOwnProperty.call(templateGroupsDefs, group)
                        ? templateGroupsDefs[group].displayName
                        : group;
                };
            },

            getGroupDescription() {
                return (group) => {
                    return Object.prototype.hasOwnProperty.call(templateGroupsDefs, group)
                        ? templateGroupsDefs[group].description
                        : group;
                };
            },

            getValuesEolOptionsInfo() {
                return () => {
                    const eol = this.modelProperties.values?.eol;
                    if (eol === undefined) {
                        return 'Line endings are not modified, use system default.';
                    }

                    return eol === 'LF' ? 'Line endings are set to LF (\\n).' : 'Line endings are set to CRLF (\\r\\n).';
                };
            },

            setValuesEolOptions() {
                return (value) => {
                    this.modelProperties.values.eol = value === '' ? undefined : value;
                };
            },

            setValuesSanitize() {
                return (value) => {
                    this.modelProperties.values.sanitize = value === false ? undefined : value;
                };
            },

            getCodeGeneratorPropertyReadonly() {
                return (group, name) => {
                    let readonly = false;

                    const settings = this.modelProperties.codeGenerator?.settings;
                    const groupSettings = settings ? settings[group] : undefined;
                    if (groupSettings) {
                        const templateGroup = this.templateDefinition.settings[group];
                        if (templateGroup && templateGroup[name] && name !== 'Enabled') {
                            const propertyEnabled = templateGroup['Enabled'];

                            // if template group has 'Enabled' property, check its value 
                            if (propertyEnabled) {
                                let enabledValue = groupSettings['Enabled'];
                                if (enabledValue === undefined || enabledValue === null) {
                                    enabledValue = propertyEnabled.default;
                                }
                                readonly = !enabledValue;
                            }
                        }
                    } else {
                        console.warn(`[getCodeGeneratorPropertyReadonly] Group '${group}' not found in code generator settings.`);
                    }

                    return readonly;
                };
            },

            getCodeGeneratorPropertyValue() {
                return (group, name) => {
                    const settings = this.modelProperties.codeGenerator?.settings;
                    const groupSettings = settings ? settings[group] : undefined;

                    return groupSettings ? groupSettings[name] : undefined;
                };
            },

            setCodeGeneratorPropertyValue() {
                return (group, name, value) => {
                    const settings = this.modelProperties.codeGenerator?.settings;
                    const groupSettings = settings ? settings[group] : undefined;

                    if (groupSettings) {
                        const templateGroup = this.templateDefinition.settings[group];
                        if (templateGroup && templateGroup[name]) {
                            const property = templateGroup[name];

                            groupSettings[name] = convertValueForProperty(value, property);
                        }
                    } else {
                        console.warn(`[setCodeGeneratorPropertyValue] Group '${group}' not found in code generator settings.`);
                    }
                };
            },

            settingsError() {
                /** @type SettingsError | undefined */
                const error = this.modelPropsCurrents.codeGeneratorError;
                return error ? `${error.group} / ${error.name} / ${error.message}` : '';
            }
        },

        created() {
            this.debouncedOnChange = _.debounce(this.onChange, debounceWait, debounceOpts);
            this.$watch('item', this.debouncedOnChange, { deep: true, immediate: false });
            this.debouncedResize = _.debounce(this.resizeAllTextAreas, 100, debounceOpts);
        },

        mounted() {
            logMsg('Page app mounted');
            // Use nextTick to ensure the DOM has been updated after the initial render.
            this.$nextTick(() => {
                this.debouncedResize();
            });
            window.addEventListener('resize', this.debouncedResize);
        },

        unmounted() {
            this.debouncedOnChange.cancel();
            window.removeEventListener('resize', this.debouncedResize);
            this.debouncedResize.cancel();
        },

        methods: {
            onChange(value, oldValue) {
                const supressOnChange = this.supressOnChange;
                const forceOnChange = this.forceOnChange;
                const supressed = supressOnChange !== undefined;
                const canChange = oldValue !== undefined || forceOnChange;

                try {
                    if (this.item && canChange && !this.loading && !supressed) {
                        const data = toRaw(this.item);

                        /** @type {InvalidDataInfo} */
                        const invalidData = this.invalidData;
                        //if (invalidData.errors.length > 0) 
                        {
                            this.recheckInvalidData(true);

                            const nonServerError = invalidData.errors.find(x => x.type !== 'server' && x.type !== 'badunicodechars');

                            if (nonServerError) {
                                if (!isAnyTooltipVisible()) {
                                    showTooltip(nonServerError.uid, nonServerError.message, nonServerError.element);
                                }

                                logMsg('Invalid data (non server error found), will not send data!', data);
                                return;
                            }
                        }

                        if (data) {
                            postMessage({ command: 'update', data: data }, 'Data changed');
                        }
                    }
                } finally {
                    if (supressed && supressOnChange === 'onetime') {
                        logMsg(`Suppressing onChange event for one time, resetting supressOnChange`);
                        this.supressOnChange = undefined;
                    }

                    if (forceOnChange) {
                        this.forceOnChange = false;
                    }
                }
            },

            focusOnName() {
                if (!this.$refs.name) {
                    return;
                }

                /** @type {InvalidDataInfo} */
                const invalidData = this.invalidData;
                const error = invalidData.errors.find(x => x.element === this.$refs.name);
                if (error) {
                    logMsg(`Focusing on name input, found error: `, error);
                    showTooltip(error.uid, error.message, this.$refs.name);
                }
            },

            bindTagParameters(oldValue) {
                const destroy = () => {
                    if (tagifyParams) {
                        tagifyParams.destroy();
                        tagifyParams.DOM.originalInput.value = '';
                        tagifyParams = null;
                    }
                };

                if (oldValue && oldValue.elementType === 'resource' && !this.isResource) {
                    destroy();
                }

                if (this.isResource) {
                    if (tagifyParams) {
                        destroy();
                    }

                    this.createParametersTags();
                }
            },

            removeInvalidData(uid, type, elem) {
                logMsg(`Remove invalid data for uid '${uid}' of type '${type}'`);

                /** @type {InvalidDataInfo} */
                const invalidData = this.invalidData;
                if (invalidData.errors.length > 0) {
                    invalidData.errors = invalidData.errors.filter(x => x.uid !== uid && x.type !== type);
                }

                hideTooltip(uid);

                if (elem) {
                    delete elem.dataset['error'];
                }
            },

            /** @param {InvalidDataError} error */
            updateInvalidData(error) {
                if (error === undefined || error === null) {
                    throw new Error('InvalidDataError is undefined or null');
                }

                /** @type {InvalidDataInfo} */
                const invalidData = this.invalidData;
                let item = invalidData.errors.find(x => x.uid === error.uid);
                if (item === undefined) {
                    item = error;
                    invalidData.errors.push(item);
                    logMsg(`Adding new invalid data error: `, item);
                } else {
                    item.message = error.message;
                    item.type = error.type;
                    item.element = error.element;
                    logMsg(`Updating existing invalid data error: `, item);
                }

                if (item.element) {
                    item.element.dataset['error'] = 'true';
                }

                // do not show tooltip for 'badunicodechars' type, as it is handled separately
                if (item.type !== 'badunicodechars') {
                    showTooltip(item.uid, item.message, item.element);
                }
            },

            recheckInvalidData(checkTranslations) {
                logMsg(`Rechecking invalid data`);
                /** @type {InvalidDataInfo} */
                const invalidData = this.invalidData;

                if (tagifyParams) {
                    // Remove all errors of type 'tags'
                    invalidData.errors = invalidData.errors.filter(x => x.type !== 'tags');

                    // scan all tags for invalid data and add them to the invalidData.errors
                    tagifyParams.getTagElms().forEach(node => {
                        const tagData = tagifyParams.getSetTagData(node);
                        if (tagData && tagData.__isValid !== true) {
                            const error = {
                                uid: `params-invalid`,
                                message: tagData.__isValid,
                                type: 'tags',
                                element: node
                            };
                            this.updateInvalidData(error);
                        }
                    });
                }

                if (checkTranslations === true && this.item.translations) {
                    this.item.translations.forEach(translation => {
                        const valid = validateResourceValue(translation.valueRef.value);
                        const languageName = translation.valueRef.languageName;
                        if (!valid) {
                            if (!invalidData.errors.some(x => x.uid === languageName && x.type === 'badunicodechars')) {
                                const msg = `Invalid unicode characters found in ${getCultureName(languageName)} translation.`;
                                this.updateInvalidData({ uid: languageName, message: msg, type: 'badunicodechars' });
                            }
                        } else {
                            const invalidData = this.invalidData;
                            const errCount = invalidData.errors.length;
                            if (errCount > 0) {
                                invalidData.errors = arrayRemoveAll(invalidData.errors, x => x.uid === languageName && x.type === 'badunicodechars', false);
                                const errCount2 = invalidData.errors.length;
                                logMsg(`Removed ${errCount - errCount2} 'badunicodechars' error for language '${languageName}'.`);
                            }
                        }
                    });
                }
            },

            getTranslationUnicodeError(translation) {
                /** @type {InvalidDataInfo} */
                const invalidData = this.invalidData;
                const error = invalidData.errors.find(x => x.type === 'badunicodechars' && x.uid === translation.valueRef.languageName);
                return error ? error.message : '';
            },

            sanitizeTranslation(translation) {
                if (translation && translation.valueRef) {
                    if (this.blockPanelVisible) {
                        logMsg('Block panel is already visible, ignoring "sanitizeTranslation"');
                        return;
                    }

                    this.blockPanelVisible = true;

                    if (this.item.elementType !== 'resource') {
                        logMsg('Sanitize translation is only supported for resource elements.');
                        return;
                    }

                    const languageName = translation.valueRef.languageName;
                    const multipleLangs = this.invalidData.errors.filter(x => x.type === 'badunicodechars').length > 1;
                    const paths = toRaw(this.item.paths);

                    postMessage({
                        command: 'sanitizeTranslation',
                        language: languageName,
                        multipleLangs,
                        paths
                    });
                }
            },

            editElementName() {
                if (this.blockPanelVisible) {
                    logMsg('Block panel is already visible, ignoring "editElementName"');
                    return;
                }

                this.blockPanelVisible = true;

                const data = { elementType: this.item.elementType, paths: toRaw(this.item.paths) };
                postMessage({
                    command: 'showInputBox',
                    id: 'editElementName',
                    prompt: `Enter new name for ${this.item.elementType}`,
                    placeHolder: this.item.elementType.toPascalCase() + ' name',
                    title: `Edit ${this.item.elementType} name (${this.fullPath})`,
                    value: this.item.name,
                    data
                }, `Requesting showinputbox for ${this.item.elementType} name`);
            },

            completeEditElementName(name) {
                this.blockPanelVisible = false;
                if (name !== undefined && name !== null) {
                    this.item.name = name;
                }
            },

            editParameters(e) {
                const isCancel = e.target.dataset['cancel'] === 'true';
                this.internalEditParameters(isCancel);
            },

            internalEditParameters(isCancel) {
                this.paramsEnabled = !this.paramsEnabled;
                tagifyParams.setDisabled(!this.paramsEnabled);

                if (!this.paramsEnabled) {
                    tagifyParams.DOM.input?.parentNode?.classList.remove('focus-border');

                    if (isCancel) {
                        const tags = this.item.parameters
                            .sort((a, b) => a.order - b.order)
                            .map(param => ({
                                value: param.name,
                                order: param.order
                            }));
                        tagifyParams.loadOriginalValues(tags);
                    } else {
                        this.recheckInvalidData();
                        /** @type {InvalidDataInfo} */
                        const invalidData = this.invalidData;
                        if (invalidData.errors.some(x => x.type === 'tags')) {
                            this.paramsEnabled = true;
                            tagifyParams.setDisabled(false);
                            return;
                        }

                        const tags = tagifyParams.value
                            .sort((a, b) => a.order - b.order)
                            .map(tag => ({
                                name: tag.value,
                                order: tag.order
                            }));
                        this.item.parameters = tags;
                    }
                } else {
                    this.focusParameters();
                }
            },

            openResource() {
                const data = { elementType: this.item.elementType, paths: toRaw(this.item.paths) };
                postMessage({ command: 'select', ...data }, `Open resource ${this.item.elementType} (${this.fullPath})`);
            },

            focusParameters() {
                const input = tagifyParams.DOM.input;
                if (input) {
                    input.focus();
                }
            },

            focusTranslation(translation) {
                if (translation && translation.valueRef) {
                    const index = this.item.translations.findIndex(t => t === translation);
                    if (index !== -1 && this.$refs.translationTextArea && this.$refs.translationTextArea[index]) {
                        const textarea = this.$refs.translationTextArea[index];
                        textarea.focus();
                    }
                }
            },

            lockTranslation(translation) {
                if (translation && translation.valueRef) {
                    translation.valueRef.locked = !translation.valueRef.locked;
                    this.debouncedOnChange();
                }
            },

            autoResizeTextarea(event) {
                this.resizeTextarea(event.target);
            },

            setTranslationValue(event) {
                this.resizeTextarea(event.target);
            },

            focusOnTranslation(event) {
                if (!event.target) {
                    return;
                }

                const row = event.target.closest('tr');
                const cell = row?.querySelector('td:first-child');
                if (cell) {
                    cell.dataset['focused'] = 'true';
                }
            },

            blurOnTranslation(event) {
                if (!event.target) {
                    return;
                }

                const row = event.target.closest('tr');
                const cell = row?.querySelector('td:first-child');
                if (cell) {
                    delete cell.dataset['focused'];
                }
            },

            focusOnAllowResources(event) {
                if (!event.target) {
                    return;
                }

                const label = event.target.closest('label');
                if (label) {
                    label.dataset['focused'] = 'true';
                }
            },

            blurOnAllowResources() {
                if (!event.target) {
                    return;
                }

                const label = event.target.closest('label');
                if (label) {
                    delete label.dataset['focused'];
                }
            },

            createParametersTags() {
                const input = this.$refs.parameters;
                const self = this;

                function validateTag(tagData) {
                    if (!regexValidCharacters.test(tagData.value)) {
                        return 'Only alphanumeric characters and underscores are allowed.';
                    }

                    return true;
                }

                const options = {
                    editTags: {
                        clicks: 2,
                        keepInvalid: false
                    },
                    duplicates: false,
                    trim: true,
                    createInvalidTags: true,
                    dropdown: {
                        enabled: false
                    },

                    templates: {
                        tag: function (tagData) {
                            const title = tagData.__isValid !== true ? tagData.__isValid : 'Double click to edit parameter';
                            const txt1 = tagData.value || '';
                            // const txt2 = tagData.__isValid !== true ? '&#9679;' : `(${tagData.order + 1})`;
                            const txt2 = tagData.__isValid !== true ? '&#9679;' : `(${tagData.order})`;

                            return `<tag title='${title}'
                contenteditable='false'
                spellcheck='false'
                tabIndex="${this.settings.a11y.focusableTags ? 0 : -1}"
				draggable="true"
                class="${this.settings.classNames.tag}"
                ${this.getAttributes(tagData)}>
            <x title='' class='${this.settings.classNames.tagX}' role='button' aria-label='remove tag'></x>
            <div><span autocapitalize="false" autocorrect="off" spellcheck="false" class="${this.settings.classNames.tagText}">${txt1} ${txt2}</span></div>
        </tag>
    `;
                        }
                    },

                    validate(tagData) {
                        return validateTag(tagData);
                    },

                    transformTag: function (tagData, originalData) {
                        if (tagData.order === undefined) {
                            const maxOrder = Math.max(...this.value.map(x => x.order), -1);
                            tagData.order = maxOrder + 1;
                        }
                    }
                };

                const tagify = new Tagify(input, options);
                tagify.setDisabled(true);

                tagify.DOM.input.addEventListener('focus', function () {
                    const tagsElem = this.parentNode;
                    if (tagsElem) {
                        tagsElem.classList.add('focus-border');
                    }
                });

                tagify.DOM.input.addEventListener('blur', function () {
                    const tagsElem = this.parentNode;
                    if (tagsElem) {
                        // logMsg('Tagify input blured');
                        tagsElem.classList.remove('focus-border');
                    }
                });

                tagifyParams = tagify;

                const tags = this.item.parameters
                    .sort((a, b) => a.order - b.order)
                    .map(param => ({
                        value: param.name,
                        order: param.order
                    }));
                tagify.addTags(tags);

                tagify.on('keydown', function (e) {
                    const event = e.detail.event;
                    if (event.ctrlKey === true && event.keyCode === 13 &&
                        !tagify.state.inputText && // assuming user is not in the middle or adding a tag
                        !tagify.state.editing      // user not editing a tag     
                    ) {
                        e.preventDefault();
                        e.stopPropagation();

                        self.$nextTick(() => {
                            self.editParameters({ target: { dataset: { cancel: 'false' } } });
                            document.getElementById('editParameters').focus();
                        });
                    }
                });

                tagify.on('edit:start', function ({ detail: { tag, data } }) {
                    tagify.setTagTextNode(tag, data.value);
                });

                tagify.on('remove', function ({ detail: { tag, data } }) {
                    reflectChanges();
                });

                tagify.on('invalid', function ({ detail }) {
                    /** @type {InvalidDataError} */
                    const error = {
                        uid: `params-invalid`,
                        message: detail.message,
                        type: 'tags',
                        element: tagify.DOM.input ?? domBody
                    };
                    self.updateInvalidData(error);
                });

                tagify.on('edit:updated', function ({ detail: { data, tag } }) {
                    const isValid = validateTag(data);
                    tag = tagify.getTagElmByValue(data.value);
                    if (isValid !== true) {
                        tagify.replaceTag(tag, { ...data, __isValid: isValid });

                        /** @type {InvalidDataError} */
                        const error = {
                            uid: `params-invalid`,
                            message: isValid,
                            type: 'tags',
                            element: tagify.DOM.input ?? domBody
                        };
                        self.updateInvalidData(error);

                    } else {
                        const newTagData = { ...data, __isValid: true };
                        delete newTagData.title;
                        delete newTagData["aria-invalid"];
                        delete newTagData.class;
                        delete newTagData.__tagId;
                        tagify.replaceTag(tag, newTagData);
                        self.recheckInvalidData();
                    }
                });

                tagify.on('add', function ({ detail: { data, tag } }) {
                    const isValid = validateTag(data);
                    if (isValid !== true) {
                        tagify.replaceTag(tag, { ...data, __isValid: isValid });
                    }
                    self.recheckInvalidData();
                });

                var dragsort = new DragSort(tagify.DOM.scope, {
                    selector: '.' + tagify.settings.classNames.tag,
                    callbacks: {
                        dragEnd: onDragEnd
                    }
                });

                function onDragEnd(elm) {
                    reflectChanges();
                }

                function reflectChanges() {
                    const tags = [];
                    tagify.getTagElms().forEach((node, idx) => {
                        const tagData = tagify.getSetTagData(node);
                        if (tagData) {
                            tagData.order = idx;
                            tagify.getSetTagData(node, tagData);
                            tags.push(tagData);
                        }
                    });
                    tagify.updateValueByDOMTags();
                    tagify.loadOriginalValues(tags);
                }
            },

            resizeAllTextAreas() {
                const textareas = document.querySelectorAll('textarea');
                textareas.forEach(textarea => this.resizeTextarea(textarea));
            },

            resizeTextarea(textarea) {
                if (!textarea) {
                    return;
                }
                textarea.style.height = 'auto';
                const newHeight = textarea.scrollHeight;
                const maxHeight = parseFloat(getComputedStyle(textarea).maxHeight);

                if (newHeight > maxHeight) {
                    textarea.style.height = `${maxHeight}px`;
                    textarea.style.overflowY = 'auto';
                } else {
                    textarea.style.height = `${newHeight}px`;
                    textarea.style.overflowY = 'hidden';
                }
            },

            showProperties() {
                if (this.blockPanelVisible) {
                    logMsg('Block panel is already visible, ignoring "showProperties"');
                    return;
                }

                this.blockPanelVisible = true;
                this.modelPropsCurrents.visible = true;

                this.$nextTick(() => {
                    this.$refs.layoutMode.focus();
                });
            },

            cancelProperties() {
                if (cancelSettingsChangesRequestSent) {
                    logMsg('Cancel settings changes request already sent, ignoring "cancelProperties"');
                    return;
                }

                const prop1 = structuredClone(toRaw(this.modelPropertiesBackup));
                prop1.visible = false;
                const prop2 = structuredClone(toRaw(this.modelProperties));
                prop2.visible = false;
                const equals = JSON.stringify(prop1) === JSON.stringify(prop2);

                if (!equals) {
                    cancelSettingsChangesRequestSent = true;
                    postMessage({
                        command: 'confirmQuestion',
                        id: 'cancelSettingsChanges',
                        message: 'Do you really want to cancel changes?',
                        detail: 'All unsaved changes will be lost.'
                    });
                    return;
                }

                if (equals) {
                    this.closePropertiesDialog(true);
                }
            },

            closePropertiesDialog(reset) {
                if (reset === true) {
                    this.modelProperties = structuredClone(toRaw(this.modelPropertiesBackup));
                } else {
                    this.modelPropertiesBackup = structuredClone(toRaw(this.modelProperties));
                }
                this.modelPropsCurrents.visible = false;
                this.blockPanelVisible = false;
            },

            saveProperties() {
                if (this.modelPropsCurrents.saving) {
                    return;
                }

                this.modelPropsCurrents.saving = true;
                this.modelPropsCurrents.codeGeneratorError = undefined;

                const msg = { command: 'saveProperties', modelProperties: toRaw(this.modelProperties) };

                savePropertiesTimer = setTimeout(() => {
                    this.modelPropsCurrents.saving = false;
                    this.handleSavePropertiesResult(undefined, false);
                }, 5000);

                postMessage(msg, 'Saving model properties');
            },

            handleSavePropertiesResult(error, closeDialog) {
                logMsg('Handling save properties result, error: ', error, ', closeDialog: ', closeDialog);

                this.modelPropsCurrents.codeGeneratorError = error;
                if (savePropertiesTimer) {
                    clearTimeout(savePropertiesTimer);
                    savePropertiesTimer = undefined;
                }

                closeDialog = closeDialog ?? true;
                if (error) {
                    closeDialog = false;
                }

                this.modelPropsCurrents.saving = false;
                if (closeDialog) {
                    logMsg('Closing properties dialog');
                    this.closePropertiesDialog(false);
                } else if (error) {
                    //showTooltip('save-properties-error', error, document.getElementById('settings-table'), true, 20000);
                }
            },

            focusOnSettingsError() {
                const error = this.modelPropsCurrents.codeGeneratorError;
                if (!error) {
                    return;
                }

                const group = error.group || '';
                const name = error.name || '';
                this.focusSettingInput(group, name, true);
            },

            changeTemplate() {
                console.warn(`Change template is not implemented!`);
            },

            focusSettingInput(group, name, scroll) {
                const input = document.querySelector(`input[data-settings-group="${group}"][data-settings-name="${name}"]`) ||
                    document.querySelector(`select[data-settings-group="${group}"][data-settings-name="${name}"]`);
                if (input) {
                    input.focus();
                    if (scroll === true) {
                        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            },

            focusOnSettingProperty(event) {
                if (!event.target) {
                    return;
                }

                const row = event.target.closest('tr');
                row.dataset['focused'] = 'true';
            },

            blurOnSettingProperty(event) {
                if (!event.target) {
                    return;
                }

                const row = event.target.closest('tr');
                delete row.dataset['focused'];
            },

            resetSettings() {
                postMessage({
                    command: 'confirmQuestion',
                    id: 'resetSettings',
                    message: 'Reset Code Generator Settings?',
                    detail: 'Are you sure you want to reset code generator settings to default values?'
                });
            },

            focusEditor() {
                if (this.isResource) {
                    if (this.$refs.translationTextArea && this.$refs.translationTextArea.length > 0) {
                        const textarea = this.$refs.translationTextArea[0];
                        textarea.focus();
                    }
                } else {
                    this.$refs.name.focus();
                }
            },

            restoreLastFocused(restoreFocusedInput) {
                if (!restoreFocusedInput) {
                    lastFocusedElement = undefined;
                    return;
                }

                // set back focused elem on document
                if (lastFocusedElement) {
                    switch (lastFocusedElement.type) {
                        case 'tags': {
                            if (this.paramsEnabled) {
                                // focus span
                                const span = document.querySelector('tags>span[contenteditable="true"].tagify__input');
                                span.focus();
                            } else {
                                this.internalEditParameters(false);
                            }
                            break;
                        }
                        case 'input': {
                            document.getElementById(lastFocusedElement.id)?.focus();
                            break;
                        }
                        case 'translation': {
                            document.querySelector(`textarea[data-lang="${lastFocusedElement.id}"]`)?.focus();
                            break;
                        }
                        default: {
                            logMsg(`Unknown last focused element type: ${lastFocusedElement.type}`);
                            break;
                        }
                    }
                }
            },

            async copyPathToClipboard() {
                const path = this.fullPathNoRoot;
                await navigator.clipboard.writeText(path);
                postMessage({ command: 'showNotification', message: `Path "${path}" copied to clipboard!` }, 'Copy path to clipboard');
            }
        }
    }).mount('#app');
}());