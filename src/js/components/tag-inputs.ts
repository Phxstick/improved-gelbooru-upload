import ContextMenu from "js/generic/context-menu";
import TagSearch from "js/generic/tag-search";
import WikiModal from "js/components/wiki-modal"
import { BooruApi, TagType, TagInfo, HostName, EnhancedTags } from "js/types";
import { E } from "js/utility";
import "./tag-inputs.scss"
import DanbooruApi from "js/danbooru-api";

// Create a popup menu for choosing a different tag type
function openTagTypePopup(tagElement: HTMLElement, api: BooruApi) {
    const type = tagElement.dataset.type!
    const createMenuItem = (value: string, label: string) => 
        E("a", { class: "item" + (value === type ? " hidden" : ""), dataset: { value } }, label)
    const tagTypeMenu = E("div", { class: "ui popup vertical menu hidden" }, [
        createMenuItem("artist", "Artist"),
        createMenuItem("character", "Character"),
        createMenuItem("copyright", "Copyright"),
        createMenuItem("tag", "Regular")
    ])
    document.body.appendChild(tagTypeMenu)
    tagTypeMenu.addEventListener("click", async (event) => {
        const target = event.target as HTMLElement | null
        if (target === null) return
        if (target.parentElement !== tagTypeMenu) return
        const tagName = tagElement.dataset.value!.replaceAll(" ", "_")
        const newType = target.dataset.value as TagType
        const success = await api.setTagType(tagName, newType)
        if (success) {
            tagElement.dataset.type = newType
            if (newType !== "tag") tagElement.classList.remove("rare")
        } else {
            window.alert(`Failed to update type of tag '${tagName}'.`)
        }
    })
    let clicked = false
    const clickListener = () => {
        clicked = true
        $(tagElement).popup("hide")
    }
    $(tagElement).popup({
        popup: $(tagTypeMenu),
        variation: "basic",
        hoverable: true,
        lastResort: "bottom left",
        distanceAway: 3,
        on: "manual",
        movePopup: false,
        onVisible: () => {
            window.addEventListener("click", clickListener)
            window.addEventListener("contextmenu", clickListener)
        },
        onHide: () => {
            if (!clicked) return false
            window.removeEventListener("click", clickListener)
            window.removeEventListener("contextmenu", clickListener)
        },
        onHidden: () => {
            $(tagElement).popup("destroy")
        }
    })
    $(tagElement).popup("show")
}

interface TagInputOptions {
    selectFirstResult: boolean
    separateTagsWithSpace: boolean
    postCountThreshold: number
    searchDelay: number
}

export default class TagInputs {
    private tags = new Set<string>()
    private groupToTagInput = new Map<string, TagSearch<TagInfo>>()
    private tagInputs: TagSearch<TagInfo>[] = []
    private container = E("div", { class: "tag-inputs-container" })
    private api: BooruApi
    private options: TagInputOptions
    private pastingTags = false
    private lastActiveInput: TagSearch<TagInfo> | undefined

