import createImageUpload, { FileUpload, CheckResult, FileUploadCallback, CheckResultCallback, CheckStartCallback } from "js/components/file-upload";
import TagInputs from "js/components/tag-inputs";
import ArtistSearch from "js/components/artist-search"
import WikiModal from "js/components/wiki-modal"
import RadioButtons from "js/generic/radiobuttons"
import Component from "js/generic/component"
import MultilineInput from "js/generic/multiline-input";
import { Settings, BooruApi, UploadData, EnhancedTags, UploadInstanceData, SourceTags, HostName, BasicUploadData } from "js/types"
import { E } from "js/utility"
import SourceHosts from "js/sources/source-hosts";

export default class UploadInterface extends Component {
    private api: BooruApi
    private sourceInput: HTMLInputElement
    private fileUpload: FileUpload
    private titleInput: HTMLInputElement
    private descriptionInput: MultilineInput
    private tagInputs: TagInputs
    private artistSearch: ArtistSearch
    private ratingSelection: RadioButtons
    private sourceTagsContainer: HTMLElement

    private static id = 0

    constructor(api: BooruApi, wikiModal: WikiModal, settings: Settings) {
        super()
        UploadInterface.id++
        this.api = api

        const { autoSelectFirstCompletion, tagGroups, hideTitleInput,
                separateTagsWithSpace, splitTagInputIntoGroups,
                minimumPostCount, searchDelay } = settings
        const tagGroupsList = splitTagInputIntoGroups ? tagGroups : ["Tags"]

        // Create main components
        this.sourceInput = E("input", { class: "styled-input source-input" }) as HTMLInputElement
        this.fileUpload = createImageUpload(this.sourceInput, api)
        this.titleInput = E("input", { class: "styled-input title-input"}) as HTMLInputElement
        this.descriptionInput = new MultilineInput()
        this.sourceTagsContainer = E("div", { class: "source-tags" })
        this.tagInputs = new TagInputs(tagGroupsList, api, wikiModal, {
            selectFirstResult: autoSelectFirstCompletion,
            postCountThreshold: minimumPostCount,
            separateTagsWithSpace,
            searchDelay
        })
        this.artistSearch = new ArtistSearch(
            this.tagInputs.getFirst(), this.fileUpload, () => this.sourceInput.value, api)
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
            this.makeRow("Title", this.titleInput,
                         hideTitleInput || api.host === HostName.Gelbooru),
            this.makeRow("Description", this.descriptionInput.getElement(),
                         hideTitleInput || api.host === HostName.Gelbooru),
            this.sourceTagsContainer,
            this.tagInputs.getContainer(),
            this.makeRow("Rating", this.ratingSelection.getElement()),
        ])
    }

    private makeRow(header: string, content: HTMLElement, hidden=false): HTMLElement {
        return E("div", { class: "main-row" + (hidden ? " hidden" : "") }, [ 
            E("div", { class: "row-title" }, header), content
        ])
    }

    isArtistTagAdded() {
        const { tagToType } = this.tagInputs.getGroupedTags()
        return this.artistSearch.wasArtistTagAdded() ||
            Object.values(tagToType).some(type => type === "artist") ||
            Object.keys(tagToType).includes("artist request")
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
        if ((this.titleInput.value.trim() || this.descriptionInput.getValue()) &&
                this.api.host === HostName.Danbooru && !this.api.isAuthenticated()) {
            return "Adding a title/description requires authentication."
        }
    }

    getData(): UploadData {
        return {
            file: this.fileUpload.getFile()!,
            title: this.api.host === HostName.Danbooru ?
                   this.titleInput.value.trim() : "",
            description: this.api.host === HostName.Danbooru ?
                         this.descriptionInput.getValue().trim() : "",
            source: this.sourceInput.value.trim(),
            tags: this.tagInputs.getTags(),
            rating: this.ratingSelection.getValue(),
            sourceInfo: this.fileUpload.getSourceInfo()
        }
    }

    getEnhancedData(): UploadInstanceData {
        const file = this.fileUpload.getFile()
        return {
            ...this.getData(),
            title: this.titleInput.value.trim(),
            description: this.descriptionInput.getValue().trim(),
            file: file ? {
                objectUrl: this.fileUpload.getObjectUrl(),
                name: file.name,
                type: file.type
            } : undefined,
            fileUrl: this.getFileUrl(),
            tags: this.getGroupedTags()
        }
    }

    reset() {
        this.fileUpload.reset()
        this.sourceInput.value = ""
        this.titleInput.value = ""
        this.descriptionInput.setValue("")
        this.artistSearch.reset()
        this.clearSourceTags()
        this.tagInputs.clear()
        this.ratingSelection.reset()
        this.root.scrollTop = 0
    }

    insertData(data: Partial<BasicUploadData>) {
        if (data.title) {
            this.titleInput.value = data.title
        }
        if (data.description) {
            this.descriptionInput.setValue(data.description)
        }
        if (data.source) {
            // Pass source info to file upload component if available
            const sourceInfo = SourceHosts.extractSourceInfo(data.source)
            if (sourceInfo) {
                this.fileUpload.setSourceInfo(sourceInfo)
            }
            // The correct source URL can depend on a combination of both source
            // host and target host, so attempt to derive it from the file URL
            // first instead of taking the given source URL directly
            this.sourceInput.value = (data.fileUrl && SourceHosts.getSourceUrl(data.fileUrl, this.api.host)) || data.source || ""
        }
        if (data.rating) {
            this.ratingSelection.setValue(data.rating)
        }
    }

    async insertEnhancedData(data: UploadInstanceData): Promise<CheckResult | undefined> {
        if (data.tags) {
            this.tagInputs.insertGroupedTags(data.tags, true)
        }
        let checkResult = this.fileUpload.getCheckResult()
        if (data.file) {
            const fileAlreadyLoaded = data.fileUrl && this.fileUpload.getFile()
                && data.fileUrl === this.fileUpload.getUrl()
            if (!fileAlreadyLoaded) {
                const { objectUrl, name, type } = data.file
                const blob = await fetch(objectUrl).then(r => r.blob())
                const fileObj = new File([blob], name, { type })
                checkResult = this.setFile(fileObj, data.fileUrl)
            } else if (checkResult) {
                const result = await checkResult
                if (result.error) {
                    checkResult = this.fileUpload.runChecks()
                }
            }
        }
        // NOTE: order is important, this must happen *after* setting the file or
        // else source info will get overridden by file upload handler (if given)
        this.insertData(data)
        if (data.sourceTags) {
            const sourceTags = data.sourceTags
            // Timeout is needed so that on-upload handler doesn't immediately clear tags again
            setTimeout(() => this.displaySourceTags(sourceTags), 0)
        }
        return checkResult
    }

    getLargeImagePreview(): HTMLElement {
        return this.fileUpload.getLargeImagePreview()
    }

    passDroppedFile(dropData: DataTransfer): Promise<CheckResult> {
        return this.fileUpload.handleDropData(dropData)
    }

    setFile(file: File, url?: string): Promise<CheckResult> {
        return this.fileUpload.setFile(file, url)
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

    displaySourceTags(sourceTags: SourceTags) {
        this.sourceTagsContainer.innerHTML = ""
        for (const tagName in sourceTags) {
            const translatedTag = sourceTags[tagName]
            const tagWrapper = E("span", { class: "source-tag-wrapper" }, [
                E("span", { class: "source-tag" }, tagName),
            ])
            if (tagName === "Original")
                tagWrapper.style.fontWeight = "bold"
            if (translatedTag) {
                tagWrapper.appendChild(
                    E("span", { class: "translated-source-tag" }, translatedTag))
            }
            this.sourceTagsContainer.appendChild(tagWrapper)
        }
    }

    clearSourceTags() {
        this.sourceTagsContainer.innerHTML = ""
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
