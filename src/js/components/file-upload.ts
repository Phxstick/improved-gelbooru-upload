import browser from "webextension-polyfill";
import { Md5 } from "ts-md5";
import { E, showInfoModal } from "js/utility";
import { BooruApi, BooruPost, HostName, StatusUpdate, Message } from "js/types";
import "./file-upload.scss";

export type FileUploadCallback = (objectUrl: string) => void
export type CheckResultCallback = (matchIds: number[] | undefined) => void
export type CheckStartCallback = (checkType: CheckType) => void

export enum CheckType {
    md5hash = "md5hash",
    source = "source",
    iqdb = "iqdb"
}

export interface CheckResult {
    postIds?: number[]
    posts?: { [key in number]: BooruPost }
    error?: string
}

interface ImageInfo {
    fileName: string
    fileType: string
    url: string
}

export interface FileUpload {
    getElement: () => HTMLElement
    getFile: () => File | undefined
    getUrl: () => string
    setUrl: (url: string) => void
    getPixivId: () => string
    reset: () => void
    foundMd5Match: () => boolean
    getLargeImagePreview: () => HTMLElement
    handleDropData: (dataTransfer: DataTransfer) => Promise<CheckResult>,
    addFileUploadListener: (callback: FileUploadCallback) => void,
    addCheckStartListener: (callback: CheckStartCallback) => void,
    addCheckResultListener: (callback: CheckResultCallback) => void
}

