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
        const file = new File([new Uint8Array(args.file).buffer], args.filename)
        const formData = new FormData()
        formData.append("file", file, file.name)
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
    }
})