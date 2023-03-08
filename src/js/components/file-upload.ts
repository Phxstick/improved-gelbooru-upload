import browser from "webextension-polyfill";
import { Md5 } from "ts-md5";
import { E } from "js/utility";
import { BooruApi, HostName, StatusUpdate, Message } from "js/types";
import "./file-upload.scss";

export type FileUploadCallback = (objectUrl: string) => void
export type StatusCheckCallback = (matchIds: number[]) => void

export interface CheckResult {
    posts?: { [key in HostName]?: { id: number }[] }
    error?: string
}

export interface FileUpload {
    getElement: () => HTMLElement
    getFile: () => File | undefined
    getUrl: () => string
    getPixivId: () => string
    reset: () => void
    foundMd5Match: () => boolean
    getLargeImagePreview: () => HTMLElement
    handleDropData: (dataTransfer: DataTransfer) => Promise<CheckResult>,
    addFileUploadListener: (callback: FileUploadCallback) => void,
    addStatusCheckListener: (callback: StatusCheckCallback) => void
}

export default function createImageUpload(sourceInput: HTMLInputElement, api: BooruApi): FileUpload {
    let foundMd5Match = false
    let loadedUrl = ""
    let loadedPixivId = ""
    let objectUrl = ""
    let onCheckedResolve: (value: CheckResult) => void = () => {}
    const uploadListeners: FileUploadCallback[] = []
    const statusCheckListeners: StatusCheckCallback[] = []

    // Create hidden file input with a label for custom styling
    const fileInput = E("input", {
        type: "file", accept: "image/*", id: "file-input", class: "hidden" }) as HTMLInputElement
    const fileInputLabel = E("label", {
        class: "file-input-label",
        for: "file-input"
    })
    const hiddenInput = E("input", { class: "hidden-input", tabindex: "-1" })

    // Create field that can be focussed for pasting images from clipboard
    const pasteFileField = E("div", { class: "paste-file-field", tabindex: "0" }, [
        hiddenInput,
        E("i", { class: "paste icon"}),
        E("div", { class: "paste-message" }, "Press Ctrl+V to paste image"),
        E("div", { class: "paste-error-message failure" }, "Clipboard contains no image!")
    ])
    const fileInputWrapper = E("div", { class: "file-input-wrapper styled-input" }, [
        fileInputLabel,
        pasteFileField
    ])

    // Redirect focus from wrapper to hidden input (to catch paste event)
    pasteFileField.addEventListener("focus", (event) => {
        event.preventDefault()
        hiddenInput.focus()
    })
    hiddenInput.addEventListener("focusout", () => {
        pasteFileField.classList.remove("show-paste-error")
    })

    // Press Ctrl + V to paste image (show error if there's none)
    hiddenInput.addEventListener("paste", (event) => {
        event.preventDefault()
        const containsFile = event.clipboardData &&
            event.clipboardData.files.length === 1 &&
            event.clipboardData.files.item(0)!.type.startsWith("image")
        if (!containsFile) {
            pasteFileField.classList.add("show-paste-error")
            return
        }
        hiddenInput.blur()
        fileInput.files = event.clipboardData.files
        fileInput.dispatchEvent(new Event("change"))
    })

    // Create error messages
    const noFileErrorMessage = E("div", { class: "failure hidden no-file-error-message" },
        "The dropped data does not contain an image. If you drag an image from " +
        "a web page, make sure that it has fully loaded first.")
    const settingsUrl = api.getSettingsUrl()
    const accountSettingsLink = `<a target="_blank" href='${settingsUrl}'>account settings</a>`
    const extensionSettingsLink = `<a class="extension-settings-link">extension settings</a>`
    const noApiInfoSetMessage = E("div", { class: "info hidden no-api-info-message" },
        "Cannot perform MD5 check or source check because the user ID and/or API key " +
        `are not provided. You can find those values in your ${accountSettingsLink} ` +
        `and enter them in the ${extensionSettingsLink} to enable these checks.`)
    noApiInfoSetMessage.querySelector(".extension-settings-link")!
        .addEventListener("click", () => browser.runtime.sendMessage({
            type: Message.OpenExtensionOptions
        }))

    // Make it possible to drag&drop pictures (esp. from other webpages like Pixiv)
    fileInputWrapper.addEventListener("dragover", (event) => {
        event.preventDefault()
    })
    const handleDropData = (dataTransfer: DataTransfer): Promise<CheckResult> => {
        const url = dataTransfer.getData("text/uri-list")
        loadedUrl = url
        if (url) {
            const urlParts = new URL(url)
            // Automatically fill in source URL if the given image is from pixiv
            if (urlParts.hostname === "i.pximg.net") {
                if (api.host === HostName.Danbooru) {
                    sourceInput.value = url  // Danbooru wants the direct image URL
                } else {
                    const pathParts = urlParts.pathname.split("/")
                    const filename = pathParts[pathParts.length - 1]
                    const pixivId = filename.split("_")[0]
                    sourceInput.value = `https://www.pixiv.net/artworks/${pixivId}`
                }
            }
        }
        // Set input file to dragged one and trigger listeners of change event
        fileInput.files = dataTransfer.files
        return new Promise((resolve) => {
            fileInput.dispatchEvent(new Event("change"))
            onCheckedResolve = resolve
        })
    }
    fileInputWrapper.addEventListener("drop", (event) => {
        event.preventDefault()
        fileInputWrapper.classList.remove("dragover")
        if (!event.dataTransfer) return
        handleDropData(event.dataTransfer)
    })
    // Highlight label when dragging something above it
    fileInputLabel.addEventListener("dragenter", () => {
        fileInputWrapper.classList.add("dragover")
    })
    fileInputLabel.addEventListener("dragleave", () => {
        fileInputWrapper.classList.remove("dragover")
    })

    // Create elements for MD5 check
    const noHashMatchesMessage = E("div", { class: "success hidden" }, "Found no MD5 hash matches ✔")
    const hashCheckErrorMessage = E("div", { class: "failure hidden" })
    const hashMatchesContainer = E("div", { class: "hash-matches" })
    const hashMatchesWrapper = E("div", { class: "hash-matches-wrapper hidden" }, [
        E("div", { class: "failure" }, "Found post with identical MD5 hash:"),
        hashMatchesContainer
    ])

    // Create elements for source check
    const searchingBySourceMessage = E("div", { class: "hidden" }, "Searching by image source...")
    const sourceMatchesContainer = E("div", { class: "source-matches" })
    const sourceMatchesHeader = E("div")
    const sourceMatchesWrapper = E("div", { class: "source-matches-wrapper hidden" }, [
        searchingBySourceMessage,
        sourceMatchesHeader,
        sourceMatchesContainer
    ])

    // Create elements for IQDB search
    const startIqdbSearch = E("button", { class: "search-iqdb-button styled-button hidden" }, "Search IQDB")
    startIqdbSearch.addEventListener("click", async (event) => {
        if (!fileInput.files) return
        performIqdbSearch(fileInput.files[0])
    })
    const searchingIqdbMessage = E("div", { class: "hidden" }, "Searching IQDB...")
    const iqdbMatchesContainer = E("div", { class: "iqdb-matches" })
    const iqdbMatchesHeader = E("div")
    const iqdbMatchesWrapper = E("div", { class: "iqdb-matches-wrapper hidden" }, [
        searchingIqdbMessage,
        iqdbMatchesHeader,
        iqdbMatchesContainer
    ])

    // Put all the image checks in a wrapper together with the small image preview
    const imageChecksContainer = E("div", { class: "image-checks" }, [
        noApiInfoSetMessage,
        noHashMatchesMessage,
        hashCheckErrorMessage,
        hashMatchesWrapper,
        sourceMatchesWrapper,
        startIqdbSearch,
        iqdbMatchesWrapper
    ])
    const imagePreviewSmall = E("img", { class: "medium preview hidden" }) as HTMLImageElement
    const imagePreviewLarge = E("img", { class: "large preview hidden" }) as HTMLImageElement
    const imageInfoContainer = E("div", { class: "image-info" }, [
        imagePreviewSmall,
        imageChecksContainer
    ])

    const emitStatusUpdate = (postIds: number[]) => {
        statusCheckListeners.forEach(listener => listener(postIds))
        const postIdStrings = postIds.map(id => id.toString())
        const data: CheckResult = {
            posts: {
                [api.host]: postIdStrings
            }
        }
        onCheckedResolve(data)
        if (!loadedPixivId) return
        const statusUpdate: StatusUpdate = {
            host: api.host,
            pixivId: loadedPixivId,
            filename: fileInput.files![0].name,
            postIds
        }
        browser.runtime.sendMessage({
            type: Message.NotifyAssociatedExtensions,
            args: statusUpdate
        })
    }

    const performMd5Search = async (arrayBuffer: ArrayBuffer) => {
        const md5 = new Md5()
        md5.appendByteArray(new Uint8Array(arrayBuffer))
        const md5hash = md5.end()
        const md5response = await api.searchPosts(["md5:" + md5hash])

        // Display result of MD5 check
        noHashMatchesMessage.classList.toggle("hidden", md5response.length > 0)
        hashMatchesWrapper.classList.toggle("hidden", md5response.length === 0)
        if (md5response.length > 0) {
            foundMd5Match = true
            hashMatchesContainer.innerHTML = ""
            const postIds = md5response.map(post => post.id)
            for (const postId of postIds) {
                const href = api.getPostUrl(postId)
                const link = E("a", { href, target: "_blank" }, postId.toString())
                hashMatchesContainer.appendChild(link)
            }
            emitStatusUpdate(postIds)
            return true
        }
        return false
    }
    
    const performSourceSearch = async (pixivId: string): Promise<boolean> => {
        sourceMatchesContainer.classList.add("hidden")
        sourceMatchesHeader.classList.add("hidden")
        sourceMatchesWrapper.classList.remove("hidden")

        // Perform search (try searching for both "pixiv" and "pximg")
        searchingBySourceMessage.textContent = `Searching for posts with Pixiv ID ${pixivId}...`
        searchingBySourceMessage.classList.remove("hidden")
        let sourceQuery = `source:*pixiv*${pixivId}*`
        let response = await api.searchPosts([sourceQuery])
        if (response.length === 0) {
            sourceQuery = `source:*pximg*${pixivId}*`
            response = await api.searchPosts([`source:*pximg*${pixivId}*`])
        }
        searchingBySourceMessage.classList.add("hidden")

        // Display search result
        sourceMatchesHeader.classList.toggle("success", response.length === 0)
        sourceMatchesHeader.classList.toggle("failure", response.length > 0)
        sourceMatchesHeader.classList.remove("hidden")
        if (response.length === 0) {
            sourceMatchesHeader.innerHTML = `Found no posts matching Pixiv ID ${pixivId} ✔`
            return false
        }
        const postInflection = response.length === 1 ? "post" : "posts"
        const postsLink = response.length === 1 ?
            api.getPostUrl(response[0].id) : api.getQueryUrl([sourceQuery])
        sourceMatchesHeader.innerHTML = `Found <a target="_blank" href="${postsLink}">`
            + `${response.length} ${postInflection}</a> matching Pixiv ID ${pixivId}`
        
        // List matching posts
        sourceMatchesContainer.innerHTML = ""
        for (const post of response) {
            const href = api.getPostUrl(post.id)
            const postElement = E("a", { class: "booru-post", href, target: "_blank" }, [
                E("img", { class: "small preview", src: post.thumbnailUrl })
            ])
            sourceMatchesContainer.appendChild(postElement)
        }
        sourceMatchesContainer.classList.remove("hidden")
        emitStatusUpdate(response.map(post => post.id))
        return true
    }

    async function performIqdbSearch(file: File) {
        startIqdbSearch.classList.add("hidden")
        // Hide source matches to make space for IQDB matches
        sourceMatchesContainer.classList.add("hidden")

        searchingIqdbMessage.textContent = `Performing reverse image search in IQDB...`
        searchingIqdbMessage.classList.remove("hidden")
        iqdbMatchesContainer.classList.add("hidden")
        iqdbMatchesHeader.classList.add("hidden")
        iqdbMatchesWrapper.classList.remove("hidden")

        const searchResult = await api.searchIqdb({
            host: api.host,
            fileUrl: objectUrl,
            filename: file.name
        })
        searchingIqdbMessage.classList.add("hidden")
        iqdbMatchesHeader.classList.remove("hidden")

        if (!searchResult.success) {
            iqdbMatchesHeader.classList.add("failure")
            iqdbMatchesHeader.textContent = searchResult.error
            onCheckedResolve({ error: searchResult.error })
            return
        }
        const matches = searchResult.matches

        // Display search result
        iqdbMatchesHeader.classList.toggle("success", matches.length === 0)
        iqdbMatchesHeader.classList.toggle("failure", matches.length > 0)
        if (matches.length === 0) {
            iqdbMatchesHeader.innerHTML = `Found no similar images in IQDB ✔`
            emitStatusUpdate([])
            return
        }
        const post_s = matches.length === 1 ? "post" : "posts"
        const image_s = matches.length === 1 ? "image" : "images"
        const a = matches.length === 1 ? "a " : ""
        iqdbMatchesHeader.innerHTML =
            `Found ${matches.length} ${post_s} with ${a} similar ${image_s}:`

        // Show thumbnails of found matches
        iqdbMatchesContainer.innerHTML = ""
        for (const match of matches) {
            const postElement = E("a", { class: "booru-post", href: match.postUrl, target: "_blank" }, [
                E("img", { class: "small preview", src: match.thumbnailUrl })
            ])
            iqdbMatchesContainer.appendChild(postElement)
        }
        iqdbMatchesContainer.classList.remove("hidden")

        // Announce check result
        emitStatusUpdate(matches.map(m => m.postId))
    }

    async function runChecks(file: File) {
        foundMd5Match = false

        noHashMatchesMessage.classList.add("hidden")
        hashCheckErrorMessage.classList.add("hidden")
        hashMatchesWrapper.classList.add("hidden")
        sourceMatchesWrapper.classList.add("hidden")
        iqdbMatchesWrapper.classList.add("hidden")
        startIqdbSearch.classList.add("hidden")
        imageInfoContainer.classList.remove("hidden")

        if (api.isAuthenticated()) {
            // Calculate MD5 and check if it already exists
            const arrayBuffer = await file.arrayBuffer()
            let foundMatch
            try {
                foundMatch = await performMd5Search(arrayBuffer)
            } catch {
                const error = "MD5 hash check failed."
                hashCheckErrorMessage.classList.remove("hidden")
                hashCheckErrorMessage.innerHTML = error
                onCheckedResolve({ error })
                return
            }

            // MD5 hash check is sufficiently precise, no need to do more checks if a match has been found
            // (false positives are theoretically possible but highly unlikely, so not worth handling)
            if (foundMatch) return

            // Do a source check using the pixiv ID if available
            if (loadedPixivId) {
                const foundMatches = await performSourceSearch(loadedPixivId)
                if (foundMatches) {
                    // If source search found matches, IQDB search may not be necessary,
                    // so just display a button to let user manually start search if needed
                    startIqdbSearch.classList.remove("hidden")
                    return
                }
            }
        } else {
            noApiInfoSetMessage.classList.remove("hidden")
        }

        // Search IQDB if other searches didn't yield results
        performIqdbSearch(file)
    }

    fileInput.addEventListener("change", async () => {
        if (!fileInput.files || !fileInput.files.length) {
            noFileErrorMessage.classList.remove("hidden")
            return
        }
        const file = fileInput.files[0]
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = URL.createObjectURL(file)

        // Set label to name of dragged file and show image preview
        fileInputLabel.textContent = file.name
        fileInputLabel.classList.remove("placeholder")
        noFileErrorMessage.classList.add("hidden")
        imagePreviewSmall.src = objectUrl
        imagePreviewLarge.src = objectUrl
        imagePreviewSmall.classList.remove("hidden")
        imagePreviewLarge.classList.remove("hidden")

        // If given filename uses the Pixiv pattern, extract and remember the ID
        const pixivRegex = /(\d+)_p\d+/
        const pixivMatch = file.name.match(pixivRegex)
        loadedPixivId = pixivMatch !== null ? pixivMatch[1] : ""

        uploadListeners.forEach(listener => listener(objectUrl))
        runChecks(file)
    })

    const resetFunction = () => {
        fileInput.value = ""
        loadedUrl = ""
        loadedPixivId = ""
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = ""
        imageInfoContainer.classList.add("hidden")
        imagePreviewSmall.removeAttribute("src")
        imagePreviewLarge.removeAttribute("src")
        fileInputLabel.classList.add("placeholder")
        fileInputLabel.textContent = "Drag image here or click to select file"
    }
    resetFunction()

    const wrapper = E("div", {}, [
        fileInputWrapper,
        noFileErrorMessage,
        fileInput,
        imageInfoContainer
    ])

    return {
        getElement: () => wrapper,
        getFile: () => fileInput.files ? fileInput.files[0] : undefined,
        reset: resetFunction,
        foundMd5Match: () => foundMd5Match,
        getLargeImagePreview: () => imagePreviewLarge,
        getUrl: () => loadedUrl,
        getPixivId: () => loadedPixivId,
        handleDropData,
        addFileUploadListener: (listener) => uploadListeners.push(listener),
        addStatusCheckListener: (listener) => statusCheckListeners.push(listener)
    }
}
