import browser from "webextension-polyfill";
import { Md5 } from "ts-md5/dist/md5"
import { E } from "js/utility"
import { ApiCredentials } from "js/types";
import "./file-upload.scss";

interface GelbooruPostData {
    post: GelbooruPostData[]
    id: string | number
    source: string
    directory: string
    md5: string
    image: string
    preview_height: string
    preview_width: string
    score: string | number
    rating: string
    status: string
}

interface GelbooruResponseData {
    "@attributes": {
        limit: string
        offset: string
        count: string
    }
    post?: GelbooruPostData | GelbooruPostData[]
}

async function sendGelbooruRequest(tags: string[], { userId, apiKey }: ApiCredentials): Promise<GelbooruPostData[]> {
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&api_key=${apiKey}&user_id=${userId}&json=1&tags=${tags.join("+")}`
    const response = await fetch(url)
    const data = await response.json() as GelbooruResponseData
    if (data.post === undefined) return []
    return Array.isArray(data.post) ? data.post : [data.post]
}

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
export default function createImageUpload(sourceInput: HTMLInputElement, apiCredentials: ApiCredentials) {
    let foundMd5Match = false

    // Create hidden file input with a label for custom styling
    const fileInput = E("input", {
        type: "file", accept: "image/*", id: "file-input", class: "hidden" }) as HTMLInputElement
    const fileInputLabel = E("label", {
        class: "file-input-label styled-input",
        for: "file-input"
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
    fileInputLabel.addEventListener("dragover", (event) => {
        event.preventDefault()
    })
    fileInputLabel.addEventListener("drop", (event) => {
        event.preventDefault()
        fileInputLabel.classList.remove("dragover")
        if (!event.dataTransfer) return
        const url = event.dataTransfer.getData("text/uri-list")
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
        fileInput.files = event.dataTransfer.files
        fileInput.dispatchEvent(new Event("change"))
    })
    // Highlight label when dragging something above it
    fileInputLabel.addEventListener("dragenter", () => {
        fileInputLabel.classList.add("dragover")
    })
    fileInputLabel.addEventListener("dragleave", () => {
        fileInputLabel.classList.remove("dragover")
    })

    // Create elements for MD5 check
    const noHashMatchesMessage = E("div", { class: "success hidden" }, "Found no MD5 hash matches ✔")
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
        const buffer = await fileInput.files[0].arrayBuffer()
        performIqdbSearch(fileInput.files[0], buffer)
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
        hashMatchesWrapper,
        sourceMatchesWrapper,
        startIqdbSearch,
        iqdbMatchesWrapper
    ])
    const imagePreviewSmall = E("img", { class: "small preview hidden" }) as HTMLImageElement
    const imagePreviewLarge = E("img", { class: "large preview hidden" }) as HTMLImageElement
    const imageInfoContainer = E("div", { class: "image-info" }, [
        imagePreviewSmall,
        imageChecksContainer
    ])

    const performMd5Search = async (arrayBuffer: ArrayBuffer) => {
        const md5 = new Md5()
        md5.appendByteArray(new Uint8Array(arrayBuffer))
        const md5hash = md5.end()
        const md5response = await sendGelbooruRequest(["md5:" + md5hash], apiCredentials)

        // Display result of MD5 check
        noHashMatchesMessage.classList.toggle("hidden", md5response.length > 0)
        hashMatchesWrapper.classList.toggle("hidden", md5response.length === 0)
        if (md5response.length > 0) {
            foundMd5Match = true
            hashMatchesContainer.innerHTML = ""
            for (const post of md5response) {
                const postLink = E("a", {
                    href: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
                    target: "_blank"
                }, post.id.toString())
                hashMatchesContainer.appendChild(postLink)
            }
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
        let response = await sendGelbooruRequest([sourceQuery], apiCredentials)
        if (response.length === 0) {
            sourceQuery = `source:*pximg*${pixivId}*`
            response = await sendGelbooruRequest([`source:*pximg*${pixivId}*`], apiCredentials)
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
            const postElement = E("a", { class: "gelbooru-post", href: postLink, target: "_blank" }, [
                E("img", { src: `https://img3.gelbooru.com/thumbnails/${post.directory}/thumbnail_${post.md5}.jpg` })
            ])
            sourceMatchesContainer.appendChild(postElement)
        }
        sourceMatchesContainer.classList.remove("hidden")
        return true
    }

    const performIqdbSearch = async (file: File, buffer: ArrayBuffer) => {
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
                file: Array.from(new Uint8Array(buffer)),
                filename: file.name
            }
        })

        // Display error message if query failed
        if (!response.html) {
            iqdbMatchesHeader.textContent = "IQDB search request failed!"
            iqdbMatchesHeader.classList.add("failure")
            return
        }

        // Parse matches from response HTML
        const parser = new DOMParser()
        const doc = parser.parseFromString(response.html, "text/html")
        const matches = parseIqdbSearchResults(doc).filter(match => match.similarity > 80)

        // Display search result
        searchingIqdbMessage.classList.add("hidden")
        iqdbMatchesHeader.classList.toggle("success", matches.length === 0)
        iqdbMatchesHeader.classList.toggle("failure", matches.length > 0)
        iqdbMatchesHeader.classList.remove("hidden")
        if (matches.length === 0) {
            iqdbMatchesHeader.innerHTML = `Found no similar images in IQDB ✔`
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
                E("img", { src: match.thumbnailUrl })
            ])
            iqdbMatchesContainer.appendChild(postElement)
        }
        iqdbMatchesContainer.classList.remove("hidden")

    }

    fileInput.addEventListener("change", async () => {
        if (!fileInput.files || !fileInput.files.length) {
            noFileErrorMessage.classList.remove("hidden")
            return
        }
        const file = fileInput.files[0]
        imagePreviewSmall.src = URL.createObjectURL(file)
        imagePreviewLarge.src = URL.createObjectURL(file)
        const arrayBuffer = await file.arrayBuffer()
        foundMd5Match = false

        // Set label to name of dragged file and show image preview
        fileInputLabel.textContent = file.name
        noFileErrorMessage.classList.add("hidden")
        imagePreviewSmall.classList.remove("hidden")
        imagePreviewLarge.classList.remove("hidden")
        fileInputLabel.classList.remove("placeholder")
        noHashMatchesMessage.classList.add("hidden")
        hashMatchesWrapper.classList.add("hidden")
        sourceMatchesWrapper.classList.add("hidden")
        iqdbMatchesWrapper.classList.add("hidden")
        startIqdbSearch.classList.add("hidden")
        imageInfoContainer.classList.remove("hidden")

        if (apiCredentials.userId && apiCredentials.apiKey) {
            // Calculate MD5 and check if it already exists on Gelbooru
            const foundMatch = await performMd5Search(arrayBuffer)
            // MD5 hash check is sufficiently precise, no need to do more checks if a match has been found
            // (false positives are theoretically possible but highly unlikely, so not worth handling)
            if (foundMatch) return

            // If given filename uses the Pixiv pattern, do a source check using the ID
            const pixivRegex = /(\d+)_p\d+/
            const pixivMatch = file.name.match(pixivRegex)
            if (pixivMatch !== null) {
                const pixivId = pixivMatch[1]
                const foundMatches = await performSourceSearch(pixivId)
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
        performIqdbSearch(file, arrayBuffer)
    })

    const resetFunction = () => {
        fileInput.value = ""
        imageInfoContainer.classList.add("hidden")
        imagePreviewSmall.removeAttribute("src")
        imagePreviewLarge.removeAttribute("src")
        fileInputLabel.classList.add("placeholder")
        fileInputLabel.textContent = "Drag image here or click to select file"
    }
    resetFunction()

    const wrapper = E("div", {}, [
        fileInputLabel,
        noFileErrorMessage,
        fileInput,
        imageInfoContainer
    ])

    return {
        getElement: () => wrapper,
        getFile: () => fileInput.files ? fileInput.files[0] : undefined,
        reset: resetFunction,
        foundMd5Match: () => foundMd5Match,
        getLargeImagePreview: () => imagePreviewLarge
    }
}