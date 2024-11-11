import browser from "webextension-polyfill";
import SettingsManager from "js/settings-manager";
import { HostName, StatusUpdate, MessageType, ArtistQuery, PixivTags, UploadInstanceData } from "js/types";
import { getApi, isUploadUrl } from "js/api"
import DanbooruApi from "js/danbooru-api";

// const PIXIV_EXTENSION = "hbghinibnihlfahabmgdanonolmihbko"
const PIXIV_EXTENSION = "igmecdapimckdghdehckbojdcjjjjmfk"

const associatedExtensions = [
    PIXIV_EXTENSION,
]
const uploadTabsKey = "uploadTabs"
const uploadTabOpeningKey = "openingUploadTab"

async function getAllUploadTabs(): Promise<{ [key in HostName]?: number[] }> {
    const storageData = await browser.storage.session.get(uploadTabsKey)
    return storageData[uploadTabsKey] || {}
}

async function getUploadTabs(host: HostName): Promise<number[]> {
    const hostToTabs = await getAllUploadTabs()
    const tabs = hostToTabs[host]
    if (tabs === undefined) return []
    return tabs
}

async function getLastUploadTab(host: HostName): Promise<number | undefined> {
    const tabs = await getUploadTabs(host)
    return tabs && tabs.length > 0 ? tabs[tabs.length - 1] : undefined
}

async function registerUploadTab(host: HostName, tabId: number) {
    const hostToTabs = await getAllUploadTabs()
    const tabs = hostToTabs[host] || []
    if (tabs.includes(tabId)) return
    hostToTabs[host] = [...tabs, tabId]
    await browser.storage.session.set({ [uploadTabsKey]: hostToTabs })
    setUploadTabOpening(host, false)
    browser.tabs.update(tabId, { autoDiscardable: false })
}

async function unregisterUploadTab(tabId: number) {
    const hostToTabs = await getAllUploadTabs()
    for (const host of Object.values(HostName)) {
        const tabs = hostToTabs[host]
        if (!tabs) continue
        const index = tabs.indexOf(tabId)
        if (index < 0) continue
        tabs.splice(index, 1)
        return browser.storage.session.set({ [uploadTabsKey]: hostToTabs })
    }
}

async function isUploadTabOpening(host: HostName): Promise<boolean> {
    const storageData = await browser.storage.session.get(uploadTabOpeningKey)
    const statusMap = storageData[uploadTabOpeningKey] || {}
    return statusMap[host] || false
}

async function setUploadTabOpening(host: HostName, status: boolean) {
    const storageData = await browser.storage.session.get(uploadTabOpeningKey)
    const statusMap = storageData[uploadTabOpeningKey] || {}
    statusMap[host] = status
    await browser.storage.session.set({ [uploadTabOpeningKey]: statusMap })
}

async function wait(time: number) {
    return new Promise(resolve => { setTimeout(resolve, time) })
}

async function queryArtistDatabase(query: ArtistQuery): Promise<string> {
    const url = new URL("https://danbooru.donmai.us/artists")
    if (query.url && !query.name) {
        url.searchParams.set("search[url_matches]", query.url)
    } else if (query.name && !query.url) {
        url.searchParams.set("search[name]", query.name)
    } else {
        throw new Error("Artist query must contain either a URL or name.")
    }
    url.searchParams.set("search[order]", "created_at")
    url.searchParams.set("commit", "Search")
    const response = await fetch(url.toString())
    return response.text()
}

async function queryIqdb(host: HostName, url: string, filename: string) {
    const blob = await fetch(url).then(r => r.blob())
    const formData = new FormData()
    formData.append("file", blob, filename)
    const response = await fetch(`https://${host}.iqdb.org/`, {
        method: "POST",
        body: formData
    })
    if (response.ok) {
        const responseText = await response.text()
        return { html: responseText }
    } else {
        return { status: response.status }
    }
}

