import browser from "webextension-polyfill";

// Declare global objects
declare global {
    interface Window {
        $: JQueryStatic,
        jQuery: JQueryStatic
        chrome: any
    }
}

browser.runtime.onMessage.addListener(async (request, sender) => {
    if (sender.id !== browser.runtime.id) return
    if (!request.type || !sender.url || !sender.tab || !sender.tab.id) return
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
            return { }
        }
    } else if (request.type === "get-artist-tag") {
        const url = new URL("https://danbooru.donmai.us/artists")
        url.searchParams.set("search[url_matches]", args.url)
        url.searchParams.set("search[order]", "created_at")
        url.searchParams.set("commit", "Search")
        const response = await fetch(url.toString())
        const responseText = await response.text()
        return { html: responseText }
    } else if (request.type === "open-extension-options") {
        browser.runtime.openOptionsPage()
    } else if (request.type === "notify-subscribed-extensions") {
        const { subscribedExtensions } = await browser.storage.local.get({ "subscribedExtensions": [] })
        for (const extensionId of subscribedExtensions) {
            try {
                browser.runtime.sendMessage(extensionId, {
                    type: "pixiv-status-update",
                    args
                })
            } catch (error) {}
        }
    }
})

// Make it possible for external extensions to register themselves.
// Whenever a picture from pixiv is checked/posted, those extensions will
// receive a message with the associated gelbooru IDs
browser.runtime.onMessageExternal.addListener(async (request, sender) => {
    if (!request.type) return
    if (!sender.id) return
    if (!request || !request.type) return
    if (request.type === "subscribe-to-pixiv-status") {
        const { subscribedExtensions } = await browser.storage.local.get({ "subscribedExtensions": [] })
        if (subscribedExtensions.includes(sender.id)) return
        subscribedExtensions.push(sender.id)
        await browser.storage.local.set({ subscribedExtensions })
        return true
    }
})