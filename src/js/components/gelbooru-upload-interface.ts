import browser from "webextension-polyfill";
import createImageUpload, { FileUpload, CheckResult } from "js/components/file-upload";
import TagInputs from "js/components/tag-inputs";
import ArtistSearch from "js/components/artist-search"
import RadioButtons from "js/generic/radiobuttons"
import Component from "js/generic/component"
import { Settings } from "js/types"
import { E } from "js/utility"

interface UploadSuccess {
    successful: false
    error: string
}
interface UploadFailure {
    successful: true
    gelbooruId: string
    url: string
}

export default class GelbooruUploadInterface extends Component {
    private sourceInput: HTMLInputElement
    private fileUpload: FileUpload
    private titleInput: HTMLInputElement
    private tagInputs: TagInputs
    private artistSearch: ArtistSearch
    private ratingSelection: RadioButtons
    private pixivTagsContainer: HTMLElement
    private uploading = false

    private static id = 0

    constructor(settings: Settings) {
        super()
        GelbooruUploadInterface.id++

        const { apiKey, userId, autoSelectFirstCompletion, tagGroups,
                hideTitleInput, separateTagsWithSpace, splitTagInputIntoGroups,
                minimumPostCount, searchDelay } = settings
        const tagGroupsList = splitTagInputIntoGroups ? tagGroups : ["Tags"]
        const apiCredentials = { apiKey, userId }

        // Create main components
        this.sourceInput = E("input", { class: "styled-input source-input" }) as HTMLInputElement
        this.fileUpload = createImageUpload(this.sourceInput, apiCredentials)
        this.titleInput = E("input", { class: "styled-input title-input"}) as HTMLInputElement
        this.pixivTagsContainer = E("div", { class: "pixiv-tags" })
        this.tagInputs = new TagInputs(tagGroupsList, {
            selectFirstResult: autoSelectFirstCompletion,
            postCountThreshold: minimumPostCount,
            separateTagsWithSpace,
            searchDelay,
            apiCredentials
        })
        this.artistSearch = new ArtistSearch(this.tagInputs.getFirst(), this.fileUpload)
        this.ratingSelection = new RadioButtons({
            // Name needs to be different across instances, otherwise all radiobuttons
            // will be associated with each other and only one will be globally active
            name: "rating" + GelbooruUploadInterface.id.toString(),
            values: ["e", "q", "s", "g"],
            defaultValue: "e",
            labels: {
                "e": "Explicit",
                "q": "Questionable",
                "s": "Sensitive",
                "g": "General"
            },
            inline: true
        })

        this.root = E("div", {}, [
            this.makeRow("File", this.fileUpload.getElement()),
            this.makeRow("Source", this.sourceInput),
            this.makeRow("Title", this.titleInput, hideTitleInput),
            this.pixivTagsContainer,
            this.tagInputs.getContainer(),
            this.makeRow("Rating", this.ratingSelection.getElement()),
        ])
    }

    private makeRow(header: string, content: HTMLElement, hidden=false): HTMLElement {
        return E("div", { class: "main-row" + (hidden ? " hidden" : "") }, [ 
            E("div", { class: "row-title" }, header), content
        ])
    }

    /**
     * Conduct a bunch of checks to assure that all data is in place.
     * Returns a description if an error is found, else undefined.
     */
    checkData(): string | undefined {
        const file = this.fileUpload.getFile()
        if (file === undefined) {
            return "You haven't uploaded an image."
        }
        if (this.fileUpload.foundMd5Match()) {
            return "You can't upload an image that has already been uploaded."
        }
        const tags = this.tagInputs.getTags()
        if (tags.length < 5) {
            return "You must add at least 5 tags."
        }
        const source = this.sourceInput.value.trim()
        if (source.length === 0 && !tags.includes("source_request")) {
            return "You must specify a source or add the tag 'source_request'."
        }
    }

