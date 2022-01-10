
import "fomantic-ui/dist/components/api.min.js"

import "fomantic-ui/dist/components/transition.min.js"
import "fomantic-ui/dist/components/transition.min.css"
import "fomantic-ui/dist/components/search.min.js"
import "fomantic-ui/dist/components/search.min.css"
import "fomantic-ui/dist/components/dropdown.min.js"
import "fomantic-ui/dist/components/dropdown.min.css"
import "fomantic-ui/dist/components/checkbox.min.js"
import "fomantic-ui/dist/components/checkbox.min.css"
import "fomantic-ui/dist/components/popup.min.js"
import "fomantic-ui/dist/components/popup.min.css"

import "fomantic-ui/dist/components/site.min.css"
import "fomantic-ui/dist/components/button.min.css"
import "fomantic-ui/dist/components/input.min.css"
import "fomantic-ui/dist/components/segment.min.css"
import "fomantic-ui/dist/components/icon.min.css"
import "fomantic-ui/dist/components/label.min.css"
import "fomantic-ui/dist/components/menu.min.css"

import "./gelbooru-upload.scss"

import createImageUpload from "js/components/file-upload";
import TagInputs from "js/components/tag-inputs";
import ArtistSearch from "js/components/artist-search"
import SettingsManager from "js/settings-manager"
import RadioButtons from "js/generic/radiobuttons"
import { E } from "js/utility"

// Import font here because it doesn't work with pure CSS in a content script
import browser from "webextension-polyfill";
const iconsFontUrl = browser.runtime.getURL("icons.woff2")
document.head.appendChild(E("style", {}, `
@font-face {
  font-family: CustomIcons;
  src: url(${iconsFontUrl})
}
`))

// Set custom title and delete original stylesheet (only use custom styles)
document.title = "Gelbooru upload"
document.head.querySelector("link[rel=stylesheet]")?.remove()

async function main() {
    // Get settings
    const { apiKey, userId, autoSelectFirstCompletion, tagGroups,
            showLargeImagePreview, hideTitleInput, separateTagsWithSpace,
            splitTagInputIntoGroups, minimumPostCount, searchDelay } =
        await SettingsManager.getAll()
    const tagGroupsList = splitTagInputIntoGroups ? tagGroups : ["Tags"]
    const apiCredentials = { apiKey, userId }

    // Create main components
    const sourceInput = E("input", { class: "styled-input source-input" }) as HTMLInputElement
    const fileUpload = createImageUpload(sourceInput, apiCredentials)
    const titleInput = E("input", { class: "styled-input title-input"}) as HTMLInputElement
    const tagInputs = new TagInputs(tagGroupsList, {
        selectFirstResult: autoSelectFirstCompletion,
        postCountThreshold: minimumPostCount,
        separateTagsWithSpace,
        searchDelay,
        apiCredentials
    })
    const artistSearch = new ArtistSearch(tagInputs.getFirst())
    const ratingSelection = new RadioButtons({
        name: "rating",
        values: ["e", "q", "s"],
        defaultValue: "e",
        labels: {
            "e": "Explicit",
            "q": "Questionable",
            "s": "Safe"
        },
        inline: true
    })

    // Create a status message for upload result or errors
    const uploadStatus = E("div", { class: "upload-status hidden" })

    // Create a button for submitting the data
    let uploading = false
    const uploadButton = E("button", { class: "styled-button upload-button" }, "Upload") as HTMLButtonElement
    uploadButton.addEventListener("click", async () => {
        uploadStatus.classList.remove("hidden")
        uploadStatus.classList.remove("success")
        uploadStatus.classList.add("failure")

        // Conduct a bunch of checks first to assure that all data is in place 
        const file = fileUpload.getFile()
        if (file === undefined) {
            uploadStatus.textContent = "You haven't uploaded an image."
            return
        }
        if (fileUpload.foundMd5Match()) {
            uploadStatus.textContent = "You can't upload an image that has already been uploaded."
            return
        }
        const tags = tagInputs.getTags()
        if (tags.length < 5) {
            uploadStatus.textContent = "You must add at least 5 tags."
            return
        }
        const source = sourceInput.value.trim()
        if (source.length === 0 && !tags.includes("source_request")) {
            uploadStatus.textContent = "You must specify a source or add the tag 'source_request'."
            return
        }

        uploadStatus.classList.remove("failure")
        uploadStatus.textContent = "Waiting for server response..."
        uploadButton.disabled = true
        uploading = true

        // Gather data in a form and submit it in a post request
        const formData = new FormData()
        formData.set("upload", file)
        formData.set("source", source)
        formData.set("title", titleInput.value.trim())
        formData.set("tags", tags.join(" "))
        formData.set("rating", ratingSelection.getValue())
        formData.set("submit", "Upload")  // Not sure if this is needed
        const response = await fetch("https://gelbooru.com/index.php?page=post&s=add", {
            method: "POST",
            body: formData
        })

        // Handle response (302 = successful upload, 200 = unsuccessful)
        uploadButton.disabled = false
        uploading = false
        if (response.redirected) {  // Can't read code 302 directly, check for redirection
            const urlParts = new URL(response.url)
            if (urlParts.searchParams.has("id")) {
                const postId = urlParts.searchParams.get("id")
                const postLink = `<a target="_blank" href="${response.url}">${postId}</a>`
                uploadStatus.innerHTML = "Upload successful! Created post with ID " + postLink
                uploadStatus.classList.add("success")
            } else {
                uploadStatus.textContent = "Unexpected server response."
                uploadStatus.classList.add("failure")
            }
        } else if (response.status === 200) {
            uploadStatus.textContent = "Upload failed. Please try again."
            uploadStatus.classList.add("failure")
        } else {
            uploadStatus.textContent = "Unexpected server response."
            uploadStatus.classList.add("failure")
        }
    })

    // Create a button to reset components for a new upload
    const resetButton = E("button", { class: "styled-button" }, "Clear")
    resetButton.addEventListener("click", () => {
        fileUpload.reset()
        sourceInput.value = ""
        titleInput.value = ""
        artistSearch.reset()
        tagInputs.clear()
        ratingSelection.reset()
        window.scrollTo(0, 0)
        mainWrapper.scrollTop = 0
        if (!uploading) uploadStatus.classList.add("hidden")
    })

    // Put buttons next to each other, upload status to the right
    const buttonContainer = E("div", { class: "buttons-container" }, [
        uploadButton,
        resetButton,
        uploadStatus
    ])

    // Put everything together and insert it into the page
    const makeRow = (header: string, content: HTMLElement, hidden=false) =>
        E("div", { class: "main-row" + (hidden ? " hidden" : "") }, [ 
            E("div", { class: "row-title" }, header), content
        ])
    const mainWrapper = E("div", { class: "main-wrapper" }, [
        makeRow("File", fileUpload.getElement()),
        makeRow("Source", sourceInput),
        makeRow("Title", titleInput, hideTitleInput),
        tagInputs.getContainer(),
        makeRow("Rating", ratingSelection.getElement()),
        buttonContainer
    ])
    const container = document.getElementById("container")!
    container.innerHTML = ""
    container.appendChild(mainWrapper)

    // Configure page to show large image preview on the right if flag is set
    if (showLargeImagePreview) {
        document.body.classList.add("large-image-preview-enabled")
        container.appendChild(fileUpload.getLargeImagePreview())
    }
}

// Completions div is not always done loading when page has loaded, wait a bit
window.setTimeout(() => main(), 0)