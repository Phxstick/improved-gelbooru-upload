import GelbooruApi from "js/gelbooru-api";
import ContextMenu from "js/generic/context-menu";
import TagSearch from "js/generic/tag-search";
import { E } from "js/utility";
import "./tag-inputs.scss"

// Create a popup menu for choosing a different tag type
function openTagTypePopup(tagElement: HTMLElement) {
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
    tagTypeMenu.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null
        if (target === null) return
        if (target.parentElement !== tagTypeMenu) return
        GelbooruApi.setTagType(tagElement, target.dataset.value as GelbooruApi.TagType)
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
    apiCredentials: GelbooruApi.Credentials
}

export default class TagInputs {
    private tags = new Set<string>()
    private groupToTagInput = new Map<string, TagSearch>()
    private tagInputs: TagSearch[] = []
    private container = E("div", { class: "tag-inputs-container" })

    constructor(groupNames: string[], options: TagInputOptions) {
        for (const groupName of groupNames) {
            this.createInput(groupName, options)
        }

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

            { title: "Set tag type", icon: "pencil", action: (tagElement) => {
                openTagTypePopup(tagElement)
            }, condition: singleTagSelected },

            { title: "Browse tag", icon: "th", action: (tagElement) => {
                const value = tagElement.dataset.value!.replaceAll(" ", "_")
                const url = "https://gelbooru.com/index.php?page=post&s=list&tags=" + value
                window.open(url, "_blank")?.focus()
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
                const selectedTags = activeTags.map(e => e.dataset.value!.replaceAll(" ", "_"))
                navigator.clipboard.writeText(selectedTags.join(" "))
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
        let lastResults: GelbooruApi.TagInfo[] | undefined
        const tagSearch = new TagSearch({
            multiSelect: true,
            allowAdditions: true,
            maxResults: 10,
            searchDelay: options.searchDelay,
            placeholder: "",
            delimiterKeyCode: options.separateTagsWithSpace ? 32 : 226,
            delimiter: options.separateTagsWithSpace ? " " : "|",
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
                query = query.trim().toLowerCase().replaceAll(" ", "_")
                lastResults = await GelbooruApi.getTagCompletions(query)
                return lastResults || []
            },
            itemBuilder: (data: any) => {
                let postCountString = data.postCount.toString()
                if (data.postCount >= 1000) postCountString = postCountString.slice(0, -3) + "k"
                const isRare = data.postCount < options.postCountThreshold && data.type === "tag"
                return `<a class="wide result ${isRare ? "rare" : ""}" data-type="${data.type}"><div class="content">`+
                        `<div class="title">${data.title}&nbsp;&nbsp;(${postCountString})</div></div></a>`
            },
            transformInput: (value) => value.replaceAll("_", " ").trim().toLowerCase(),
            checkMatch: (input, completion) => completion.replaceAll("-", " ").startsWith(input),
            onLabelCreate: async (label, tagName) => {
                label.childNodes[0].textContent = tagName
                let tagInfo: GelbooruApi.TagInfo | undefined

                // If tag is included in the last search completions, take data from there
                if (lastResults) {
                    const tagInfoFiltered = lastResults.filter(({ title }) => title === tagName)
                    if (tagInfoFiltered.length > 0) {
                        tagInfo = tagInfoFiltered[0]
                    }
                }

                // Otherwise, request tag data via the Gelbooru API (if auth data is set)
                const apiCred = options.apiCredentials
                if (tagInfo === undefined && apiCred.apiKey && apiCred.userId) {
                    tagInfo = await GelbooruApi.getTagInfo(tagName, apiCred)
                }
                if (tagInfo === undefined) return

                // Warn user if tag is deprecated or if its post count is below the specified threshold
                if (tagInfo.type === "deprecated" || (tagInfo.type === "tag" &&
                        tagInfo.postCount < options.postCountThreshold)) {
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

                // Set tag type in the element data for styling
                label.dataset.type = tagInfo.type
            }
        })

        // Create a row with the new tag field
        const row = E("div", { class: "main-row" }, [
            E("div", { class: "row-title" }, groupName),
            tagSearch.getElement()
        ])

        // Make it possible to paste a list of tags with the Gelbooru format
        const innerSearchEntry = tagSearch.getElement().querySelector("input.search") as HTMLElement
        innerSearchEntry.addEventListener("paste", (event) => {
            if (!event.clipboardData) return null
            event.preventDefault()
            const text = event.clipboardData.getData("text")
            let tagNames = text.trim().split(" ")
            if (!options.separateTagsWithSpace)
                tagNames = tagNames.map(tagName => tagName.replaceAll("_", " "))
            tagNames.forEach(tagName => tagSearch.addSelected(tagName))
        })

        this.tagInputs.push(tagSearch)
        this.groupToTagInput.set(groupName, tagSearch)
        this.container.appendChild(row)
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

    getFirst(): TagSearch {
        return this.tagInputs[0]
    }

    getTags(): string[] {
        return [...this.tags]
    }

    getGroupedTags(): Map<string, string[]> {
        const groupToTags = new Map<string, string[]>()
        for (const [groupName, tagInput] of this.groupToTagInput.entries()) {
            const elements = tagInput.getElement().querySelectorAll("a.ui.label")
            if (elements.length === 0) continue
            groupToTags.set(groupName, [...elements].map(
                el => (el as HTMLElement).dataset.value!))
        }
        return groupToTags
    }

    insertGroupedTags(groupToTags: Map<string, string[]>): void {
        for (const [groupName, tags] of groupToTags.entries()) {
            const tagInput = this.groupToTagInput.get(groupName)
            if (!tagInput) continue
            const existingTags = tagInput.getValues()
            tagInput.setValues([...existingTags, ...tags], true)
        }
    }

    clear() {
        this.tagInputs.forEach(tagInput => tagInput.clear())
    }
}