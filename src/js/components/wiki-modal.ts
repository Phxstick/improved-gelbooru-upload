import { E, escapeHtml, showInfoModal, catchError } from "js/utility";
import { BooruApi, BooruPost } from "js/types";

export class AbortedError extends Error {
    constructor() {
        super("Loading has been cancelled.")
        this.name = "AbortedError"
    }
}

export default class WikiModal {
    private readonly api: BooruApi

    private readonly header = E("div", { class: "header" })
    private readonly content = E("div", { class: "content" })
    private readonly root = E("div", { class: "ui modal wiki-modal" }, [
        this.header,
        this.content
    ])
    private readonly fullscreenLoader =
        E("div", { class: "ui huge loader shadowed hidden" })
    private readonly modalLoader =
        E("div", { class: "ui huge loader shadowed hidden" })

    private loading = false
    private abortLoading = () => {}

    constructor(api: BooruApi) {
        this.api = api
        document.body.appendChild(this.root)
        $(this.root).modal({ duration: 180 })
        this.root.addEventListener("click", (event) => {
            const target = event.target as HTMLElement
            if (target.classList.contains("wiki-link")) {
                event.preventDefault()
                this.openPage(target.textContent!)
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
            fullscreenDimmer.appendChild(this.fullscreenLoader)
        }
        // Create dimmer inside modal and initialize loader there
        $(this.root).dimmer({ duration: 200 })
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
    }

    async openPage(tag: string) {
        if (this.loading) return
        this.loading = true
        const tagName = escapeHtml(tag.replaceAll("_", " "))
        tag = tag.replaceAll(" ", "_").toLowerCase()

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
                    this.api.getWikiPage(tag),
                    this.api.searchPosts([tag], 14),
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
                showInfoModal(`Failed to load the wiki page for "${tagName}".`)
                return
            }
        }
        const [wikiPage, recentPosts] = data as [string, BooruPost[]]

        // Show notification if the given tag doesn't exist
        if (!wikiPage && recentPosts.length === 0) {
            showInfoModal(`The tag "${tagName}" doesn't exist.`)
            return
        }

        // Insert wiki page (if available)
        this.header.textContent = tagName
        if (wikiPage) {
            this.content.innerHTML = wikiPage
        } else {
            this.content.innerHTML =
                `<p style="color:dimgray">There's no wiki page for this tag.</p>`
        }
        this.content.scrollTop = 0

        // Display a few recent posts (if available)
        if (recentPosts.length) {
            const thumbnails = recentPosts.map(post => {
                const href = this.api.getPostUrl(post.id)
                return E("a", { class: "booru-post", href, target: "_blank" }, [
                    E("img", { class: "small preview", src: post.thumbnailUrl })
                ])
            })
            const viewAllUrl = this.api.getQueryUrl([tag])
            const postsContainer = E("div", { class: "recent-posts-wrapper" }, [
                E("div", { class: "header" }, [
                    E("h4", {}, "Recent posts"),
                    E("a", { href: viewAllUrl, target: "_blank" }, "View all"),
                ]),
                E("div", { class: "recent-posts" }, thumbnails)
            ])
            this.content.appendChild(postsContainer)
        }

        $(this.root).dimmer("hide")
        $(this.root).modal("show")
    }
}
