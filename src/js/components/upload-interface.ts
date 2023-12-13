import createImageUpload, { FileUpload, CheckResult, FileUploadCallback, CheckResultCallback, CheckStartCallback } from "js/components/file-upload";
import TagInputs from "js/components/tag-inputs";
import ArtistSearch from "js/components/artist-search"
import WikiModal from "js/components/wiki-modal"
import RadioButtons from "js/generic/radiobuttons"
import Component from "js/generic/component"
import { Settings, BooruApi, UploadData, EnhancedTags } from "js/types"
import { E } from "js/utility"

export default class UploadInterface extends Component {
    private sourceInput: HTMLInputElement
    private fileUpload: FileUpload
    private titleInput: HTMLInputElement
    private tagInputs: TagInputs
    private artistSearch: ArtistSearch
    private ratingSelection: RadioButtons
    private pixivTagsContainer: HTMLElement

    private static id = 0

    constructor(api: BooruApi, wikiModal: WikiModal, settings: Settings) {
        super()
        UploadInterface.id++

        const { autoSelectFirstCompletion, tagGroups, hideTitleInput,
                separateTagsWithSpace, splitTagInputIntoGroups,
                minimumPostCount, searchDelay } = settings
        const tagGroupsList = splitTagInputIntoGroups ? tagGroups : ["Tags"]

        // Create main components
        this.sourceInput = E("input", { class: "styled-input source-input" }) as HTMLInputElement
        this.fileUpload = createImageUpload(this.sourceInput, api)
        this.titleInput = E("input", { class: "styled-input title-input"}) as HTMLInputElement
        this.pixivTagsContainer = E("div", { class: "pixiv-tags" })
        this.tagInputs = new TagInputs(tagGroupsList, api, wikiModal, {
            selectFirstResult: autoSelectFirstCompletion,
            postCountThreshold: minimumPostCount,
            separateTagsWithSpace,
            searchDelay
        })
        this.artistSearch = new ArtistSearch(
            this.tagInputs.getFirst(), this.fileUpload, api)
        this.ratingSelection = new RadioButtons({
            // Name needs to be different across instances, otherwise all radiobuttons
            // will be associated with each other and only one will be globally active
            name: "rating" + UploadInterface.id.toString(),
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
            return "You haven't added an image."
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

    getData(): UploadData {
        return {
            file: this.fileUpload.getFile()!,
            title: this.titleInput.value.trim(),
            source: this.sourceInput.value.trim(),
            tags: this.tagInputs.getTags(),
            rating: this.ratingSelection.getValue(),
            pixivId: this.fileUpload.getPixivId()
        }
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

    insertData(data: Partial<UploadData>) {
        if (data.title) {
            this.titleInput.value = data.title
        }
        if (data.source) {
            this.sourceInput.value = data.source
        }
        if (data.rating) {
            this.ratingSelection.setValue(data.rating)
        }
    }

    getLargeImagePreview(): HTMLElement {
        return this.fileUpload.getLargeImagePreview()
    }

    passDroppedFile(dropData: DataTransfer): Promise<CheckResult> {
        return this.fileUpload.handleDropData(dropData)
    }

    addFileUploadListener(onFileUpload: FileUploadCallback) {
        this.fileUpload.addFileUploadListener(onFileUpload)
    }

    addCheckResultListener(onCheckResult: CheckResultCallback) {
        this.fileUpload.addCheckResultListener(onCheckResult)
    }

    addCheckStartListener(onCheckStart: CheckStartCallback) {
        this.fileUpload.addCheckStartListener(onCheckStart)
    }

    getGroupedTags(): EnhancedTags {
        return this.tagInputs.getGroupedTags()
    }

    insertGroupedTags(tagData: EnhancedTags) {
        this.tagInputs.insertGroupedTags(tagData)
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

    copyTags(cut=false): boolean {
        return this.tagInputs.copyTags(undefined, cut)
    }

    getLastActiveInput() {
        return this.tagInputs.getLastActiveInput()
    }

    getFileUrl() {
        return this.fileUpload.getUrl()
    }

    setFileUrl(fileUrl: string) {
        this.fileUpload.setUrl(fileUrl)
    }

    containsTags() {
        return this.tagInputs.getTags().length > 0
    }

    isEmpty() {
        return !this.fileUpload.getFile() && !this.tagInputs.getTags().length
    }
}
