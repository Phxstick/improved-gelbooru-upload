import ContextMenu from "js/generic/context-menu";
import TagSearch from "js/generic/tag-search";
import { BooruApi, TagType, TagInfo, HostName } from "js/types";
import { E, escapeHtml } from "js/utility";
import "./tag-inputs.scss"

// Create a modal dialog for displaying wiki pages
const wikiModalHeader = E("div", { class: "header" })
const wikiModalContent = E("div", { class: "content" })
const wikiModal = E("div", { class: "ui modal wiki-modal" }, [
    wikiModalHeader,
    wikiModalContent
])
const alertModal = E("div", { class: "ui modal" }, [
    E("div", { class: "content" }),
])
const fullscreenLoader = E("div", { class: "ui huge loader shadowed hidden" })
const modalLoader = E("div", { class: "ui huge loader shadowed hidden" })

async function openWikiPage(tag: string, api: BooruApi) {
    const tagName = escapeHtml(tag.replaceAll("_", " "))
    tag = tag.replaceAll(" ", "_")
    if ($(wikiModal).modal("is active")) {
        $(wikiModal).dimmer("show")
        modalLoader.classList.remove("hidden")
    } else {
        $(wikiModal).modal("show dimmer")
        fullscreenLoader.classList.remove("hidden")
    }
    const [wikiPage, recentPosts] = await Promise.all([
        api.getWikiPage(tag),
        api.searchPosts([tag], 14),
        // Prevent loading from disappearing too quickly
        new Promise(resolve => setTimeout(resolve, 260))
    ])
    modalLoader.classList.add("hidden")
    fullscreenLoader.classList.add("hidden")
    if (!wikiPage && recentPosts.length === 0) {
        $(alertModal).modal({
            class: 'mini',
            classContent: "centered",
            content: `The tag "${tagName}" doesn't exist.`,
            duration: 200
        } as any).modal('show');
        return
    }
    wikiModalHeader.textContent = tagName
    if (wikiPage) {
        wikiModalContent.innerHTML = wikiPage
    } else {
        wikiModalContent.innerHTML =
            `<p style="color:dimgray">There's no wiki page for this tag.</p>`
    }
    const thumbnails = recentPosts.map(post => {
        const href = api.getPostUrl(post.id)
        return E("a", { class: "booru-post", href, target: "_blank" }, [
            E("img", { class: "small preview", src: post.thumbnailUrl })
        ])
    })
    const viewAllUrl = api.getQueryUrl([tag])
    const postsContainer = E("div", { class: "recent-posts-wrapper" }, [
        E("div", { class: "header" }, [
            E("h4", {}, "Recent posts"),
            E("a", { href: viewAllUrl, target: "_blank" }, "View all"),
        ]),
        E("div", { class: "recent-posts" }, thumbnails)
    ])
    wikiModalContent.appendChild(postsContainer)
    $(wikiModal).dimmer("hide")
    $(wikiModal).modal("show")
}

// When F2 is pressed, open the wiki page for the currently relevant tag
window.addEventListener("keydown", (event) => {
    if (event.key !== "F2") return
    const value = TagInputs.getLastActiveInput()
    if (!value) return
    const [activeInput, api] = value
    const hoveredCompletion = activeInput.getHoveredCompletion()
    if (hoveredCompletion) {
        openWikiPage(hoveredCompletion.title, api)
        return
    }
    const currentInput = activeInput.getCurrentInput()
    if (currentInput) {
        openWikiPage(currentInput, api)
        return
    }
})

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

    private static lastActiveInput: [TagSearch<TagInfo>, BooruApi] | undefined
    static getLastActiveInput() { return TagInputs.lastActiveInput }

    constructor(groupNames: string[], api: BooruApi, options: TagInputOptions) {
        for (const groupName of groupNames) {
            this.createInput(groupName, options)
        }
        this.api = api

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
                openWikiPage(tagName, this.api)
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
                const selectedTags = activeTags.map(e => e.dataset.value!.replaceAll(" ", "_"))
                activeTags.forEach(tag => tag.classList.remove("active"))
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

        // Initialize modal for wiki pages
        if (wikiModal.offsetParent === null) {
            document.body.appendChild(wikiModal)
            $(wikiModal).modal({ duration: 180 })
            wikiModal.addEventListener("click", (event) => {
                const target = event.target as HTMLElement
                if (target.classList.contains("wiki-link")) {
                    event.preventDefault()
                    openWikiPage(target.textContent!, this.api)
                }
                else if (target.classList.contains("post-link")) {
                    event.preventDefault()
                    const postId = parseInt(target.dataset.postId!)
                    const postUrl = this.api.getPostUrl(postId)
                    window.open(postUrl, "_blank")?.focus()
                }
                else if (target.classList.contains("posts-search")) {
                    event.preventDefault()
                    const tags = target.dataset.tags!.trim().split(" ")
                    const queryUrl = this.api.getQueryUrl(tags)
                    window.open(queryUrl, "_blank")?.focus()
                }
            })
            // Initialize large loader for the fullscreen dimmer
            const fullscreenDimmer = document.querySelector(".ui.dimmer")
            if (fullscreenDimmer) {
                fullscreenDimmer.appendChild(fullscreenLoader)
            }
            // Create dimmer inside modal and initialize loader there
            $(wikiModal).dimmer({ duration: 200 })
            $(wikiModal).dimmer("set opacity", 0.65)
            const modalDimmer = wikiModal.querySelector(".ui.dimmer")
            if (modalDimmer) {
                modalDimmer.appendChild(modalLoader)
            }
        }
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
                TagInputs.lastActiveInput = [tagSearch, this.api]
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
                        tagInfo = await this.api.getTagInfo(tagName)
                    } catch (error) {
                        return
                    }
                    if (tagInfo === undefined) {
                        tagInfo = { title: tagName, postCount: 0, type: "tag" }
                    }
                }

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

                // Warn user if the tag is a banned artist (only relevant for Danbooru)
                if (this.api.host === HostName.Danbooru && label.dataset.banned) {
                    label.classList.add("rare")
                    $(label).popup({
                        content: "This artist has been banned on Danbooru.",
                        onShow: function () { this[0].classList.add("warning") }
                    })
                    $(label).popup("show")
                    window.setTimeout(() => $(label).popup("hide"), 2500)
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

        // Make it possible to paste a list of tags
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

    getFirst(): TagSearch<TagInfo> {
        return this.tagInputs[0]
    }

    getTags(): string[] {
        return [...this.tags]
    }

    getApi(): BooruApi {
        return this.api
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
