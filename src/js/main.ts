
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

import "./main.scss"

import browser from "webextension-polyfill";
import { E } from "js/utility"
import SettingsManager from "js/settings-manager"
import MainInterface from "js/components/main-interface"
import { HostName, BooruApi, Message } from "js/types"
import { getApi } from "js/api"

// Import font here because it doesn't work with pure CSS in a content script
const iconsFontUrl = browser.runtime.getURL("icons.woff2")
document.head.appendChild(E("style", {}, `
@font-face {
  font-family: CustomIcons;
  src: url(${iconsFontUrl})
}
`))

// Delete original stylesheets (only use custom styles)
document.head.querySelectorAll("link[rel=stylesheet]").forEach(s => s.remove())

async function main() {
    browser.runtime.onMessage.addListener(async (request, sender) => {
        if (sender.id !== browser.runtime.id) return
        if (!request.type) return

        // Receive images to be uploaded from background script
        else if (request.type === "prepare-upload") {
            const { file, url, pixivTags } = request.args
            if (!file || !url) return null
            const blob = await fetch(file).then(r => r.blob())
            const urlParts = url.split("/")
            const fileName = urlParts[urlParts.length - 1]
            const fileObj = new File([blob], fileName, { type: "image/jpeg" })
            const dataTransfer = new DataTransfer()
            dataTransfer.setData("text/uri-list", url)
            dataTransfer.items.add(fileObj)
            const result = await mainInterface.addFile(dataTransfer, pixivTags)
            return { ...result, host: api.host }
        }
        else if (request.type === "focus-tab") {
            const { filename, host } = request.args
            if (host && host !== api.host) return null
            if (!filename) return null
            return mainInterface.focusTabByFilename(filename)
        }
    })

    let api: BooruApi
    const settings = await SettingsManager.getAll()
    const host = window.location.host
    if (host === "gelbooru.com") {
        document.title = "New upload | Gelbooru"
        api = await getApi(HostName.Gelbooru, settings)
    } else if (host === "danbooru.donmai.us") {
        // On Danbooru, authentification can be done using a CSRF token instead
        const metaElem = document.head.querySelector("meta[name='csrf-token']")
        const csrfToken = metaElem ? metaElem.getAttribute("content") : undefined
        api = await getApi(HostName.Danbooru, settings, csrfToken || undefined)
    } else {
        throw new Error(`Unknown host ${host}.`)
    }

    const mainInterface = new MainInterface(api, settings)
    // Body needs to be replaced on Danbooru to get rid of event listeners
    document.body = document.createElement("body")
    document.body.appendChild(mainInterface.getElement())

    browser.runtime.sendMessage({
        type: Message.RegisterUploadPageTab,
        args: { host: api.host } 
    })
}

main()