    constructor(
        groupNames: string[],
        api: BooruApi,
        wikiModal: WikiModal,
        options: TagInputOptions
    ) {
        for (const groupName of groupNames) {
            this.createInput(groupName, options)
        }
        this.api = api
        this.options = options

        // Keep track of selected tags
        let activeTags: HTMLElement[]
        this.container.addEventListener("contextmenu", () => {
            activeTags = this.getActiveTags()
        })
        const singleTagSelected = (element: HTMLElement) => {
            return activeTags.length === 0 || !activeTags.includes(element)
                || (activeTags.length === 1 && activeTags[0] === element)
        }
        const multipleTagsSelected = (element: HTMLElement) => {
            return activeTags.length > 1 && activeTags.includes(element)
        }

        // Create a context menu
        const tagContextMenu = new ContextMenu([

            // ----------------------------------------------------------------
            // Actions for single tags
            // ----------------------------------------------------------------

            { title: "Browse tag", icon: "th", action: (tagElement) => {
                const tagName = tagElement.dataset.value!.replaceAll(" ", "_")
                window.open(this.api.getQueryUrl([tagName]), "_blank")?.focus()
            }, condition: singleTagSelected },

            { title: "Open wiki page", icon: "question", action: (tagElement) => {
                const tagName = tagElement.dataset.value!
                wikiModal.openPage(tagName)
            }, condition: singleTagSelected },

            { title: "Set tag type", icon: "pencil", action: (tagElement) => {
                openTagTypePopup(tagElement, api)
            }, condition: singleTagSelected },

            { title: "Copy tag", icon: "copy", action: (tagElement) => {
                const value = tagElement.dataset.value!.replaceAll(" ", "_")
                navigator.clipboard.writeText(value)
            }, condition: singleTagSelected },

            { title: "Remove tag", icon: "trash", action: (tagElement) => {
                const value = tagElement.dataset.value!
                for (const tagInput of this.tagInputs) {
                    tagInput.removeSelected(value)
                }
            }, condition: singleTagSelected },

            // ----------------------------------------------------------------
            // Actions for selections of multiple tags
            // ----------------------------------------------------------------

            { title: "Copy selected tags", icon: "copy", action: () => {
                this.copyTags(activeTags)
            }, condition: multipleTagsSelected },

            { title: "Remove selected tags", icon: "trash", action: () => {
                for (const tagInput of this.tagInputs) {
                    const tagElements = tagInput.getElement().querySelectorAll("a.ui.label.active")
                    for (const tagElement of tagElements) {
                        tagInput.removeSelected((tagElement as HTMLElement).dataset.value!)
                    }
                }
            }, condition: multipleTagsSelected }
        ])
        tagContextMenu.attachToMultiple(this.container, "a.ui.label", (e) => e)
    }