function notifyAssociatedExtensions(statusUpdate: StatusUpdate) {
    const { host, pixivId, filename, postIds, posts } = statusUpdate
    const postIdStrings = postIds.map(id => id.toString())
    const args: any = {
        pixivIdToPostIds: {
            [pixivId]: {
                [host]: postIdStrings
            }
        },
        filenameToPostIds: {
            [filename]: {
                [host]: postIdStrings
            }
        },
        posts: posts ? {
            [host]: posts
        } : {}
    }
    for (const extensionId of associatedExtensions) {
        browser.runtime.sendMessage(extensionId, {
            type: "pixiv-status-update",
            args
        }).catch(() => {})
    }
}

interface Message {
    type: string
    args: any
}
async function sendToUploadPage(host: HostName, message: Message) {
    async function sendData(tabId: number) {
        return browser.tabs.sendMessage(tabId, message).catch(() => {})
    }

    // Try sending message to registered tab. Note that the tab might no longer
    // exist or not contain an upload page anymore (-> undefined is returned)
    const tabId = await getLastUploadTab(host)
    if (tabId) {
        const result = await sendData(tabId)
        if (result !== undefined) return result
        unregisterUploadTab(tabId)
    }

    // Open a new upload page (unless such a page is already loading)
    const uploadPageLoading = await isUploadTabOpening(host)
    if (!uploadPageLoading) {
        setUploadTabOpening(host, true)
        const api = await getApi(host, undefined)
        const url = api.getUploadUrl()
        await browser.tabs.create({ url, active: false })
    }

    // Content script needs time to load, so repeatedly check if it has loaded
    for (let numTries = 0; numTries < 20; numTries++) {
        await wait(400)
        const tabId = await getLastUploadTab(host)
        if (tabId) {
            const result = await sendData(tabId)
            if (result !== undefined) return result
            unregisterUploadTab(tabId)
            break
        }
    }
    return { error: "Failed to communicate with the upload page." }
}

async function focusTab(host: HostName, details: { filename: string }) {
    const tabId = await getLastUploadTab(host)
    if (!tabId) return {
        error: `No upload page from host ${host} is currently open!`
    }
    const uploadTabExists = await browser.tabs.sendMessage(tabId,
        { type: "focus-tab", args: details }).catch(() => {})
    if (uploadTabExists) {
        const tab = await browser.tabs.get(tabId);
        browser.tabs.update(tabId, { active: true })
        if (tab.windowId) {
            browser.windows.update(tab.windowId, { focused: true })
        }
    }
    return uploadTabExists
}

const knownOrigins = {
    "twitter": [
        "https://x.com/",
        "https://pbs.twimg.com/"
    ]
}

async function downloadPage(urlString: string) {
    // Check if URL is valid and get origin
    let origin
    try {
        const url = new URL(urlString)
        origin = url.origin + "/"
    } catch (e) {
        return { error: "The given URL is not valid." }
    }

    // Check if origin is known and request host permissions for it
    let isKnownOrigin = false
    for (const [hostName, requiredOrigins] of Object.entries(knownOrigins)) {
        if (!requiredOrigins.includes(origin)) continue
        isKnownOrigin = true
        const permissionsGranted = await browser.permissions.request({
            "origins": requiredOrigins
        })
        if (!permissionsGranted) return {
            error: "Required permissions have not been granted to the extension."
        }
        break
    }
    if (!isKnownOrigin) return {
        error: "The given URL does not have a recognized origin."
    }

    // Download the page and return result
    const response = await fetch(urlString)
    if (!response.ok) {
        return {
            error: `HTTP request failed (status code ${response.status}).`
        }
    }
    const html = response.text()
    return { html }
}

browser.runtime.onInstalled.addListener(async () => {
    // Register content script on Danbooru if it's enabled in the settings
    // (programatically injected scripts and permissions get lost if an extension 
    // gets reloaded, and onInstall is fired in that case)
    const { enableOnDanbooru } = await SettingsManager.get(["enableOnDanbooru"])
    if (enableOnDanbooru) SettingsManager.enableDanbooruScript()
})

