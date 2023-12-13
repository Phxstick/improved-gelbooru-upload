import Component from "js/generic/component";
import { E } from "js/utility";
import "./tag-search.scss"

interface BaseCompletion {
    title: string,
    value?: string
}

interface Props<Completion> {
    multiSelect: boolean,
    allowAdditions: boolean,
    selectFirstResult: boolean,
    placeholder: string
    delimiter: string,
    delimiterKeyCode: number,
    
    maxResults: number,
    searchDelay: number,
    // values: Completion[]

    getResults?: (query: string) => Promise<Completion[]>,
    getViewBoundaries?: () => ({ top: number, bottom: number }),
    onLabelCreate: (element: HTMLElement, value: string, text: string) => void,
    onAdd: (value: string) => void,
    onRemove: (value: string) => void,
    onChange: (value: string) => void,
    getCompletions: (query: string) => Completion[] | null,
    validateAddition: (value: string) => boolean,
    transformInput: (value: string) => string,
    checkMatch: (input: string, completion: Completion) => boolean,
    itemBuilder?: (data: Completion) => string
}

type TagSearchProps<Completion> = Partial<Props<Completion>>

let templateCounter = 0

export default class TagSearch<Completion extends BaseCompletion> extends Component {
    private props: Props<Completion> = {
        multiSelect: true,
        allowAdditions: true,
        selectFirstResult: true,
        placeholder: "",
        // values: [],
        maxResults: 5,
        searchDelay: 0,
        delimiter: ";",
        delimiterKeyCode: 188,
        onLabelCreate: () => {},
        onAdd: () => {},
        onRemove: () => {},
        onChange: () => {},
        getCompletions: () => null,
        validateAddition: () => true,
        transformInput: (value) => value,
        checkMatch: (input, completion) => completion.title.startsWith(input)
    }

    private dropdown: HTMLElement
    private inputElement: HTMLInputElement
    private clickListener?: (event: MouseEvent) => void
    private currentValue: string = "" // Last value in single-select mode
    private listenersDisabled = false
    private reverse = false
    private nextTagType?: string
    private artistBanned?: boolean

    // State variables
    private resultIndex = 0
    private selectionRemoved = false
    private currentResults: Completion[] = []

