
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

import "./gelbooru-upload.scss"

import browser from "webextension-polyfill";
import { E } from "js/utility"
import SettingsManager from "js/settings-manager"
import MainInterface from "js/components/main-interface"

// Import font here because it doesn't work with pure CSS in a content script
const iconsFontUrl = browser.runtime.getURL("icons.woff2")
document.head.appendChild(E("style", {}, `
@font-face {
  font-family: CustomIcons;
  src: url(${iconsFontUrl})
}
`))

// Set custom title and delete original stylesheet (only use custom styles)
document.title = "Gelbooru upload"
document.head.querySelector("link[rel=stylesheet]")?.remove()

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
            return mainInterface.addFile(dataTransfer, pixivTags)
        }
    })

    const settings =  await SettingsManager.getAll()
    const mainInterface = new MainInterface(settings)

    const container = document.getElementById("container")!
    container.innerHTML = ""
    container.appendChild(mainInterface.getElement())

    browser.runtime.sendMessage({ type: "register-upload-page-tab" })
}

main()