browser.runtime.onMessage.addListener(async (request, sender) => {
    if (sender.id !== browser.runtime.id) return
    if (!request.type) return
    const args = request.args || {}

    if (request.type === MessageType.QueryIqdb) {
        return queryIqdb(args.host, args.fileUrl, args.filename)
    }
    else if (request.type === MessageType.GetArtistTag) {
        return { html: await queryArtistDatabase(args) }
    }
    else if (request.type === MessageType.OpenExtensionOptions) {
        browser.runtime.openOptionsPage()
    }
    else if (request.type === MessageType.NotifyAssociatedExtensions) {
        notifyAssociatedExtensions(args)
    }
    else if (request.type === MessageType.RegisterUploadPageTab) {
        if (!sender.tab || !sender.tab.id) return
        registerUploadTab(args.host as HostName, sender.tab.id)
    }
    else if (request.type === MessageType.DownloadPixivImage) {
        return browser.runtime.sendMessage(PIXIV_EXTENSION, {
            type: "download-pixiv-image",
            args
        })
    }
    else if (request.type === MessageType.DownloadPage) {
        if (!args.url) {
            return { error: "Page URL has not been provided." }
        }
        return downloadPage(args.url)
    }
    else if (request.type === MessageType.PrepareUpload) {
        const host = args.host as HostName
        sendToUploadPage(host, { type: "prepare-upload", args: args.data })
    }
    else if (request.type === MessageType.FocusTab) {
        if (!args.host || !args.details) return
        return focusTab(args.host, args.details)
    }
})

browser.runtime.onMessageExternal.addListener(async (request, sender) => {
    if (!sender.id) return
    if (!request || !request.type) return

    // Only allow whitelisted extensions to send messages
    if (!associatedExtensions.includes(sender.id)) return

    // Receive images to be uploaded from associated extensions
    else if (request.type === "prepare-upload") {
        if (!request.data) return
        const host = request.data.host as HostName || HostName.Gelbooru
        const { file, url, pixivTags } = request.data as {
            file: string, url: string, pixivTags: PixivTags
        }
        if (!file || !url) return {
            error: "Data must contain the properties 'file' and 'url'."
        }
        const urlParts = url.split("/")
        const fileName = urlParts[urlParts.length - 1]
        const dotIndex = url.lastIndexOf(".")
        const fileExtension = dotIndex >= 0 ? url.slice(dotIndex) : "jpg"
        const fileType = {
            "jpg": "image/jpeg",
            "png": "image/png"
        }[fileExtension] || "image/jpeg"
        const data: UploadInstanceData = {
            file: {
                name: fileName,
                type: fileType,
                objectUrl: file
            },
            fileUrl: url,
            pixivTags
        }
        const response = await sendToUploadPage(host, {
            type: "prepare-upload",
            args: [data]
        })
        return { ...response.checkResults[0], host }
    }
    // Focus specific tab on request
    else if (request.type === "focus-tab") {
        if (!request.args || !request.args.filename) return {
            error: `Tab to focus must be specified by parameter 'filename'.`
        }
        const host = request.args.host as HostName || HostName.Gelbooru
        return focusTab(host, request.args)
    }
    
    // Handle queries to image hosts from associated extensions
    else if (request.type === "query-host") {
        if (!request.args || !request.args.tags) return {
            error: `Queries must include the parameter 'tags'.`
        }
        const tags = request.args.tags as string[]
        const host = request.args.host as HostName || HostName.Gelbooru
        let api
        try {
            api = await getApi(host)
        } catch (error) {
            return { error: `Unknown image host "${host}".` }
        }
        if (!api.isAuthenticated()) return {
            error: `API credentials are missing for host "${host}".`
        }
        return { posts: await api.searchPosts(tags) }
    }
    else if (request.type === "query-artist-database") {
        if (!request.args) return {
            error: `Message must include object 'args' with arguments.`
        }
        const danbooruApi = await getApi(HostName.Danbooru) as DanbooruApi
        try {
            return { artists: await danbooruApi.searchForArtist(request.args) }
        } catch (error) {
            return { error }
        }
    }
    else if (request.type === "get-version") {
        const manifest = browser.runtime.getManifest()
        return { version: manifest.version }
    }
})
