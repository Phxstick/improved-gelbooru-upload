import browser from "webextension-polyfill";
import SettingsManager from "js/settings-manager";
import { HostName, StatusUpdate, Message } from "js/types";
import { getApi } from "js/api"

const associatedExtensions = [
    "hbghinibnihlfahabmgdanonolmihbko",
    "bpglogcjlfchmgbmipjfagbhcpeamhpe"
]
const uploadTabKeys: { [key in HostName]: string } = {
    [HostName.Gelbooru]: "gelbooruUploadTabs",
    [HostName.Danbooru]: "danbooruUploadTabs"
}

async function queryArtistDatabase(artistUrl: string): Promise<string> {
    const url = new URL("https://danbooru.donmai.us/artists")
    url.searchParams.set("search[url_matches]", artistUrl)
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

browser.runtime.onStartup.addListener(() => {
    for (const host of Object.values(HostName)) {
        browser.storage.local.remove(uploadTabKeys[host])
    }
})

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

    if (request.type === Message.QueryIqdb) {
        return queryIqdb(args.host, args.fileUrl, args.filename)

    } else if (request.type === Message.GetArtistTag) {
        return { html: await queryArtistDatabase(args.url) }

    } else if (request.type === Message.OpenExtensionOptions) {
        browser.runtime.openOptionsPage()

    } else if (request.type === Message.NotifyAssociatedExtensions) {
        notifyAssociatedExtensions(args)

    } else if (request.type === Message.RegisterUploadPageTab) {
        if (!sender.tab || !sender.tab.id) return
        const storageKey = uploadTabKeys[args.host as HostName]
        await browser.storage.local.set({ [storageKey]: sender.tab.id })
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
        const storageKey = uploadTabKeys[host]
        const storageData = await browser.storage.local.get([storageKey])
        let tabId: number | undefined = storageData[storageKey]
        const api = await getApi(host)

        async function openUploadPage() {
            const url = api.getUploadUrl()
            const tab = await browser.tabs.create({ url, active: false })
            return tab.id
        }
        async function sendData() {
            return browser.tabs.sendMessage(tabId!, {
                type: "prepare-upload",
                args: request.data
            }).catch(() => {})
        }
        if (!tabId) {
            tabId = await openUploadPage()
        } else {
            const result = await sendData()
            if (result !== undefined) return result
            tabId = await openUploadPage()
        }
        if (!tabId) return {
            error: `Can't open tab with upload page for host "${host}".`
        }
    
        // Content script needs time to load, so repeatedly try to establish a
        // connection until it works
        for (let numTries = 0; numTries < 20; numTries++) {
            const result = await new Promise<any>(resolve => {
                setTimeout(async () => resolve(await sendData()), 400)
            })
            if (result !== undefined) return result
        }
        return { error: "Failed to communicate with the upload page." }
    }
    // Focus specific tab on request
    else if (request.type === "focus-tab") {
        if (!request.args || !request.args.filename) return {
            error: `Tab to focus must be specified by parameter 'filename'.`
        }
        const host = request.args.host as HostName || HostName.Gelbooru
        const storageKey = uploadTabKeys[host]
        const storageData = await browser.storage.local.get([storageKey])
        const tabId: number | undefined = storageData[storageKey]
        if (!tabId) return {
            error: `No upload page from host ${host} is currently open!`
        }
        const uploadTabExists = await browser.tabs.sendMessage(tabId,
            { type: "focus-tab", args: request.args }).catch(() => {})
        if (uploadTabExists) {
            browser.tabs.update(tabId, { active: true })
        }
        return uploadTabExists
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
        if (!request.args || !request.args.url) return {
            error: `Queries to artist database must include parameter 'url'.`
        }
        return { html: await queryArtistDatabase(request.args.url) }
    }
})