    constructor(props: TagSearchProps<Completion> = {}) {
        super()
        Object.assign(this.props, props)

        const inputClass = "ui fluid search selection dropdown tag-search"
            + (this.props.multiSelect ? " multiple" : "")
        this.dropdown = E("div", { class: inputClass }, [
            E("input", { type: "hidden" }),
            E("div", { class: "default text" }, this.props.placeholder),
            E("div", { class: "menu" })
        ])
        const resultsContainer = E("div", { class: "results visible" })
        this.root = E("div", { class: "ui fluid search wrapper" },
            [this.dropdown, resultsContainer])
        const outerThis = this
        $(this.dropdown).dropdown({
            allowAdditions: this.props.allowAdditions,
            delimiter: this.props.delimiter,
            minCharacters: 1000,  // Prevent dropdown completions, use "search" module instead
            showOnFocus: false,
            // `forceSelection: false` prevents "TypeError: Cannot read property 'trim'
            // of undefined" when focussing out of input (see Fomantic UI issue 1679)
            forceSelection: false,
            // fullTextSearch: true,
            // ignoreCase: true,
            clearable: false,
            keys: {
                delimiter: this.props.delimiterKeyCode
            },
            onLabelCreate: function (value, text) {
                outerThis.props.onLabelCreate(this[0], value, text)
                if (outerThis.nextTagType) {
                    this[0].dataset.type = outerThis.nextTagType
                    outerThis.nextTagType = undefined
                }
                if (outerThis.artistBanned !== undefined) {
                    this[0].dataset.banned = outerThis.artistBanned.toString()
                    outerThis.artistBanned = undefined
                }
                return this
            },
            // Listeners for multi-select type
            onAdd: (value) => {
                if (!this.props.multiSelect) return
                if (this.listenersDisabled) return
                this.props.onAdd(value)
            },
            onRemove: (value) => {
                if (!this.props.multiSelect) return
                if (this.listenersDisabled) return
                // Semantic UI escapes HTML characters in tag value, unescape here
                const replacements = {
                    "&quot;": '"',
                    "&#x27;": "'",
                    "&amp;": '&',
                    "&gt;": '>',
                    "&lt;": '<'
                }
                Object.entries(replacements).forEach(
                    ([seq, repl]) => { value = value.replace(seq, repl) })
                this.props.onRemove(value)
            },
            // Listener for single-select type
            onChange: (value) => {
                if (this.props.multiSelect) return
                const previousValue = this.currentValue;
                this.currentValue = value
                if (this.listenersDisabled) return
                if (previousValue) this.props.onRemove(previousValue)
                if (value) this.props.onAdd(value)
            }
        })
        this.inputElement =
            this.dropdown.querySelector("input.search") as HTMLInputElement
        this.inputElement.classList.add("prompt")

        // Custom search results
        const searchTemplates = window.$.fn.search.settings.templates as any
        const templateName = `template${templateCounter}`
        if (this.props.itemBuilder) {
            templateCounter++
            const itemBuilder = this.props.itemBuilder
            searchTemplates[templateName] = (data: { results: Completion[] }) => {
                const htmlArray: string[] = []
                for (const searchCompletionData of data.results) {
                    htmlArray.push(itemBuilder(searchCompletionData))
                }
                return htmlArray.join("\n")
            }
        }

        $(this.dropdown).search({
            cache: false,  // Necessary to make "onResult" handler fire for repeated searches
            duration: 0,  // No animations needed
            searchDelay: this.props.searchDelay,
            maxResults: this.props.maxResults,
            minCharacters: 1,
            selectFirstResult: this.props.selectFirstResult,
            searchOnFocus: false,
            fullTextSearch: true,  // Fuzzy search (if local object is given)
            showNoResults: false,
            type: this.props.itemBuilder ? templateName : undefined,

            onSelect: (data: Completion) => {
                // Prevent default action when pressing enter, use custom handler below
                return false as any
            },

            onSearchQuery: (query) => {
                // Reset state of selection window
                this.resultIndex = 0
                this.selectionRemoved = !this.props.selectFirstResult
                // Update search completions based on query
                const completionData = this.props.getCompletions(query)
                if (completionData === null) return
                $(this.dropdown).search("setting", "source", completionData)
            },

            onResults: (response) => {
                this.currentResults = response.results
            },

            onResultsAdd: (html) => {
                // Don't show results if user already selected a value during a search
                resultsContainer.innerHTML = this.inputElement.value.length ? html : ""
                if (resultsContainer.children.length) {
                    if (this.props.selectFirstResult) {
                        resultsContainer.children[0].classList.add("active")
                    }
                    resultsContainer.style.display = "block"
                    // Display results above the input if they leave the viewport
                    if (!resultsContainer.classList.contains("above")) {
                        const viewBoundaries = this.props.getViewBoundaries ?
                            this.props.getViewBoundaries() :
                            { top: 0, bottom: window.innerHeight }
                        const firstChild = resultsContainer.children[0]
                        // Don't directly take `resultsRect.bottom`, because
                        // the element might be split and repositioned in a
                        // container with `column-count` css property
                        const childRect = firstChild.getBoundingClientRect()
                        const numResults = resultsContainer.children.length
                        const inputRect = this.root.getBoundingClientRect()
                        // +2 to account for 1px border on both sides, +7 for margin
                        const resultsBottom =
                            inputRect.bottom + 7 + numResults * childRect.height + 2
                        if (resultsBottom > viewBoundaries.bottom ||
                                childRect.height + 8 < inputRect.bottom - resultsBottom) {
                            resultsContainer.classList.add("above")
                            this.reverse = true
                        }
                        // Make position of dropdown fixed so it doesn't get contained to scrollable area
                        // (downside is that it doesn't move/expand when scrolling or resizing viewport)
                        resultsContainer.style.setProperty("position", "fixed")
                        resultsContainer.style.setProperty("left", `${inputRect.left}px`, "important")
                        resultsContainer.style.setProperty("width", `${inputRect.width - 2}px`)
                        if (this.reverse) {
                            resultsContainer.style.setProperty("top", "unset", "important")
                            resultsContainer.style.setProperty("bottom", `${window.innerHeight - inputRect.top}px`, "important")
                        } else {
                            resultsContainer.style.setProperty("bottom", "unset", "important")
                            resultsContainer.style.setProperty("top", `${inputRect.bottom}px`, "important")
                        }
                    }
                } else {
                    resultsContainer.style.display = "none"
                    resultsContainer.classList.remove("above")
                    this.reverse = false
                }
            }
        })
        // Old search results container is not needed, use custom one instead
        this.dropdown.querySelector(".results")?.remove()

        // Use API if getResults callback is provided, otherwise local source
        if (this.props.getResults) {
            const getResults = this.props.getResults
            $(this.dropdown).search("setting", "apiSettings", {
                mockResponseAsync: async (settings, callback) => {
                    const query = settings.urlData.query;
                    const results = await getResults(query)
                    callback({ results })
                }
            })
        } else {
            $(this.dropdown).search("setting", "source", [])
        }

        // Alt + click a tag to remove it
        this.dropdown.addEventListener("click", (event) => {
            if (!event.altKey) return
            const target = event.target as HTMLElement
            if (!target.classList.contains("label")) return
            event.stopPropagation()
            const value = target.dataset.value
            if (value) this.removeSelected(value)
        }, { capture: true })

        // Simulate multi-select dropdown functionality using manual listener
        this.inputElement.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== this.props.delimiter) return

