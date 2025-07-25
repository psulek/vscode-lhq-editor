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
     * @property {'server' | 'tags'} type
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
     * @property {boolean} visible
     * @property {boolean} saving
     * @property {number} modelVersion
     * @property {ICodeGeneratorElement} codeGenerator
     * @property {SettingsError | undefined} codeGeneratorError
     */

    /**
     * @typedef {Object} PageData
     * @property {Object} item
     * @property {boolean} loading
     * @property {boolean} paramsEnabled
     * @property {InvalidDataInfo} invalidData
     * @property {boolean} supressOnChange
     * @property {ModelProperties} modelProperties
     * @property {ModelProperties} modelPropertiesBackup
     * @property {TemplateMetadataDefinition} templateDefinition
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
    let savePropertiesTimer = undefined;

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
            visible: false,
            saving: false,
            codeGenerator: { templateId: '' },
            codeGeneratorError: undefined
        };
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

    document.addEventListener('keydown', (event) => {
        // filter out Ctrl+Enter key combination so vscode does not handle it and forward it to tree which will send 'focus' back to this page :-)
        if (event.ctrlKey === true && event.keyCode === 13) {
            event.preventDefault();
            event.stopPropagation();
        } else if (!event.ctrlKey && !event.shiftKey && !event.metaKey && event.keyCode === 27) {

            // Escape key pressed, close all tooltips
            if (isAnyTooltipVisible()) {
                logMsg('Escape key pressed, closing all tooltips');
                tooltipsMap.forEach(item => {
                    removeTooltip(item);
                });
            }

            if (window.pageApp && window.pageApp.modelProperties.visible) {
                window.pageApp.cancelProperties();
            }

            event.preventDefault();
            event.stopPropagation();
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
                    debugger;
                    return;
                }

                const elem = document.getElementById(message.field) || domBody;
                const uid = `${message.field}-invalid`;

                if (message.action === 'add') {
                    // showTooltip(`${message.field}-invalid`, message.message, elem);

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
                    window.pageApp.supressOnChange = true;

                    window.pageApp.$nextTick(() => {
                        window.pageApp.item.paths = message.paths;
                        //window.pageApp.supressOnChange = undefined;

                        //handleRequestPageReload();
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
                */
                domBody.dataset['loading'] = 'true';
                const element = message.element;
                const modelProperties = message.modelProperties;
                const autoFocus = message.autoFocus ?? false;
                //const file = message.file;
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

                window.pageApp.modelProperties = getDefaultModelProperties();
                // window.pageApp.modelPropertiesBackup = Object.assign({}, getDefaultModelProperties());
                window.pageApp.modelPropertiesBackup = structuredClone(getDefaultModelProperties());
                window.pageApp.templateDefinition = {};

                window.pageApp.$nextTick(() => {
                    setNewElement(element, modelProperties);
                    window.pageApp.loading = false;

                    window.pageApp.$nextTick(() => {
                        window.pageApp.bindTagParameters(oldElement);
                        window.pageApp.recheckInvalidData();
                        window.pageApp.debouncedResize();

                        if (autoFocus) {
                            window.pageApp.focusEditor();
                        }
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
                            }
                        }
                        break;
                    }
                    case 'cancelSettingsChanges': {
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
            isPrimary: true
        });


        usedCultures.forEach(culture => {
            if (culture.name !== currentPrimaryLang) {
                const value = element.values.find(x => x.languageName === culture.name);
                translations.push({
                    valueRef: value ?? { languageName: culture.name, value: '' },
                    culture: getCultureName(culture.name),
                    isPrimary: false
                });
            }
        });

        element.translations = translations;
        logMsg(`Setting new element:  ${getFullPath(element)} (${element.elementType})`, element, ' and modelProperties: ', modelProperties);
        window.pageApp.item = element;

        window.pageApp.modelProperties = modelProperties ?? getDefaultModelProperties();
        window.pageApp.modelProperties.layoutModes = [{ name: 'Hierarchical tree', value: true }, { 'name': 'Flat list', value: false }];
        window.pageApp.modelPropertiesBackup = modelProperties
            // ? Object.assign({}, modelProperties)
            ? structuredClone(modelProperties)
            : getDefaultModelProperties();

        const templateId = modelProperties.codeGenerator?.templateId ?? '';


        const templateDefinition = Object.prototype.hasOwnProperty.call(templatesMetadata, templateId)
            ? structuredClone(templatesMetadata[templateId])
            : undefined;

        if (templateDefinition) {
            const settingsObj = {};
            for (const [group, settings] of Object.entries(templateDefinition.settings)) {
                settingsObj[group] = {};
                if (settings && Array.isArray(settings)) {
                    settings.forEach(setting => {
                        settingsObj[group][setting.name] = setting;
                    });
                }
            }

            templateDefinition.settings = settingsObj;
        }

        window.pageApp.templateDefinition = templateDefinition;
    }

    function getFullPath(element) {
        if (element && element.paths && element.paths.length > 0) {
            return '/' + element.paths.join('/');
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
                //logMsg(`[Tooltip] Removed tooltip '${item.uid}'.`);
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
            //logMsg(`[Tooltip] Cancel removal of tooltip '${item.uid}'.`);
        }
    }

    function hideTooltip(uid) {
        const item = tooltipsMap.get(uid);
        if (item) {
            //logMsg(`[Tooltip] Hiding tooltip '${item.uid}'.`);
            cancelRemoval(item);
            removeTooltip(item);
        }
    }


    function handleClickOutside(event) {
        const translations = document.getElementById('translations');
        if (translations) {
            const focusedElem = document.activeElement;
            translations.querySelectorAll('tr>td[data-focused]').forEach(td => {
                // find next sibling to td
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
            tooltipsMap.values().filter(x => (now - x.date) > 200).forEach(item => {
                if (item.tooltip && !item.tooltip.contains(event.target)) {
                    //logMsg(`[Tooltip] click outside, remove/cancel tooltip '${item.uid}'.`);
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
        // let hideTimeoutId;
        // let removeTimeoutId;
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
                //logMsg(`[Tooltip] scheduled hide timeout(${hideTimeout}) for tooltip '${tooltipItem.uid}'.`);
                tooltipItem.hideTimeoutId = window.setTimeout(() => {
                    if (tooltipItem.tooltip) {
                        tooltipItem.tooltip.classList.add('tooltip-fade-out');
                    }

                    //logMsg(`[Tooltip] scheduled remove timeout(${removeTimeout}) for tooltip '${tooltipItem.uid}'.`);
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
            //logMsg(`[Tooltip] click on tooltip, remove/cancel tooltip '${item.uid}'.`);
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
                    // document.addEventListener('click', handleClickOutside, true);
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
        modelProperties: {
            visible: false,
            saving: false,
            codeGenerator: {
                templateId: ''
            },
            codeGeneratorError: undefined
        },
        modelPropertiesBackup: {
            visible: false,
            saving: false,
            codeGenerator: {
                templateId: ''
            },
            codeGeneratorError: undefined
        },
        templateDefinition: {}
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

            isResource() {
                return this.item && this.item.elementType === 'resource';
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
                const error = this.modelProperties.codeGeneratorError;
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
                const supressed = this.supressOnChange !== undefined;
                try {
                    if (this.item && oldValue !== undefined && !this.loading && !supressed) {
                        const data = toRaw(this.item);

                        /** @type {InvalidDataInfo} */
                        const invalidData = this.invalidData;
                        if (invalidData.errors.length > 0) {
                            this.recheckInvalidData();

                            const nonServerError = invalidData.errors.find(x => x.type !== 'server');

                            if (nonServerError) {
                                if (!isAnyTooltipVisible()) {
                                    showTooltip(nonServerError.uid, nonServerError.message, nonServerError.element);
                                }

                                logMsg('Invalid data (non server error found), will not send data!', data);
                                return;
                            }
                        }

                        if (data) {
                            /* logMsg(`Data changed, sending message 'update' with data: `, data);
                            vscode.postMessage({ command: 'update', data: data }); */

                            postMessage({ command: 'update', data: data }, 'Data changed');
                        }
                    }
                } finally {
                    if (supressed) {
                        this.supressOnChange = undefined;
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
                    invalidData.errors = invalidData.errors.filter(x => x.uid !== uid && x.type !== 'server');
                }

                hideTooltip(uid);

                if (elem) {
                    delete elem.dataset['error'];
                }
            },

            /** @param {InvalidDataError} error */
            updateInvalidData(error) {
                logMsg(`Update invalid data: `, error);
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

                item.element.dataset['error'] = 'true';

                showTooltip(item.uid, item.message, item.element);
            },

            recheckInvalidData() {
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
            },

            editParameters(e) {
                const isCancel = e.target.dataset['cancel'] === 'true';
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
                        this.recheckInvalidData(true);
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

                    //placeholder: 'Enter parameters for resource (optional)',

                    templates: {
                        tag: function (tagData) {
                            const title = tagData.__isValid !== true ? tagData.__isValid : 'Double click to edit parameter';
                            const txt1 = tagData.value || '';
                            const txt2 = tagData.__isValid !== true ? '&#9679;' : `(${tagData.order + 1})`;

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
                        //logMsg('Transforming tag:', tagData, originalData);
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
                        // logMsg('Tagify input focused');
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
                    //showTooltip('params-invalid', detail.message, tagify.DOM.input);
                    //self.recheckInvalidData(true);

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
                        //showTooltip('params-invalid', isValid, tagify.DOM.input);
                        //self.recheckInvalidData(true);

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
                this.modelProperties.visible = true;
            },

            cancelProperties() {
                const prop1 = structuredClone(toRaw(this.modelPropertiesBackup));
                prop1.visible = false;
                const prop2 = structuredClone(toRaw(this.modelProperties));
                prop2.visible = false;
                const equals = JSON.stringify(prop1) === JSON.stringify(prop2);

                if (!equals) {
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
                }
                this.modelProperties.visible = false;
            },

            saveProperties() {
                this.modelProperties.saving = true;
                this.modelProperties.codeGeneratorError = undefined;

                const msg = { command: 'saveProperties', modelProperties: toRaw(this.modelProperties) };

                savePropertiesTimer = setTimeout(() => {
                    this.modelProperties.saving = false;
                    this.handleSavePropertiesResult(undefined, false);
                }, 5000);

                postMessage(msg, 'Saving model properties');
            },

            handleSavePropertiesResult(error, closeDialog) {
                logMsg('Handling save properties result, error: ', error, ', closeDialog: ', closeDialog);

                this.modelProperties.codeGeneratorError = error;
                if (savePropertiesTimer) {
                    clearTimeout(savePropertiesTimer);
                    savePropertiesTimer = undefined;
                }

                closeDialog = closeDialog ?? true;
                if (error) {
                    closeDialog = false;
                }

                this.modelProperties.saving = false;
                if (closeDialog) {
                    logMsg('Closing properties dialog');
                    this.closePropertiesDialog(false);
                } else if (error) {
                    //showTooltip('save-properties-error', error, document.getElementById('settings-table'), true, 20000);
                }
            },

            focusOnSettingsError() {
                const error = this.modelProperties.codeGeneratorError;
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
            }
        }
    }).mount('#app');

    //window.pageApp = pageApp;
}());