    createInput(groupName: string, options: TagInputOptions) {
        let lastResults: TagInfo[] | undefined
        const specialChars = /[-_~/!.:;+=|]/g
        function normalize(word: string) {
            return word.replaceAll(specialChars, " ").toLowerCase()
        }
        const tagSearch = new TagSearch<TagInfo>({
            multiSelect: true,
            allowAdditions: true,
            maxResults: 10,
            searchDelay: options.searchDelay,
            placeholder: "",
            delimiterKeyCode: options.separateTagsWithSpace ? 32 : 0,
            delimiter: options.separateTagsWithSpace ? " " : "\u00A0",  // Non-breaking space
            selectFirstResult: options.selectFirstResult,
            onAdd: (value) => {
                const tagName = value.trim().toLowerCase().replaceAll(" ", "_")
                this.tags.add(tagName)
            },
            onRemove: (value) => {
                const tagName = value.trim().toLowerCase().replaceAll(" ", "_")
                this.tags.delete(tagName)
            },
            validateAddition: (value) => {
                const tagName = value.trim().toLowerCase().replaceAll(" ", "_")
                return !this.tags.has(tagName)
            },
            getResults: async (query) => {
                this.lastActiveInput = tagSearch
                query = query.trim().toLowerCase().replaceAll(" ", "_")
                query = query.replaceAll("\\", "\\\\")  // Replace backslash with double backslash
                lastResults = await this.api.getTagCompletions(query)
                return lastResults || []
            },
            itemBuilder: (data) => {
                let postCountString = data.postCount.toString()
                if (data.postCount >= 1000) postCountString = postCountString.slice(0, -3) + "k"
                const isRare = data.postCount < options.postCountThreshold && data.type === "tag"
                return `<a class="wide result ${isRare ? "rare" : ""}" data-type="${data.type}"><div class="content">`+
                        `<div class="title">${data.title}&nbsp;&nbsp;(${postCountString})</div></div></a>`
            },
            transformInput: (value) => value.replaceAll("_", " ").trim().toLowerCase(),
            checkMatch: (input, { title, synonyms }) => {
                const normInput = normalize(input)
                if (normalize(title).startsWith(normInput)) return true
                if (!synonyms || !synonyms.length) return false
                return synonyms.some(s => normalize(s).startsWith(normInput))
            },
            onLabelCreate: async (label, tagName) => {
                label.childNodes[0].textContent = tagName
                if (this.pastingTags) return
                let tagInfo: TagInfo | undefined

                // If tag is included in the last search completions, take data from there
                if (lastResults) {
                    const tagInfoFiltered = lastResults.filter(({ title }) => title === tagName)
                    if (tagInfoFiltered.length > 0) {
                        tagInfo = tagInfoFiltered[0]
                    }
                }

                // Otherwise, try to request tag data via the API
                if (tagInfo === undefined) {
                    try {
                        tagInfo = await this.api.getSingleTagInfo(tagName)
                    } catch (error) {
                        return
                    }
                }

                this.applyTagInfo(tagInfo, label)
            }
        })

        // Create a row with the new tag field
        const row = E("div", { class: "main-row" }, [
            E("div", { class: "row-title" }, groupName),
            tagSearch.getElement()
        ])

        // Make it possible to paste a list of tags
        const innerSearchEntry = tagSearch.getElement().querySelector("input.search") as HTMLElement
        innerSearchEntry.addEventListener("paste", async (event) => {
            if (!event.clipboardData) return null
            event.preventDefault()
            event.stopImmediatePropagation()
            const text = event.clipboardData.getData("text").trim()
            if (text.length === 0) return
            let tagNames = text.trim().split(/\s+/g).map(tag => tag.toLowerCase())
            tagNames = tagNames.filter(tag => !this.tags.has(tag))
            if (!options.separateTagsWithSpace)
                tagNames = tagNames.map(tagName => tagName.replaceAll("_", " "))
            this.pastingTags = true
            tagSearch.addValues(tagNames)
            this.pastingTags = false

            // Get information about all new tags with a single request
            const newTagsSet = new Set(tagNames)
            const tagInfos = await this.api.getMultipleTagInfos(tagNames)
            const tagElements = tagSearch.getTagElements()
            for (const tagElement of tagElements) {
                const tagName = tagElement.dataset.value!
                if (!newTagsSet.has(tagName)) continue
                const tagKey = tagName.replaceAll(" ", "_")
                const tagInfo = tagInfos.get(tagKey)
                this.applyTagInfo(tagInfo, tagElement)
            }
        })

        this.tagInputs.push(tagSearch)
        this.groupToTagInput.set(groupName, tagSearch)
        this.container.appendChild(row)
    }

    async applyTagInfo(tagInfo: TagInfo | undefined, label: HTMLElement) {
        if (tagInfo === undefined) {
            tagInfo = { title: "", postCount: 0, type: "tag" }
        }

        // Set tag type in the element data for styling
        label.dataset.type = tagInfo.type

        // Warn user if tag is deprecated or if its post count is below the
        // specified threshold
        if (tagInfo.type === "deprecated" || (tagInfo.type === "tag" &&
                tagInfo.postCount < this.options.postCountThreshold)) {
            label.classList.add("rare")
            let content
            if (tagInfo.type === "deprecated") {
                content = "This tag is deprecated."
            } else if (tagInfo.postCount > 0) {
                const postInflection = tagInfo.postCount === 1 ? "post" : "posts"
                content = `This tag only appears in ${tagInfo.postCount} ${postInflection}, ` +
                    `it might be non-standard or contain a typo`
            } else {
                content = `This tag does not exist. It might contain a typo.` 
            }
            $(label).popup({
                content,
                onShow: function () { this[0].classList.add("warning") }
            })
        }

        // Warn user if the tag is a banned artist (only relevant for Danbooru)
        if (this.api instanceof DanbooruApi && tagInfo.type === "artist") {
            let isBanned: boolean
            if (label.dataset.banned) {
                isBanned = label.dataset.banned === "true"
            } else {
                const tagName = tagInfo.title.replaceAll(" ", "_")
                const artistInfo = await this.api.getArtistInfo(tagName)
                isBanned = artistInfo !== null && artistInfo.isBanned
            }
            if (isBanned) {
                label.classList.add("rare", "banned")
                $(label).popup({
                    content: "This artist has been banned on Danbooru.",
                    onShow: function () { this[0].classList.add("warning", "banned") }
                })
                $(label).popup("show")
                window.setTimeout(() => $(label).popup("hide"), 2500)
            }
        }
    }