export default function createImageUpload(sourceInput: HTMLInputElement, api: BooruApi): FileUpload {
    let foundMd5Match = false
    let loadedUrl = ""
    let loadedPixivId = ""
    let objectUrl = ""
    let onCheckedResolve: (value: CheckResult) => void = () => {}
    const uploadListeners: FileUploadCallback[] = []
    const checkStartListeners: CheckStartCallback[] = []
    const checkResultListeners: CheckResultCallback[] = []

    // Create hidden file input with a label for custom styling
    const fileInput = E("input", {
        type: "file", accept: "image/*", id: "file-input", class: "hidden" }) as HTMLInputElement
    const fileInputLabel = E("label", {
        class: "file-input-label",
        for: "file-input"
    })
    const hiddenInput = E("input", { class: "hidden-input", tabindex: "-1" })

    // Create field that can be focussed for pasting an image URL
    const pasteArea = E("div", { class: "paste-field", tabindex: "0" }, [
        hiddenInput,
        E("i", { class: "paste icon"}),
        E("div", { class: "paste-info status-message" },
            "Press Ctrl+V to paste image URL"),
        E("div", { class: "paste-error status-message failure" },
            "Clipboard contains no image URL"),
        E("div", { class: "downloading status-message" },
            "Downloading image..."),
        E("div", { class: "download-error status-message failure" },
            "Failed to download image")
    ])
    const fileInputWrapper = E("div", { class: "file-input-wrapper styled-input" }, [
        fileInputLabel,
        pasteArea
    ])

    let downloading = false
    // Redirect focus from wrapper to hidden input (to catch paste event)
    pasteArea.addEventListener("focus", (event) => {
        if (downloading) return
        pasteArea.classList.remove("show-message", "download-error")
        event.preventDefault()
        hiddenInput.focus()
    })
    hiddenInput.addEventListener("focusout", () => {
        pasteArea.classList.remove("show-message", "paste-error")
    })

    function getImageInfo(event: ClipboardEvent): ImageInfo | undefined {
        if (!event.clipboardData) return
        let url = event.clipboardData.getData("text/plain")
        if (!url) return
        let parsedUrl: URL
        try {
            parsedUrl = new URL(url)
        } catch (e) { return }
        const pathParts = parsedUrl.pathname.split("/")
        let fileName = pathParts[pathParts.length - 1]
        const fileTypeRegex = /\.(png|jpg|jpeg)$/
        const fileTypeMatch = fileName.match(fileTypeRegex)
        let fileType: string
        if (parsedUrl.hostname === "pbs.twimg.com") {
            const format = parsedUrl.searchParams.get("format")
            if (!format) return
            fileType = format
            fileName += "." + fileType
            parsedUrl.searchParams.set("name", "orig")
            url = parsedUrl.toString()
        } else if (fileTypeMatch) {
            fileType = fileTypeMatch[1]
        } else {
            return
        }
        return { fileName, fileType, url }
    }

    async function downloadImage(url: string): Promise<Blob | undefined> {
        const parsedUrl = new URL(url)
        let finalUrl = url
        // If the image is from Pixiv, let the Pixiv extension download it
        if (parsedUrl.hostname === "i.pximg.net") {
            try {
                const { dataUrl } = await browser.runtime.sendMessage({
                    type: Message.DownloadPixivImage,
                    args: { url }
                })
                if (!dataUrl) return
                finalUrl = dataUrl
            } catch (e) {
                showInfoModal(
                    "Cannot directly download from Pixiv.<br>" +
                    "This requires the browser extension<br>" +
                    "<b>Pixiv to Gelbooru upload helper</b>")
                return
            }
        }
        try {
            const response = await fetch(finalUrl)
            if (!response.ok) return
            return await response.blob()
        } catch (error) {
            return
        }
    }

    // Press Ctrl + V to paste
    hiddenInput.addEventListener("paste", async (event) => {
        event.preventDefault()
        if (downloading) return
        pasteArea.classList.remove("download-error")

        // Check if a valid image URL has been pasted
        const imageInfo = getImageInfo(event)
        if (!imageInfo) {
            pasteArea.classList.add("show-message", "paste-error")
            return
        }
        const { fileName, fileType, url } = imageInfo
        hiddenInput.blur()

        // Download the image
        downloading = true
        fileInput.disabled = true
        fileInputWrapper.classList.add("disabled")
        pasteArea.classList.add("show-message", "downloading")
        const blob = await downloadImage(url)
        pasteArea.classList.remove("downloading")
        fileInputWrapper.classList.remove("disabled")
        fileInput.disabled = false
        downloading = false
        if (!blob) {
            pasteArea.classList.add("show-message", "download-error")
            return
        }
        pasteArea.classList.remove("show-message")

        // Update file input and run event handlers
        const file = new File([blob], fileName, { type: `image/${fileType}`})
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        fileInput.files = dataTransfer.files
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
        if (downloading) return
        fileInputWrapper.classList.add("dragover")
    })
    fileInputLabel.addEventListener("dragleave", () => {
        fileInputWrapper.classList.remove("dragover")
    })
    fileInputLabel.addEventListener("click", (event) => {
        if (downloading) event.preventDefault()
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

    const emitStatusUpdate = (postIds: number[], postsList?: BooruPost[]) => {
        checkResultListeners.forEach(listener => listener(postIds))
        const posts: { [key in number]: BooruPost } = {}
        if (postsList) postsList.forEach(post => { posts[post.id] = post })
        onCheckedResolve({ postIds, posts })
        if (!loadedPixivId) return
        const statusUpdate: StatusUpdate = {
            host: api.host,
            pixivId: loadedPixivId,
            filename: fileInput.files![0].name,
            postIds,
            posts
        }
        browser.runtime.sendMessage({
            type: Message.NotifyAssociatedExtensions,
            args: statusUpdate
        })
    }

    const performMd5Search = async (file: File) => {
        checkStartListeners.forEach(listener => listener(CheckType.md5hash))
        const arrayBuffer = await file.arrayBuffer()
        const md5 = new Md5()
        md5.appendByteArray(new Uint8Array(arrayBuffer))
        const md5hash = md5.end()
        const posts = await api.searchPosts(["md5:" + md5hash])

        // Display result of MD5 check
        noHashMatchesMessage.classList.toggle("hidden", posts.length > 0)
        hashMatchesWrapper.classList.toggle("hidden", posts.length === 0)
        if (posts.length > 0) {
            foundMd5Match = true
            hashMatchesContainer.innerHTML = ""
            for (const post of posts) {
                const href = api.getPostUrl(post.id)
                const link = E("a", { href, target: "_blank" }, post.id.toString())
                hashMatchesContainer.appendChild(link)
            }
            const postIds = posts.map(post => post.id)
            emitStatusUpdate(postIds, posts)
            return true
        }
        return false
    }
    
    const performSourceSearch = async (pixivId: string): Promise<boolean> => {
        checkStartListeners.forEach(listener => listener(CheckType.source))
        sourceMatchesContainer.classList.add("hidden")
        sourceMatchesHeader.classList.add("hidden")
        sourceMatchesWrapper.classList.remove("hidden")

        // Perform search (try searching for both "pixiv" and "pximg")
        searchingBySourceMessage.textContent = `Searching for posts with Pixiv ID ${pixivId}...`
        searchingBySourceMessage.classList.remove("hidden")
        let sourceQuery = `source:*pixiv*${pixivId}*`
        let posts = await api.searchPosts([sourceQuery])
        if (posts.length === 0) {
            sourceQuery = `source:*pximg*${pixivId}*`
            posts = await api.searchPosts([`source:*pximg*${pixivId}*`])
        }
        searchingBySourceMessage.classList.add("hidden")

        // Display search result
        sourceMatchesHeader.classList.toggle("success", posts.length === 0)
        sourceMatchesHeader.classList.toggle("failure", posts.length > 0)
        sourceMatchesHeader.classList.remove("hidden")
        if (posts.length === 0) {
            sourceMatchesHeader.innerHTML = `Found no posts matching Pixiv ID ${pixivId} ✔`
            return false
        }
        const postInflection = posts.length === 1 ? "post" : "posts"
        const postsLink = posts.length === 1 ?
            api.getPostUrl(posts[0].id) : api.getQueryUrl([sourceQuery])
        sourceMatchesHeader.innerHTML = `Found <a target="_blank" href="${postsLink}">`
            + `${posts.length} ${postInflection}</a> matching Pixiv ID ${pixivId}`
        
        // List matching posts
        sourceMatchesContainer.innerHTML = ""
        for (const post of posts) {
            const href = api.getPostUrl(post.id)
            const postElement = E("a", { class: "booru-post", href, target: "_blank" }, [
                E("img", { class: "small preview", src: post.thumbnailUrl })
            ])
            sourceMatchesContainer.appendChild(postElement)
        }
        sourceMatchesContainer.classList.remove("hidden")
        const postIds = posts.map(post => post.id)
        emitStatusUpdate(postIds, posts)
        return true
    }

    async function shrinkImage(file: File, factor: number): Promise<File> {
        return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => {
                const canvas = document.createElement("canvas")
                canvas.width = img.width * factor
                canvas.height = img.height * factor
                console.log(`Original image dimensions: ${img.width} x ${img.height}`)
                console.log(`----------------------------------`)
                console.log(`New image dimensions: ${canvas.width} x ${canvas.height}`)
                const ctx = canvas.getContext("2d")
                if (!ctx) {
                    reject()
                    return
                }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                canvas.toBlob(blob => {
                    if (!blob) { reject(); return }
                    resolve(new File([blob], file.name, { type: blob.type }))
                }, file.type)
            }
            img.src = objectUrl
        })
    }

    async function shrinkImageFile(file: File, maxSize: number): Promise<File> {
        const originalSize = file.size
        const origSizeMiB = (originalSize / (1024 ** 2)).toFixed(2)
        console.log(`Original image: ${file.type}, ${origSizeMiB} MiB`)
        let factor = 1
        do {
            factor -= 0.1
            file = await shrinkImage(file, factor)
            const shrunkSize = file.size
            const shrunkSizeMiB = (file.size / (1024 ** 2)).toFixed(2)
            const shrinkPercentage = ((factor * factor) * 100).toFixed()
            const factorString = factor.toFixed(1)
            console.log(`Shrink percentage: ${shrinkPercentage}% (factor ${factorString})`)
            console.log(`Resized image: ${file.type}, ${shrunkSizeMiB} MiB`)
            const percentage = ((1 - (shrunkSize / originalSize)) * 100).toFixed()
            console.log(`Size reduction: ${percentage}%`)
        } while (file.size > maxSize)
        return file
    }

    async function performIqdbSearch(file: File) {
        checkStartListeners.forEach(listener => listener(CheckType.iqdb))
        startIqdbSearch.classList.add("hidden")
        // Hide source matches to make space for IQDB matches
        sourceMatchesContainer.classList.add("hidden")

        searchingIqdbMessage.textContent = `Performing reverse image search in IQDB...`
        searchingIqdbMessage.classList.remove("hidden")
        iqdbMatchesContainer.classList.add("hidden")
        iqdbMatchesHeader.classList.add("hidden")
        iqdbMatchesWrapper.classList.remove("hidden")

        // Shrink the image if it's too large for IQDB
        const maxSize = 8192 * 1024
        let fileUrl = objectUrl
        if (file.size > maxSize) {
            file = await shrinkImageFile(file, maxSize)
            fileUrl = URL.createObjectURL(file)
            console.log("Shrunk image URL:", fileUrl)
        }

        const searchResult = await api.searchIqdb({
            host: api.host,
            fileUrl,
            filename: file.name
        })
        //// if (fileUrl !== objectUrl) URL.revokeObjectURL(fileUrl)
        searchingIqdbMessage.classList.add("hidden")
        iqdbMatchesHeader.classList.remove("hidden")

        if (!searchResult.success) {
            iqdbMatchesHeader.classList.add("failure")
            iqdbMatchesHeader.textContent = searchResult.error
            onCheckedResolve({ error: searchResult.error })
            checkResultListeners.forEach(listener => listener(undefined))
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
        const postIds = matches.map(match => match.postId)
        let posts: BooruPost[] | undefined
        try {
            posts = await Promise.all(postIds.map(id => api.getPostInfo(id)))
        } catch (error) {}
        emitStatusUpdate(postIds, posts)
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
            let foundMatch
            try {
                foundMatch = await performMd5Search(file)
            } catch {
                const error = "MD5 hash check failed."
                hashCheckErrorMessage.classList.remove("hidden")
                hashCheckErrorMessage.innerHTML = error
                onCheckedResolve({ error })
                checkResultListeners.forEach(listener => listener(undefined))
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
        setUrl: (url: string) => { loadedUrl = url },
        getPixivId: () => loadedPixivId,
        handleDropData,
        addFileUploadListener: (listener) => uploadListeners.push(listener),
        addCheckStartListener: (listener) => checkStartListeners.push(listener),
        addCheckResultListener: (listener) => checkResultListeners.push(listener)
    }
}
