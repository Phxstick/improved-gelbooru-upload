import browser from "webextension-polyfill";
import showdown from "showdown"
import { E } from "js/utility";

import "./modal.scss"
import "./changelog-modal.scss"

interface ChangelogSettings {
    hideUntilUpdate: boolean,
    lastVersion: string
}

export default class ChangelogModal {
    private static readonly STORAGE_KEY = "changelogSettings"

    private readonly closeButton = E("div", { class: "ui button" }, "Close")
    private readonly contentContainer = E("div", { class: "content" })
    private readonly hideUntilUpdateCheckbox = E("div", { class: "ui checkbox" }, [
        E("input", { type: "checkbox" }),
        E("label", {}, "Don't show this until the next update")
    ])
    private readonly header = E("div", { class: "header" }, "Changelog - ")
    private readonly root =  E("div", { class: "ui modal changelog-modal" }, [
        this.header,
        this.contentContainer,
        E("div", { class: "actions" }, [
            this.hideUntilUpdateCheckbox,
            this.closeButton
        ])
    ])

    private settings: ChangelogSettings = {
        hideUntilUpdate: true,
        lastVersion: "0.0.0"
    }

    constructor(openingManually=false) {
        const manifest = browser.runtime.getManifest()
        this.header.textContent += manifest.name
        this.hideUntilUpdateCheckbox.classList.toggle("hidden", openingManually)
        this.closeButton.addEventListener("click", () => $(this.root).modal("hide"))
        document.body.appendChild(this.root)
        $(this.root).modal({
            duration: 180,
            onHide: () => {
                if (!openingManually) this.saveSettings()
            }
        })
    }

    async isSupposedToOpen(): Promise<boolean> {
        // Check if version changed or if the modal is set to always show
        await this.loadSettings()
        const manifest = browser.runtime.getManifest()
        return !(this.settings.hideUntilUpdate &&
            manifest.version <= this.settings.lastVersion)
    }

    async open() {
        // Get changelog content if not done yet
        if (this.contentContainer.innerHTML === "") {
            const changelogUrl = browser.runtime.getURL("changelog.md")
            const changelog = await (await fetch(changelogUrl)).text()
            const markdownConverter = new showdown.Converter({
                openLinksInNewWindow: true
            })
            const changelogHtml = markdownConverter.makeHtml(changelog)
            this.contentContainer.innerHTML = changelogHtml
        }
        $(this.root).modal("show")
        $(this.root).modal("show dimmer")
    }

    private async loadSettings() {
        const storageData = await browser.storage.sync.get(ChangelogModal.STORAGE_KEY)
        if (ChangelogModal.STORAGE_KEY in storageData) {
            this.settings = storageData[ChangelogModal.STORAGE_KEY] as ChangelogSettings
        }
        if (this.settings.hideUntilUpdate)
            $(this.hideUntilUpdateCheckbox).checkbox("set checked")
    }

    private async saveSettings() {
        const manifest = browser.runtime.getManifest()
        const hideUntilUpdate = $(this.hideUntilUpdateCheckbox).checkbox("is checked")
        if (this.settings.hideUntilUpdate !== hideUntilUpdate ||
                this.settings.lastVersion !== manifest.version) {
            this.settings = {
                hideUntilUpdate,
                lastVersion: manifest.version
            }
            await browser.storage.sync.set({ [ChangelogModal.STORAGE_KEY]: this.settings })
        }
    }
}