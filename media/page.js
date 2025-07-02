(function () {
    // const vscode = acquireVsCodeApi();

    /**
     * @typedef {Object} CultureInfo
     * @property {string} name
     * @property {string} engName
     * @property {string} nativeName
     * @property {number} lcid
     * @property {boolean} isNeutral
     */

    /** @type  CultureInfo[] */
    const usedCultures = [{
        engName: 'English',
        name: 'en',
        nativeName: 'English',
        lcid: 1033,
        isNeutral: false
    }, {
        engName: 'Slovak',
        name: 'sk',
        nativeName: 'Slovenčina',
        lcid: 1051,
        isNeutral: false
    }];

    const regexValidCharacters = /^[a-zA-Z]+[a-zA-Z0-9_]*$/;

    const currentPrimaryLang = 'en';

    function getCultureName(lang) {
        if (lang && lang !== '') {
            const culture = usedCultures.find(x => x.name === lang);
            return culture ? `${culture?.engName ?? ''} (${culture?.name ?? ''})` : lang;
        }
        return lang ?? '';
    }

    // Add the method to String prototype
    String.prototype.toPascalCase = function () {
        if (!this) {
            return "";
        }

        return _.startCase(this);
    };


    const tooltips = new Map();

    function showTooltip(uid, message, anchorEl) {
        const timeout = 3000;
        const oldTooltip = tooltips.get(uid);
        if (oldTooltip) {
            if (oldTooltip.isConnected) {
                oldTooltip.remove();
            }
            tooltips.delete(uid);
        }

        let tooltip = document.createElement('div');
        tooltips.set(uid, tooltip);
        tooltip.textContent = message;
        tooltip.classList.add('tooltip'); // Add the main tooltip class
        let hideTimeoutId;
        let removeTimeoutId;

        const removeTooltip = () => {
            if (tooltip) {
                clearTimeout(hideTimeoutId);
                clearTimeout(removeTimeoutId);
                if (tooltip.isConnected) {
                    tooltip.remove();
                }
                tooltips.delete(uid);
                tooltip = null;
            }
        };

        const scheduleRemoval = () => {
            hideTimeoutId = window.setTimeout(() => {
                tooltip.classList.add('tooltip-fade-out');

                removeTimeoutId = window.setTimeout(() => {
                    removeTooltip();
                }, timeout);
            }, 1000);
        };;

        const cancelRemoval = () => {
            clearTimeout(hideTimeoutId);
            clearTimeout(removeTimeoutId);
            tooltip.classList.remove('tooltip-fade-out');
        };

        const handleClickOutside = (event) => {
            if (tooltip && tooltip !== event.target) {
                cancelRemoval();
                removeTooltip();
            }

            document.removeEventListener('click', handleClickOutside, true);
        };

        tooltip.addEventListener('mouseenter', cancelRemoval);
        tooltip.addEventListener('mouseleave', scheduleRemoval);
        tooltip.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelRemoval();
            removeTooltip();
        });

        document.body.appendChild(tooltip);
        const rect = anchorEl.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;

        setTimeout(() => {
            if (tooltip) { // Check if tooltip still exists
                document.addEventListener('click', handleClickOutside, true);
            }
        }, 200);

        scheduleRemoval();
    }

    let tagifyParams = null;

    const { createApp } = Vue;
    const debounceOpts = {
        leading: false,
        trailing: true
    };
    const debounceWait = 500;

    const sampleData = JSON.parse(`{
  "name": "Title",
  "elementType": "resource",
  "description": "This is a sample resource for testing purposes.",
  "isRoot": false,
  "paths": {
    "paths": [
      "Strings",
      "Title"
    ]
  },
  "data": {},
  "state": "Edited",
  "comment": "Hi {0}, we're glad you are using {1} at {2} EN",
  "hasParameters": true,
  "hasValues": true,
  "parameters": [
    {
      "name": "date",
      "order": 0
    },
    {
      "name": "userName",
      "order": 1
    },
    {
      "name": "productName",
      "order": 2
    }
  ],
  "values": [
    {
      "languageName": "en",
      "value": "EN Hi {0}, we're glad you are using {1} at {2} EN",
      "locked": false
    },
    {
      "languageName": "sk",
      "value": "SK Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut l",
      "locked": true
    }
  ]
}`);

    createApp({
        data() {
            return {
                item: sampleData,
                paramsEnabled: false,
            };
        },

        computed: {
            // parametersDisplay() {
            //     if (this.item && this.item.parameters) {
            //         return this.item.parameters.map(x => `${x.name} (${x.order})`).join(', ');
            //     }
            //     return '';
            // },

            translationCount() {
                if (this.item && this.item.values) {
                    return this.item.values.length;
                }
                return 0;
            },

            translations() {
                const result = [];
                if (this.item && this.item.values) {
                    const primaryValue = this.item.values.find(x => x.languageName === currentPrimaryLang);
                    if (primaryValue) {
                        result.push({
                            valueRef: primaryValue,
                            culture: getCultureName(primaryValue.languageName),
                            isPrimary: true
                        });
                    }

                    this.item.values.forEach(value => {
                        if (value.languageName !== currentPrimaryLang) {
                            result.push({
                                valueRef: value,
                                culture: getCultureName(value.languageName),
                                isPrimary: false
                            });
                        }
                    });
                }
                return result;
            },

            fullPath() {
                if (this.item && this.item.paths && this.item.paths.paths) {
                    return '/' + this.item.paths.paths.join('/');
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
            this.debouncedResize = _.debounce(this.resizeAllTextAreas, 100, debounceOpts);
        },

        mounted() {
            // Use nextTick to ensure the DOM has been updated after the initial render.
            this.$nextTick(() => {
                this.debouncedResize();
                this.createParametersTags();
                //this.createStateSelector();
            });
            window.addEventListener('resize', this.debouncedResize);
        },

        unmounted() {
            this.debouncedOnChange.cancel();
            window.removeEventListener('resize', this.debouncedResize);
            this.debouncedResize.cancel();
        },

        methods: {
            onChange() {
                console.log('Item changed:', this.item);
            },

            editParameters(e) {
                //debugger;
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
                        debugger;
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
                            // const title = tagData.title || 'Double click to edit parameter';
                            //const title = 'Double click to edit parameter';
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
                    debugger;
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
                    //debugger;
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

            // createStateSelector() {
            //     debugger;
            //     const tagify = new Tagify(this.$refs.resourceState, {
            //         enforceWhitelist: true,
            //         mode: "select",
            //         whitelist: ['New', 'Edited', 'NeedsReview', 'Final'],
            //     });
            // },

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
}());