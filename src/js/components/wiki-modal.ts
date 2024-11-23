import { E, escapeHtml, showInfoModal, catchError } from "js/utility";
import { BooruApi, BooruPost, TagInfo, TagType } from "js/types";
import "./modal.scss"
import "./wiki-modal.scss"

export class AbortedError extends Error {
    constructor() {
        super("Loading has been cancelled.")
        this.name = "AbortedError"
    }
}

interface WikiPage {
    header: string
    content: string
    type: TagType | null
    recentPosts: BooruPost[]
}

interface HistoryEntry {
    name: string
    data: WikiPage
    scrollPos: number
}

export default class WikiModal {
    private readonly api: BooruApi

    private readonly closeButton = 
        E("button", { class: "close-button" }, [
            E("i", { class: "ui icon close" })
        ])
    private readonly backButton =
        E("button", { class: "history-back", disabled: "" }, [
            E("i", { class: "ui icon arrow left" })
        ])
    private readonly forwardButton =
        E("button", { class: "history-forward", disabled: "" }, [
            E("i", { class: "ui icon arrow right" })
        ])
    private readonly headerText = E("div", { class: "header-text" })
    private readonly header = E("div", { class: "header" }, [
        this.headerText,
        E("div", { class: "header-buttons" }, [
            this.backButton,
            this.forwardButton,
            this.closeButton
        ])
    ])
    private readonly content = E("div", { class: "content" })
    private readonly root = E("div", { class: "ui modal wiki-modal" }, [
        this.header,
        this.content
    ])
    private readonly fullscreenLoader =
        E("div", { class: "ui huge loader shadowed hidden" })
    private readonly modalLoader =
        E("div", { class: "ui huge loader shadowed hidden" })

    private isOpen = false
    private loading = false
    private abortLoading = () => {}
    private lastFocussed: Element | null = null

    private readonly maxHistorySize = 10
    private history: HistoryEntry[]  = []
    private historyIndex = -1