    getActiveTags(): HTMLElement[] {
        const tagElements: HTMLElement[] = []
        for (const tagInput of this.tagInputs) {
            const elements = tagInput.getElement().querySelectorAll("a.ui.label.active")
            tagElements.push(...(elements as NodeListOf<HTMLElement>))
        }
        return tagElements
    }

    getContainer(): HTMLElement {
        return this.container
    }

    getFirst(): TagSearch<TagInfo> {
        return this.tagInputs[0]
    }

    getTags(): string[] {
        return [...this.tags]
    }

    getLastActiveInput() {
        return this.lastActiveInput
    }

    getGroupedTags(): EnhancedTags {
        const groupToTags: { [tag: string]: string[] } = {}
        const tagToType: { [tag: string]: TagType } = {}
        for (const [groupName, tagInput] of this.groupToTagInput.entries()) {
            const elements = tagInput.getElement().querySelectorAll("a.ui.label")
            if (elements.length === 0) continue
            const tagList = []
            for (const tagElement of elements) {
                const dataset = (tagElement as HTMLElement).dataset
                const tag = dataset.value!
                const tagType = dataset.type as TagType
                tagList.push(tag)
                if (tagType !== "tag")
                    tagToType[tag] = tagType
            }
            groupToTags[groupName] = tagList
        }
        return { groupToTags, tagToType }
    }

    async insertGroupedTags({ groupToTags, tagToType }: EnhancedTags, updateTagInfos=false) {
        const newTags: string[] = []
        for (const groupName in groupToTags) {
            const tagInput = this.groupToTagInput.get(groupName)
            if (!tagInput) continue
            const existingTags = new Set(tagInput.getValues())
            this.pastingTags = true
            tagInput.addValues(groupToTags[groupName])
            this.pastingTags = false
            const tagElements = tagInput.getTagElements()
            for (const tagElement of tagElements) {
                const tag = tagElement.dataset.value!
                if (existingTags.has(tag)) continue
                newTags.push(tag)
                if (!updateTagInfos) {
                    const tagType = tagToType[tag]
                    if (tagType) tagElement.dataset.type = tagType
                }
            }
        }
        if (updateTagInfos) {
            const tagInfos = await this.api.getMultipleTagInfos(newTags)
            for (const groupName in groupToTags) {
                const tagInput = this.groupToTagInput.get(groupName)
                if (!tagInput) continue
                const tagElements = tagInput.getTagElements()
                for (const tagElement of tagElements) {
                    const tagName = tagElement.dataset.value!
                    const tagKey = tagName.replaceAll(" ", "_")
                    if (tagInfos.has(tagKey)) {
                        const tagInfo = tagInfos.get(tagKey)
                        this.applyTagInfo(tagInfo, tagElement)
                    }
                }
            }
        }
    }

    copyTags(tagElements?: HTMLElement[], cut=false): boolean {
        if (tagElements === undefined) {
            tagElements = this.getActiveTags()
        }
        if (tagElements.length === 0) return false
        const selectedTags = tagElements.map(element => element.dataset.value!)
        if (!cut) {
            tagElements.forEach(tag => tag.classList.remove("active"))
        } else {
            for (const tagInput of this.tagInputs) {
                selectedTags.forEach(tag => tagInput.removeSelected(tag))
            }
        }
        const normedTags = selectedTags.map(tag => tag.replaceAll(" ", "_"))
        navigator.clipboard.writeText(normedTags.join(" "))
        return true
    }

    clear() {
        this.tagInputs.forEach(tagInput => tagInput.clear())
    }
}
