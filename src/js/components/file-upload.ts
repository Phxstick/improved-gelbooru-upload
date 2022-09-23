import browser from "webextension-polyfill";
import { Md5 } from "ts-md5/dist/md5"
import { E } from "js/utility"
import GelbooruApi from "js/gelbooru-api";
import "./file-upload.scss";

interface IqdbSearchResult {
    gelbooruUrl: string,
    thumbnailUrl: string,
    width: number,
    height: number,
    similarity: number
}

function parseIqdbSearchResults(doc: Document): IqdbSearchResult[] {
    const matches: IqdbSearchResult[] = []
    const pages = doc.querySelectorAll("#pages > div")
    if (pages.length === 0) {
        throw new Error("Search result is not valid.")
    }
    for (const page of pages) {
        const rows = page.querySelectorAll("tr")
        const head = rows[0].textContent!.trim().toLowerCase()
        if (head === "your image" || head === "no relevant matches") continue
        const link = rows[1].querySelector("a")!
        const image = link.querySelector("img")!
        let gelbooruUrl = link.getAttribute("href")!
        let thumbnailUrl = image.getAttribute("src")!
        if (gelbooruUrl[0] === "/" && gelbooruUrl[1] === "/") {
            gelbooruUrl = "https:" + gelbooruUrl
        }
        if (thumbnailUrl[0] === "/") {
            thumbnailUrl = "https://gelbooru.iqdb.org" + thumbnailUrl
        }
        const dimensions = rows[2].textContent!.split(" ")[0]
        const [width, height] = dimensions.split("×").map(n => parseInt(n))
        const similarity = parseInt(rows[3].textContent!.split("%")[0])
        matches.push({
            gelbooruUrl,
            thumbnailUrl,
            width,
            height,
            similarity
        })
    }
    return matches
}

type FileUploadCallback = (objectUrl: string) => void
type StatusCheckCallback = (matches: string[]) => void