    constructor(api: BooruApi) {
        this.api = api
        document.body.appendChild(this.root)
        $(this.root).modal({
            duration: 180,
            // Save scroll position and restore focus when modal is closed
            onHide: () => {
                if (this.historyIndex < 0) return
                const scrollPos = this.content.scrollTop
                this.history[this.historyIndex].scrollPos = scrollPos
                this.isOpen = false
                if (this.lastFocussed)
                    (this.lastFocussed as HTMLElement).focus()
                this.lastFocussed = null
            }
        })

        // Add event listeners for wiki links in the page content
        this.root.addEventListener("click", (event) => {
            const target = event.target as HTMLElement
            if (target.classList.contains("wiki-link")) {
                event.preventDefault()
                this.openPage(target.dataset.page!)
            }
            else if (target.classList.contains("local-link")) {
                const refId = target.dataset.linkto
                const linkDestination = this.content.querySelector(
                    `[data-ref="${refId}"]`) as HTMLElement | null
                if (linkDestination) {
                    linkDestination.scrollIntoView()
                    // Put some padding between the upper edge of the modal
                    // content and the linked element so that it looks nicer
                    const bottomOffset = 
                        this.content.scrollHeight - linkDestination.offsetTop
                    if (bottomOffset > this.content.offsetHeight) {
                        this.content.scrollTop = this.content.scrollTop - 8
                    }
                }
            }
        })

        // Initialize large loader for the fullscreen dimmer
        const fullscreenDimmer = document.querySelector(".ui.dimmer")
        if (fullscreenDimmer) {
            fullscreenDimmer.appendChild(this.fullscreenLoader)
        }

        // Create dimmer inside modal and initialize loader there
        $(this.root).dimmer({ duration: 180 })
        $(this.root).dimmer("set opacity", 0.65)
        const modalDimmer = this.root.querySelector(".ui.dimmer")
        if (modalDimmer) {
            modalDimmer.appendChild(this.modalLoader)
        }

        // Make it possible to cancel loading by pressing escape
        window.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                if (this.loading) this.abortLoading()
            }
        }, { capture: true })

        // Add event handlers to header buttons
        this.closeButton.addEventListener("click", () => {
            $(this.root).modal("hide")
        })
        this.forwardButton.addEventListener("click", () => {
            if (this.historyIndex < 0) return
            if (this.historyIndex === this.history.length - 1) return
            this.history[this.historyIndex].scrollPos = this.content.scrollTop
            this.historyIndex += 1
            this.backButton.removeAttribute("disabled")
            if (this.historyIndex === this.history.length - 1) {
                this.forwardButton.setAttribute("disabled", "")
            }
            const { name, data, scrollPos } = this.history[this.historyIndex]
            this.displayPage(name, data, scrollPos)
        })
        this.backButton.addEventListener("click", () => {
            if (this.historyIndex < 0) return
            if (this.historyIndex === 0) return
            this.history[this.historyIndex].scrollPos = this.content.scrollTop
            this.historyIndex -= 1
            this.forwardButton.removeAttribute("disabled")
            if (this.historyIndex === 0) {
                this.backButton.setAttribute("disabled", "")
            }
            const { name, data, scrollPos } = this.history[this.historyIndex]
            this.displayPage(name, data, scrollPos)
        })

    }

    async openPage(name: string) {
        if (this.loading) return
        name = name.replaceAll(" ", "_").toLowerCase()

        // Save scroll position of the current page
        if (this.historyIndex >= 0 && this.content.offsetParent) {
            this.history[this.historyIndex].scrollPos = this.content.scrollTop
        }

        // Take wiki page from history if it's cached there, otherwise fetch it
        let wikiPage: WikiPage
        const index = this.history.findIndex(item => item.name === name)
        if (index >= 0) {
            wikiPage = this.history[index].data
            // Remove old history entry
            if (index <= this.historyIndex) {
                this.history.splice(index, 1)
                this.historyIndex -= 1
            }
        } else {
            const page = await this.loadPage(name)
            if (!page) return
            wikiPage = page
        }

        // Update history
        if (this.historyIndex >= 0) {
            this.history.splice(this.historyIndex + 1)
        }
        if (this.history.length === this.maxHistorySize) {
            this.history.splice(0, 1)
        }
        if (this.historyIndex < this.maxHistorySize - 1) {
            this.historyIndex += 1
        }
        if (this.historyIndex === this.history.length - 1) {
            this.forwardButton.setAttribute("disabled", "")
        }
        if (this.history.length > 0) {
            this.backButton.removeAttribute("disabled")
        }
        this.history.push({
            name,
            data: wikiPage,
            scrollPos: 0
        })

        this.displayPage(name, wikiPage)
    }

    private async loadPage(name: string): Promise<WikiPage | undefined> {
        const escapedName = escapeHtml(name.replaceAll("_", " "))
        this.loading = true

        // Show fitting dimmer and loader
        if ($(this.root).modal("is active")) {
            $(this.root).dimmer("show")
            this.modalLoader.classList.remove("hidden")
        } else {
            $(this.root).modal("show dimmer")
            this.fullscreenLoader.classList.remove("hidden")
        }

        // Load relevant data using API, allow aborting manually
        const [data, error] = await catchError(() => {
            return new Promise(async (resolve, reject) => {
                this.abortLoading = () => reject(new AbortedError())
                const results = await Promise.all([
                    this.api.getWikiPage(name),
                    this.api.searchPosts([name], { limit: 14 }),
                    this.api.getSingleTagInfo(name),
                    // Prevent spinner from disappearing too quickly
                    new Promise(res => setTimeout(res, 200))
                ])
                resolve(results)
            })
        })
        this.modalLoader.classList.add("hidden")
        this.fullscreenLoader.classList.add("hidden")
        this.loading = false

        // Catch errors or manual cancellation
        if (error) {
            if (error instanceof AbortedError) {
                $(this.root).modal("hide dimmer")
                return
            } else {
                showInfoModal(`Failed to load the wiki page for "${escapedName}".`)
                return
            }
        }
        const [wikiPage, recentPosts, tagInfo] = data as [string, BooruPost[], TagInfo?]

        // Show notification if the given tag doesn't exist
        if (!wikiPage && recentPosts.length === 0) {
            showInfoModal(`The tag "${escapedName}" doesn't exist.`)
            return
        }

        return {
            header: name.replaceAll("_", " "),
            content: wikiPage,
            type: tagInfo ? tagInfo.type : null,
            recentPosts
        }
    }

    private displayPage(name: string, data: WikiPage, scrollPos=0) {
        const { header, type, content, recentPosts } = data

        // Set header and insert page content (if available)
        if (content) {
            this.headerText.innerHTML = ""
            this.headerText.classList.remove("no-wiki-page")
            const wikiPageUrl = this.api.getWikiUrl(name)
            const headerLink = E("a", { href: wikiPageUrl, target: "_blank" })
            headerLink.textContent = header
            if (type) headerLink.dataset.type = type
            this.headerText.appendChild(headerLink)
            this.content.innerHTML = content
        } else {
            this.headerText.textContent = header
            this.headerText.classList.add("no-wiki-page")
            this.content.innerHTML =
                `<p style="color:dimgray">There's no wiki page with this name.</p>`
        }

        // Display a few recent posts (if available)
        if (recentPosts.length) {
            const thumbnails = recentPosts.map(post => {
                const href = this.api.getPostUrl(post.id)
                return E("a", { class: "booru-post", href, target: "_blank" }, [
                    E("img", { class: "small preview", src: post.thumbnailUrl })
                ])
            })
            const viewAllUrl = this.api.getQueryUrl([name])
            const postsHeader = E("div", { class: "recent-posts-header" }, [
                E("h4", {}, "Recent posts"),
                E("a", { href: viewAllUrl, target: "_blank" }, "View all"),
            ])
            const postsContainer = E("div", { class: "recent-posts-wrapper" }, [
                E("div", { class: "recent-posts" }, thumbnails)
            ])
            this.content.appendChild(postsHeader)
            this.content.appendChild(postsContainer)
        }
        this.content.scrollTop = scrollPos

        if (!this.isOpen)
            this.lastFocussed = document.activeElement
        this.isOpen = true

        $(this.root).dimmer("hide")
        $(this.root).modal("show")
    }
}