    async upload(): Promise<UploadFailure | UploadSuccess> {
        if (this.uploading) return { successful: false, error: "Upload in progress."}
        const error = this.checkData()
        if (error) return { successful: false, error }
        this.uploading = true

        const file = this.fileUpload.getFile()!
        const tags = this.tagInputs.getTags()
        const source = this.sourceInput.value.trim()

        // Gather data in a form and submit it in a post request
        const formData = new FormData()
        formData.set("upload", file)
        formData.set("source", source)
        formData.set("title", this.titleInput.value.trim())
        formData.set("tags", tags.join(" "))
        formData.set("rating", this.ratingSelection.getValue())
        formData.set("submit", "Upload")  // Not sure if this is needed
        const response = await fetch("https://gelbooru.com/index.php?page=post&s=add", {
            method: "POST",
            body: formData
        })
        this.uploading = false

        // Handle response (302 = successful upload, 200 = unsuccessful)
        let uploadError: string
        if (response.redirected) {  // Can't read code 302 directly, check for redirection
            const urlParts = new URL(response.url)
            if (urlParts.searchParams.has("id")) {
                const postId = urlParts.searchParams.get("id")!
                // Notify associated extensions if an image from Pixiv has been uploaded
                if (this.fileUpload.getPixivId()) {
                    browser.runtime.sendMessage({
                        type: "notify-associated-extensions",
                        args: {
                            pixivIdToGelbooruIds: {
                                [this.fileUpload.getPixivId()]: [postId]
                            },
                            filenameToGelbooruIds: {
                                [file.name]: [postId]
                            }
                        }
                    })
                }
                return { successful: true, gelbooruId: postId, url: response.url }
            } else {
                uploadError = "Unexpected server response."
            }
        } else if (response.status === 200) {
            uploadError = "Upload failed. Please try again."
        } else {
            uploadError = "Unexpected server response."
        }
        return { successful: false, error: uploadError }
    }

    reset() {
        this.fileUpload.reset()
        this.sourceInput.value = ""
        this.titleInput.value = ""
        this.artistSearch.reset()
        this.clearPixivTags()
        this.tagInputs.clear()
        this.ratingSelection.reset()
        this.root.scrollTop = 0
    }

    getLargeImagePreview(): HTMLElement {
        return this.fileUpload.getLargeImagePreview()
    }

    passDroppedFile(dropData: DataTransfer): Promise<CheckResult> {
        return this.fileUpload.handleDropData(dropData)
    }

    addFileUploadListener(onFileUpload: (objectUrl: string) => void) {
        this.fileUpload.addFileUploadListener(onFileUpload)
    }

    addStatusCheckListener(onStatusCheck: (matches: string[]) => void) {
        this.fileUpload.addStatusCheckListener(onStatusCheck)
    }

    getGroupedTags(): Map<string, string[]> {
        return this.tagInputs.getGroupedTags()
    }

    insertGroupedTags(groupToTags: Map<string, string[]>) {
        this.tagInputs.insertGroupedTags(groupToTags)
    }

    displayPixivTags(pixivTags: { [key in string]: string }) {
        this.pixivTagsContainer.innerHTML = ""
        for (const tagName in pixivTags) {
            const translatedTag = pixivTags[tagName]
            const tagWrapper = E("span", { class: "pixiv-tag-wrapper" }, [
                E("span", { class: "pixiv-tag" }, tagName),
            ])
            if (tagName === "Original")
                tagWrapper.style.fontWeight = "bold"
            if (translatedTag) {
                tagWrapper.appendChild(
                    E("span", { class: "translated-pixiv-tag" }, translatedTag))
            }
            this.pixivTagsContainer.appendChild(tagWrapper)
        }
    }

    clearPixivTags() {
        this.pixivTagsContainer.innerHTML = ""
    }

    isEmpty() {
        return !this.fileUpload.getFile() && !this.tagInputs.getTags().length
    }
}