            // Hide popup window
            if (resultsContainer.style.display !== "none") {
                resultsContainer.style.display = "none"
                resultsContainer.classList.remove("above")
                this.reverse = false
            }

            // Add selected value to the tag list
            let inputText = this.props.transformInput(this.inputElement.value)
            if (!this.selectionRemoved && resultsContainer.children.length > 0 &&
                    (inputText.includes("*") || this.props.checkMatch(
                        inputText, this.currentResults[this.resultIndex]))) {
                const value = this.currentResults[this.resultIndex].title
                if (this.props.validateAddition(value)) {
                    $(this.dropdown).dropdown("set selected", [value])
                }
            // If no value is selected, use entered value (if valid)
            } else if (inputText.length > 0 && this.props.allowAdditions) {
                const isValid = this.props.validateAddition(inputText)
                if (isValid) {
                    $(this.dropdown).dropdown("set selected", [inputText])
                }
            }

            // Reset value of entry and keep it focussed
            this.inputElement.value = ""
            this.inputElement.focus()
        })

        this.inputElement.addEventListener("input", () => {
            // Hide search completions if query is empty
            if (this.inputElement.value.length === 0) {
                resultsContainer.style.display = "none"
                resultsContainer.classList.remove("above")
                this.reverse = false
            }
        })

        this.inputElement.addEventListener("keydown", (event) => {
            // If escape is pressed, clear the input so that nothing gets added
            if (event.key === "Escape") {
                this.inputElement.value = ""
                resultsContainer.style.display = "none"
                resultsContainer.classList.remove("above")
                this.reverse = false
                event.stopImmediatePropagation()
                return
            }

            // If focus goes somewhere else by pressing tab, hide suggestions
            if (event.key === "Tab") {
                this.inputElement.value = ""
                resultsContainer.style.display = "none"
                resultsContainer.classList.remove("above")
                this.reverse = false
                this.dropdown.classList.remove("focus")
            }

            // Select previous/next entry when arrow keys are pressed 
            if ((!this.reverse && event.key === "ArrowUp")
                    || (this.reverse && event.key === "ArrowDown")) {
                if (resultsContainer.style.display === "none") return
                if (!resultsContainer.children.length) return
                event.stopImmediatePropagation()
                event.preventDefault()
                if (this.selectionRemoved) return
                if (this.resultIndex === 0) {
                    // Allow not selecting anything to make a custom addition
                    this.selectionRemoved = true
                    resultsContainer.children[0].classList.remove("active")
                } else {
                    resultsContainer.children[this.resultIndex].classList.remove("active")
                    this.resultIndex--
                    resultsContainer.children[this.resultIndex].classList.add("active")
                }
            }
            if ((!this.reverse && event.key === "ArrowDown")
                    || (this.reverse && event.key === "ArrowUp")) {
                if (resultsContainer.style.display === "none") return
                if (!resultsContainer.children.length) return
                event.stopImmediatePropagation()
                event.preventDefault()
                if (this.selectionRemoved) {
                    this.selectionRemoved = false
                    resultsContainer.children[0].classList.add("active")
                } else if (this.resultIndex !== resultsContainer.children.length - 1) {
                    resultsContainer.children[this.resultIndex].classList.remove("active")
                    this.resultIndex++
                    resultsContainer.children[this.resultIndex].classList.add("active")
                }
            }
        })

        // NOTE: not sure if this listener is still necessary, can't harm either
        this.inputElement.addEventListener("focusout", (event) => {
            this.selectionRemoved = !this.props.selectFirstResult
        })

        this.clickListener = (event: MouseEvent) => {
            const target = event.target as HTMLElement
            // If the user clicks somewhere outside of this widget, hide suggestions
            if (!this.dropdown.contains(target) && !resultsContainer.contains(target)) {
                resultsContainer.style.display = "none"
                resultsContainer.classList.remove("above")
                this.reverse = false
                this.dropdown.classList.remove("focus")
            } else if (resultsContainer.contains(target)) {
                // Get clicked element
                let element = target
                while (element.parentElement !== resultsContainer) {
                    if (element.parentElement === null) return
                    element = element.parentElement
                }
                // Select clicked suggestion and hide popup window
                const index = Array.from(resultsContainer.children).indexOf(element)
                const value = this.currentResults[index].title
                if (this.props.validateAddition(value)) {
                    $(this.dropdown).dropdown("set selected", [value])
                }
                resultsContainer.style.display = "none"
                resultsContainer.classList.remove("above")
                this.reverse = false
                // Keep entry focussed
                // this.inputElement.focus()
            }
        }
        window.addEventListener("mousedown", this.clickListener)
    }

    addSelected(value: string, type?: string, isBanned?: boolean, triggerListeners=true) {
        if (!triggerListeners) this.listenersDisabled = true
        if (type) this.nextTagType = type
        if (isBanned !== undefined) this.artistBanned = isBanned
        $(this.dropdown).dropdown("set selected", [value])
        if (!triggerListeners) this.listenersDisabled = false
    }

    removeSelected(value: string, triggerListeners=true) {
        if (!triggerListeners) this.listenersDisabled = true
        if (this.props.multiSelect) {
            $(this.dropdown).dropdown("remove selected", value)
        } else {
            if ($(this.dropdown).dropdown("get value") === value) {
                $(this.dropdown).dropdown("clear")
            }
        }
        if (!triggerListeners) this.listenersDisabled = false
    }

    setValues(values: string[], triggerListeners=false) {
        if (!triggerListeners) this.listenersDisabled = true
        $(this.dropdown).dropdown("set exactly", values)
        if (!triggerListeners) this.listenersDisabled = false
        if (!this.props.multiSelect && values.length > 0)
            this.currentValue = values[0]
    }

    addValues(values: string[]) {
        $(this.dropdown).dropdown("set selected", values)
    }

    getValues(): string[] {
        const value = $(this.dropdown).dropdown("get value")
        return value.length ? value.split(this.props.delimiter) : []
    }

    getHoveredCompletion(): Completion | null {
        return !this.selectionRemoved && this.currentResults.length > 0 ?
            this.currentResults[this.resultIndex] : null
    }

    getCurrentInput(): string {
        return this.props.transformInput(this.inputElement.value)
    }

    getTagElements(): HTMLElement[] {
        return [...this.dropdown.querySelectorAll("a.label")] as HTMLElement[]
    }

    clear() {
        $(this.dropdown).dropdown("clear")
    }

    focus() {
        this.inputElement.focus()
    }

    setCompletions(dataList: Completion[]) {
        $(this.dropdown).search("setting", "source", dataList)
    }

    // Don't forget to call this method before the element gets removed,
    // otherwise the event listeners and all associated memory will remain
    destroy() {
        if (this.clickListener !== undefined) {
            window.removeEventListener("mousedown", this.clickListener)
        }
    }
}
