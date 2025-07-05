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
     * @typedef {Object} PageData
     * @property {Object} item
     * @property {boolean} loading
     * @property {boolean} paramsEnabled
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

    function getCultureName(lang) {
        if (lang && lang !== '') {
            const culture = usedCultures.find(x => x.name === lang);
            return culture ? `${culture?.engName ?? ''} (${culture?.name ?? ''})` : lang;
        }
        return lang ?? '';
    }

    const domBody = document.getElementsByTagName('body')[0];

    window.addEventListener('message', event => {
        message = event.data;
        switch (message.command) {
            case 'loadPage': {
                domBody.dataset['loading'] = 'true';
                const element = message.element;
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

                window.pageApp.$nextTick(() => {
                    //window.pageApp.item = element;
                    setNewElement(element);
                    window.pageApp.loading = false;

                    window.pageApp.$nextTick(() => {
                        window.pageApp.bindTagParameters(oldElement);
                    });
                });
                delete domBody.dataset['loading'];
                break;
            }
        }
    });

    function setNewElement(element) {
        debugger;
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
        window.pageApp.item = element;
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

    /** @param {TooltipItem} item */
    function removeTooltip(item) {
        if (item && item.tooltip) {
            if (item.hideTimeoutId) { clearTimeout(item.hideTimeoutId); }
            if (item.removeTimeoutId) { clearTimeout(item.removeTimeoutId); }
            if (item.tooltip.isConnected) { item.tooltip.remove(); }
            if (tooltipsMap.has(item.uid)) {
                tooltipsMap.delete(item.uid);
                //console.log(`[Tooltip] Removed tooltip '${item.uid}'.`);
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
            //console.log(`[Tooltip] Cancel removal of tooltip '${item.uid}'.`);
        }
    }

    function showTooltip(uid, message, anchorEl) {
        const removeTimeout = 3000;
        const hideTimeout = 1000;
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
                //console.log(`[Tooltip] scheduled hide timeout(${hideTimeout}) for tooltip '${tooltipItem.uid}'.`);
                tooltipItem.hideTimeoutId = window.setTimeout(() => {
                    if (tooltipItem.tooltip) {
                        tooltipItem.tooltip.classList.add('tooltip-fade-out');
                    }

                    //console.log(`[Tooltip] scheduled remove timeout(${removeTimeout}) for tooltip '${tooltipItem.uid}'.`);
                    tooltipItem.removeTimeoutId = window.setTimeout(() => {
                        removeTooltip(tooltipItem);
                    }, removeTimeout);
                }, hideTimeout);
            }
        };

        const handleClickOutside = (event) => {
            // remove all tooltipList
            if (tooltipsMap.size > 0) {
                const now = Date.now();
                tooltipsMap.values().filter(x => (now - x.date) > 200).forEach(item => {
                    if (item.tooltip && !item.tooltip.contains(event.target)) {
                        //console.log(`[Tooltip] click outside, remove/cancel tooltip '${item.uid}'.`);
                        cancelRemoval(item);
                        removeTooltip(item);
                    }
                });
            }

            //document.removeEventListener('click', handleClickOutside, true);
        };

        tooltip.addEventListener('mouseenter', () => { cancelRemoval(tooltipItem); });
        tooltip.addEventListener('mouseleave', scheduleRemoval);
        tooltip.addEventListener('click', (e) => {
            e.stopPropagation();
            //console.log(`[Tooltip] click on tooltip, remove/cancel tooltip '${item.uid}'.`);
            cancelRemoval(tooltipItem);
            removeTooltip(tooltipItem);
        });

        document.body.appendChild(tooltip);
        const rect = anchorEl.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;

        if (!handleClickOutsideInitialized) {
            setTimeout(() => {
                if (!handleClickOutsideInitialized && tooltipItem.tooltip) {
                    handleClickOutsideInitialized = true;
                    //console.log(`[Tooltip] initialized click outside handler.`);
                    document.addEventListener('click', handleClickOutside, true);
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
        paramsEnabled: false
    };

    window.pageApp = createApp({
        data() { return newPageItem; },

        computed: {
            translationCount() {
                return usedCultures.length;
                // if (this.item && this.item.values) {
                //     return this.item.values.length;
                // }
                // return 0;
            },

            fullPath() {
                if (this.item && this.item.paths) {
                    return '/' + this.item.paths.join('/');
                }

                return '';
            },

            isResource() {
                return this.item && this.item.elementType === 'resource';
            }
        },

        created() {
            this.debouncedOnChange = _.debounce(this.onChange, debounceWait, debounceOpts);
            this.$watch('item', this.debouncedOnChange, { deep: true, immediate: false });
            // this.$watch('item.name', (value, oldvalue) => { this.debouncedOnChange('name', value, oldvalue) }, { immediate: false });
            // this.$watch('item.description', (value, oldvalue) => { this.debouncedOnChange('description', value, oldvalue) }, { immediate: false });
            this.debouncedResize = _.debounce(this.resizeAllTextAreas, 100, debounceOpts);
        },

        mounted() {
            console.log('Page app mounted');
            // Use nextTick to ensure the DOM has been updated after the initial render.
            this.$nextTick(() => {
                this.debouncedResize();

                if (this.isResource) {
                    // this.createParametersTags();
                }
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
                if (this.item && oldValue !== undefined) {
                    const data = toRaw(this.item);

                    if (data) {
                        console.log('Data changed:', data);
                        vscode.postMessage({ command: 'update', data: data });
                    }
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

            editParameters(e) {
                const isCancel = e.target.dataset['cancel'] === 'true';
                this.paramsEnabled = !this.paramsEnabled;
                tagifyParams.setDisabled(!this.paramsEnabled);

                if (!this.paramsEnabled) {
                    if (isCancel) {
                        const tags = this.item.parameters
                            .sort((a, b) => a.order - b.order)
                            .map(param => ({
                                value: param.name,
                                order: param.order
                            }));
                        tagifyParams.loadOriginalValues(tags);
                    } else {
                        const invalidTagElm = tagifyParams.getTagElms().find(node => {
                            const tagData = tagifyParams.getSetTagData(node);
                            return tagData && tagData.__isValid !== true;
                        });

                        if (invalidTagElm) {
                            this.paramsEnabled = !this.paramsEnabled;
                            tagifyParams.setDisabled(!this.paramsEnabled);

                            const tagData = tagifyParams.getSetTagData(invalidTagElm);
                            showTooltip('params-invalid', tagData.__isValid, invalidTagElm);
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
                }
            },

            openResource() {
                console.log('Open resource clicked');
            },

            lockTranslation(translation) {
                debugger;
                if (translation && translation.valueRef) {
                    translation.valueRef.locked = !translation.valueRef.locked;
                    this.debouncedOnChange();
                    // no need to debounce here..
                    //this.onChange();
                }
            },

            autoResizeTextarea(event) {
                this.resizeTextarea(event.target);
            },

            createParametersTags() {
                const input = this.$refs.parameters;
                // input.addEventListener('change', onTagsChange);

                // function onTagsChange(e) {
                //     const { name, value } = e.target;

                // }

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

                    placeholder: 'Enter parameters for resource (optional)',

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
                        console.log('Transforming tag:', tagData, originalData);
                        if (tagData.order === undefined) {
                            const maxOrder = Math.max(...this.value.map(x => x.order), -1);
                            tagData.order = maxOrder + 1;
                        }
                    }
                };

                const tagify = new Tagify(input, options);
                tagify.setDisabled(true);

                tagifyParams = tagify;

                const tags = this.item.parameters
                    .sort((a, b) => a.order - b.order)
                    .map(param => ({
                        value: param.name,
                        order: param.order
                    }));
                tagify.addTags(tags);

                tagify.on('edit:start', function ({ detail: { tag, data } }) {
                    tagify.setTagTextNode(tag, data.value);
                });

                tagify.on('remove', function ({ detail: { tag, data } }) {
                    reflectChanges();
                });

                tagify.on('invalid', function ({ detail }) {
                    showTooltip('params-invalid', detail.message, tagify.DOM.input);
                });

                tagify.on('edit:updated', function ({ detail: { data, tag } }) {
                    const isValid = validateTag(data);
                    tag = tagify.getTagElmByValue(data.value);
                    if (isValid !== true) {
                        tagify.replaceTag(tag, { ...data, __isValid: isValid });
                        showTooltip('params-invalid', isValid, tagify.DOM.input);
                    } else {
                        const newTagData = { ...data, __isValid: true };
                        delete newTagData.title;
                        delete newTagData["aria-invalid"];
                        delete newTagData.class;
                        delete newTagData.__tagId;
                        tagify.replaceTag(tag, newTagData);
                    }
                });

                tagify.on('add', function ({ detail: { data, tag } }) {
                    const isValid = validateTag(data);
                    if (isValid !== true) {
                        tagify.replaceTag(tag, { ...data, __isValid: isValid });
                    }
                });

                var dragsort = new DragSort(tagify.DOM.scope, {
                    selector: '.' + tagify.settings.classNames.tag,
                    callbacks: {
                        dragEnd: onDragEnd
                    }
                });

                function onDragEnd(elm) {
                    reflectChanges();
                    // const tags = [];
                    // tagify.getTagElms().forEach((node, idx) => {
                    //     const tagData = tagify.getSetTagData(node);
                    //     if (tagData) {
                    //         tagData.order = idx;
                    //         tagify.getSetTagData(node, tagData);
                    //         tags.push(tagData);
                    //     }
                    // });
                    // tagify.updateValueByDOMTags();
                    // tagify.loadOriginalValues(tags);
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
            }
        }
    }).mount('#app');

    //window.pageApp = pageApp;
}());