export interface CheckResult {
    gelbooruIds?: string[],
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

export default function createImageUpload(sourceInput: HTMLInputElement, apiCredentials: GelbooruApi.Credentials): FileUpload {
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
    const accountSettingsLink = `<a target="_blank" href='https://gelbooru.com/index.php?page=account&s=options'>account settings</a>`
    const extensionSettingsLink = `<a class="extension-settings-link">extension settings</a>`
    const noApiInfoSetMessage = E("div", { class: "info hidden no-api-info-message" },
        "Cannot perform MD5 check or source check because Gelbooru user ID and/or API key " +
        `are not provided. You can find those values in your ${accountSettingsLink} on Gelbooru ` +
        `and set them in the ${extensionSettingsLink} to enable these checks.`)
    noApiInfoSetMessage.querySelector(".extension-settings-link")!
        .addEventListener("click", () => browser.runtime.sendMessage({ type: "open-extension-options" }))

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
                const pathParts = urlParts.pathname.split("/")
                const filename = pathParts[pathParts.length - 1]
                const pixivId = filename.split("_")[0]
                sourceInput.value = `https://www.pixiv.net/artworks/${pixivId}`
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

    const emitStatusUpdate = (gelbooruIds: string[]) => {
        statusCheckListeners.forEach(listener => listener(gelbooruIds))
        onCheckedResolve({ gelbooruIds })
        if (!loadedPixivId) return
        browser.runtime.sendMessage({
            type: "notify-associated-extensions",
            args: {
                pixivIdToGelbooruIds: {
                    [loadedPixivId]: gelbooruIds
                },
                filenameToGelbooruIds: fileInput.files ? {
                    [fileInput.files[0].name]: gelbooruIds 
                } : {}
            }
        })
    }

    const performMd5Search = async (arrayBuffer: ArrayBuffer) => {
        const md5 = new Md5()
        md5.appendByteArray(new Uint8Array(arrayBuffer))
        const md5hash = md5.end()
        const md5response = await GelbooruApi.query(["md5:" + md5hash], apiCredentials)

        // Display result of MD5 check
        noHashMatchesMessage.classList.toggle("hidden", md5response.length > 0)
        hashMatchesWrapper.classList.toggle("hidden", md5response.length === 0)
        if (md5response.length > 0) {
            foundMd5Match = true
            hashMatchesContainer.innerHTML = ""
            const postIds = md5response.map(post => post.id.toString())
            for (const postId of postIds) {
                const postLink = E("a", {
                    href: `https://gelbooru.com/index.php?page=post&s=view&id=${postId}`,
                    target: "_blank"
                }, postId)
                hashMatchesContainer.appendChild(postLink)
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
        let response = await GelbooruApi.query([sourceQuery], apiCredentials)
        if (response.length === 0) {
            sourceQuery = `source:*pximg*${pixivId}*`
            response = await GelbooruApi.query([`source:*pximg*${pixivId}*`], apiCredentials)
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
            `https://gelbooru.com/index.php?page=post&s=view&id=${response[0].id}` :
            `https://gelbooru.com/index.php?page=post&s=list&tags=${sourceQuery}`
        sourceMatchesHeader.innerHTML = `Found <a target="_blank" href="${postsLink}">`
            + `${response.length} ${postInflection}</a> matching Pixiv ID ${pixivId}`
        
        // List matching posts
        sourceMatchesContainer.innerHTML = ""
        for (const post of response) {
            const postLink = `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`
            const src = `https://img3.gelbooru.com/thumbnails/${post.directory}/thumbnail_${post.md5}.jpg`
            const postElement = E("a", { class: "gelbooru-post", href: postLink, target: "_blank" }, [
                E("img", { class: "small preview", src })
            ])
            sourceMatchesContainer.appendChild(postElement)
        }
        sourceMatchesContainer.classList.remove("hidden")
        emitStatusUpdate(response.map(post => post.id.toString()))
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

        // Query IQDB (via background page to circumvent CORS)
        const response = await browser.runtime.sendMessage({
            type: "query-gelbooru-iqdb",
            args: {
                fileUrl: objectUrl,
                filename: file.name
            }
        })
        searchingIqdbMessage.classList.add("hidden")
        iqdbMatchesHeader.classList.remove("hidden")

        // Display error message if query response is not valid
        if (!response.html) {
            iqdbMatchesHeader.classList.add("failure")
            console.log("IQDB response status:", response.status)
            let error
            if (response.status === 413) {
                error = "File is too large for IQDB request!"
            } else {
                error = "IQDB search request failed!"
            }
            iqdbMatchesHeader.textContent = error
            onCheckedResolve({ error })
            return
        }

        // Check if query failed
        const parser = new DOMParser()
        const doc = parser.parseFromString(response.html, "text/html")
        const errorMsg = doc.querySelector(".err")
        if (errorMsg !== null) {
            iqdbMatchesHeader.classList.add("failure")
            console.log("IQDB error:", errorMsg.textContent)
            let error
            if (errorMsg.textContent!.includes("too large")) {
                error = "File is too large for IQDB query (8192 KB max)."
            } else if (errorMsg.textContent!.includes("format not supported")) {
                error = "File format is not supported by IQDB."
            } else {
                error = "IQDB search request failed!"
            }
            iqdbMatchesHeader.textContent = error
            onCheckedResolve({ error })
            return
        }

        // Parse matches from response HTML and display search result
        let matches: IqdbSearchResult[] = []
        try {
            matches = parseIqdbSearchResults(doc).filter(match => match.similarity > 80)
        } catch (e) {
            const error = "Failed to parse IQDB response."
            iqdbMatchesHeader.innerHTML = error
            iqdbMatchesHeader.classList.add("failure")
            onCheckedResolve({ error })
            return
        }
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

        // List matches with highest similarity
        iqdbMatchesContainer.innerHTML = ""
        for (const match of matches) {
            const postElement = E("a", { class: "gelbooru-post", href: match.gelbooruUrl, target: "_blank" }, [
                E("img", { class: "small preview", src: match.thumbnailUrl })
            ])
            iqdbMatchesContainer.appendChild(postElement)
        }
        iqdbMatchesContainer.classList.remove("hidden")

        // Extract Gelbooru IDs. If some matches are referenced via MD5 hash, convert to ID.
        const gelbooruIds: string[] = []
        for (const match of matches) {
            const url = new URL(match.gelbooruUrl)
            if (url.searchParams.has("id")) {
                gelbooruIds.push(url.searchParams.get("id")!)
            } else if (url.searchParams.has("md5")) {
                const md5 = url.searchParams.get("md5")!
                const md5response = await GelbooruApi.query(["md5:" + md5], apiCredentials)
                if (md5response.length === 0) {
                    console.log(`WARNING: cannot find Gelbooru post for MD5 hash (${md5}).`)
                } else {
                    const gelbooruId = md5response[0].id.toString() 
                    gelbooruIds.push(gelbooruId)
                    console.log(`Converted MD5 hash to ID: ${md5} -> ${gelbooruId}`)
                }
            } else {
                console.log(`WARNING: Gelbooru post contains neither ID nor MD5 (${match.gelbooruUrl})`)
            }
        }
        emitStatusUpdate(gelbooruIds)
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

        if (apiCredentials.userId && apiCredentials.apiKey) {
            // Calculate MD5 and check if it already exists on Gelbooru
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