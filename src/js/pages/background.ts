import browser from "webextension-polyfill";
import GelbooruApi from "js/gelbooru-api";
import SettingsManager from "js/settings-manager";

const associatedExtensions = ["hbghinibnihlfahabmgdanonolmihbko"]
const gelbooruUploadTabKey = "gelbooruUploadTabs"

async function queryArtistDatabase(artistUrl: string): Promise<string> {
    const url = new URL("https://danbooru.donmai.us/artists")
    url.searchParams.set("search[url_matches]", artistUrl)
    url.searchParams.set("search[order]", "created_at")
    url.searchParams.set("commit", "Search")
    const response = await fetch(url.toString())
    return response.text()
}

browser.runtime.onStartup.addListener(() => {
    browser.storage.local.remove(gelbooruUploadTabKey)
})

browser.runtime.onMessage.addListener(async (request, sender) => {
    if (sender.id !== browser.runtime.id) return
    if (!request.type) return
    const args = request.args || {}

    if (request.type === "query-gelbooru-iqdb") {
        const blob = await fetch(args.fileUrl).then(r => r.blob())
        const formData = new FormData()
        formData.append("file", blob, args.filename)
        const response = await fetch("https://gelbooru.iqdb.org/", {
            method: "POST",
            body: formData
        })
        if (response.ok) {
            const responseText = await response.text()
            return { html: responseText }
        } else {
            return { status: response.status }
        }

    } else if (request.type === "get-artist-tag") {
        return { html: await queryArtistDatabase(args.url) }

    } else if (request.type === "open-extension-options") {
        browser.runtime.openOptionsPage()

    } else if (request.type === "notify-associated-extensions") {
        for (const extensionId of associatedExtensions) {
            browser.runtime.sendMessage(extensionId, {
                type: "pixiv-status-update",
                args
            }).catch(() => {})
        }

    } else if (request.type === "register-upload-page-tab") {
        if (!sender.tab || !sender.tab.id) return
        await browser.storage.local.set({ [gelbooruUploadTabKey]: sender.tab.id })
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
        const storageData = await browser.storage.local.get([gelbooruUploadTabKey])
        let tabId: number | undefined = storageData[gelbooruUploadTabKey]

        async function openGelbooruUploadTab() {
            const gelbooruUploadUrl = "https://gelbooru.com/index.php?page=post&s=add"
            const tab = await browser.tabs.create({ url: gelbooruUploadUrl, active: false })
            return tab.id
        }
        async function sendData() {
            return browser.tabs.sendMessage(tabId!, { type: "prepare-upload", args: request.data }).catch(() => {})
        }
        if (!tabId) {
            tabId = await openGelbooruUploadTab()
        } else {
            const result = await sendData()
            if (result !== undefined) return result
            tabId = await openGelbooruUploadTab()
        }
        if (!tabId) return { error: "Can't open tab with Gelbooru upload page." }
    
        // Content script needs time to load, so repeatedly try to establish a
        // connection until it works
        for (let numTries = 0; numTries < 20; numTries++) {
            const result = await new Promise<any>(resolve => {
                setTimeout(async () => resolve(await sendData()), 400)
            })
            if (result !== undefined) return result
        }
        return { error: "Failed to communicate with the Gelbooru upload page." }
    }
    // Focus specific tab on request
    else if (request.type === "focus-tab") {
        if (!request.args || !request.args.filename) return {
            error: `Tab to focus must be specified by parameter 'filename'.`
        }
        const storageData = await browser.storage.local.get([gelbooruUploadTabKey])
        const tabId: number | undefined = storageData[gelbooruUploadTabKey]
        if (!tabId) return {
            error: "No Gelbooru upload page is currently open!"
        }
        const uploadTabExists = await browser.tabs.sendMessage(tabId,
            { type: "focus-tab", args: request.args }).catch(() => {})
        if (uploadTabExists) {
            browser.tabs.update(tabId, { active: true })
        }
        return uploadTabExists
    }
    
    // Handle queries to Gelbooru/Danbooru from associated extensions
    else if (request.type === "query-gelbooru") {
        if (!request.args || !request.args.tags) return {
            error: `Queries to Gelbooru must include parameter 'tags'.`
        }
        const tags = request.args.tags as string[]
        const gelbooruApiCred = await SettingsManager.get(["apiKey", "userId"])
        if (!gelbooruApiCred.apiKey || !gelbooruApiCred.userId) return {
            error: `Gelbooru API credentials are missing.`
        }
        return { posts: await GelbooruApi.query(tags, gelbooruApiCred) }
    }
    else if (request.type === "query-artist-database") {
        if (!request.args || !request.args.url) return {
            error: `Queries to artist database must include parameter 'url'.`
        }
        return { html: await queryArtistDatabase(request.args.url) }
    }
})