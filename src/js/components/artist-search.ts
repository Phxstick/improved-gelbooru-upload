import browser from "webextension-polyfill";
import Component from "js/generic/component";
import TagSearch from "js/generic/tag-search";
import DropdownMenu from "js/generic/dropdown-menu";
import { E } from "js/utility"
import "./artist-search.scss"
import { FileUpload } from "js/components/file-upload";

const RECENT_ARTISTS_KEY = "recentlySearchedArtists"

export default class ArtistSearch extends Component {
    private tagInput: TagSearch
    private searchField: HTMLInputElement
    private recentlySearchedArtists: DropdownMenu
    private searching: boolean

    constructor(tagInput: TagSearch, fileUpload: FileUpload) {
        super()
        this.searching = false
        this.tagInput = tagInput

        // Create elements
        this.searchField = E("input", {
            class: "artist-search styled-input",
            maxlength: "0",
            tabindex: "-1"
        }) as HTMLInputElement
        this.recentlySearchedArtists = new DropdownMenu({
            header: "Recently searched artists",
            onSelect: (value) => this.tagInput.addSelected(value, "artist")
        })
        this.root = E("div", { class: "artist-search-wrapper" }, [
            this.searchField,
            this.recentlySearchedArtists.getElement()
        ])
        this.tagInput.getElement().insertAdjacentElement("afterend", this.root)

        // Add event listeners to drop area
        this.searchField.addEventListener("dragover", (event) => {
            event.preventDefault()
        })
        this.searchField.addEventListener("drop", async (event) => {
            event.preventDefault()
            this.searchField.classList.remove("dragover")
            if (!event.dataTransfer) return

            // Check if dragged data contains a valid URL
            let url = event.dataTransfer.getData("text/uri-list")
            if (!url) {
                url = event.dataTransfer.getData("text/plain")
            }
            this.searchByUrl(url)
        })

        // Highlight label when dragging something over it
        this.searchField.addEventListener("dragenter", () => {
            if (this.searching) return
            this.searchField.classList.add("dragover")
        })
        this.searchField.addEventListener("dragleave", () => {
            this.searchField.classList.remove("dragover")
        })

        // Tell user that pasting is possible when input is focussed
        this.searchField.addEventListener("focusin", () => {
            if (this.searching) return
            this.setStatus("Press Ctrl + V to paste URL", "placeholder")
        })
        this.searchField.addEventListener("focusout", () => {
            this.reset()
        })

        // If a Pixiv image was loaded from a webpage, clicking the search
        // field will determine the artist tag from the image URL
        let imageUrlSearchConducted = false
        this.searchField.addEventListener("click", async () => {
            if (this.searching || imageUrlSearchConducted) return
            const url = fileUpload.getUrl()
            if (!url) return
            imageUrlSearchConducted = true
            this.searchByUrl(url)
        })
        fileUpload.addFileUploadListener(() => {
            imageUrlSearchConducted = false
        })

        // Start search when pasting a URL
        this.searchField.addEventListener("paste", (event) => {
            event.preventDefault()
            if (!event.clipboardData) return

            let url = event.clipboardData.getData("text/uri-list")
            if (!url) {
                url = event.clipboardData.getData("text/plain")
            }
            this.searchByUrl(url)
        })

        // Load list of recent artists from local storage and display them
        browser.storage.local.get(RECENT_ARTISTS_KEY).then((values) => {
            const artistTags = values[RECENT_ARTISTS_KEY] as string[] | undefined
            if (artistTags === undefined) return
            this.recentlySearchedArtists.setItems(artistTags)
        })

        this.reset()
    }

    setStatus(text: string, className?: string) {
        this.searchField.classList.remove("success", "failure", "placeholder")
        if (className) this.searchField.classList.add(className)
        this.searchField.placeholder = text
    }

    reset() {
        this.setStatus("Drag artist page URL here to find artist tag", "placeholder")
    }

    /**
     * Search the Danbooru artist database for a given artist via URL.
     * @param url Any URL associated the artist, e.g. the URL of a pixiv post.
     * @returns Whether at least one artist tag has been found.
     */
    async searchByUrl(url: string): Promise<boolean> {
        if (this.searching) return false
        try {
            new URL(url)
        } catch (error) {
            this.setStatus("Given item does not contain a valid URL.", "failure")
            return false
        }
        this.searchField.blur()
        this.searchField.disabled = true
        this.setStatus("Searching...")
        this.searching = true

        // Send query to Danbooru's artist database and parse HTML response
        let doc: Document
        try {
            const response = await browser.runtime.sendMessage({
                type: "get-artist-tag",
                args: { url }
            })
            const parser = new DOMParser()
            doc = parser.parseFromString(response.html, "text/html")
        } catch (error) {
            this.setStatus("Failed to search for tags.", "failure")
            this.searchField.disabled = false
            this.searching = false
            return false
        }

        // Extract artist tags from the HTML document
        const table = doc.querySelector("#artists-table tbody")!
        const rows = [...table.querySelectorAll("tr")]
        if (rows.length === 0) {
            this.setStatus("No artist tag with the given URL exists.", "failure")
            this.searchField.disabled = false
            this.searching = false
            return false
        }
        const tagNames = rows.map(row =>
            row.querySelector("td.name-column a")!.textContent!.replaceAll("_", " "))

        // Insert artist tags into the first tag input, update status message
        tagNames.forEach(tagName => this.tagInput.addSelected(tagName, "artist"))
        const tag_s = tagNames.length === 1 ? "tag" : "tags"
        this.setStatus(`Found following ${tag_s}: ` + tagNames.join(", "), "success")
        
        // Add tags to list of recently searched artists
        const values = await browser.storage.local.get(RECENT_ARTISTS_KEY)
        let recentArtistsList = (values[RECENT_ARTISTS_KEY] as string[]) || []
        recentArtistsList = recentArtistsList.filter(
            artistTag => !tagNames.includes(artistTag))
        recentArtistsList = [...tagNames, ...recentArtistsList]
        if (recentArtistsList.length > 5) {
            recentArtistsList = recentArtistsList.slice(0, 5)
        }
        await browser.storage.local.set({ [RECENT_ARTISTS_KEY]: recentArtistsList })
        this.recentlySearchedArtists.setItems(recentArtistsList)

        this.searchField.disabled = false
        this.searching = false
        return true
    }
}