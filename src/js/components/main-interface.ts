import browser from "webextension-polyfill";
import { E, showInfoModal } from "js/utility"
import { Settings, BooruApi, AuthError, StatusUpdate, Message, EnhancedTags } from "js/types"
import ContextMenu from "js/generic/context-menu"
import Component from "js/generic/component"
import Selection from "js/generic/selection"
import UploadInterface from "js/components/upload-interface"
import TagInputs from "js/components/tag-inputs"
import WikiModal from "js/components/wiki-modal"
import "./main-interface.scss"

export enum TabStatus {
    Empty = "empty",
    Checking = "checking",
    Checked = "checked",
    Uploading = "uploading",
    UploadSuccess = "upload-success",
    UploadFailed = "upload-failed"
}

export default class MainInterface extends Component {
    private readonly api: BooruApi
    private readonly settings: Settings
    private readonly wikiModal: WikiModal

    private readonly tabToInstance = new WeakMap<HTMLElement, UploadInterface>()
    private readonly tabToStatus = new WeakMap<HTMLElement, TabStatus>()
    private readonly tabToStatusMessage = new WeakMap<HTMLElement, string>()
    private readonly tabToScrollTop = new WeakMap<HTMLElement, number>()
    private readonly tabToFilename = new WeakMap<HTMLElement, string>()
    private readonly filenameToTab = new Map<string, HTMLElement>()

    private readonly tabsWrapper: HTMLElement
    private readonly tabsContainer: HTMLElement
    private readonly interfaceWrapper: HTMLElement
    private readonly largeImagePreviewWrapper: HTMLElement
    private readonly uploadButton: HTMLButtonElement
    private readonly mainWrapper: HTMLElement
    private readonly uploadStatus: HTMLElement

    private selectedTab!: HTMLElement

    constructor(api: BooruApi, settings: Settings) {
        super()
        this.api = api
        this.settings = settings
        this.wikiModal = new WikiModal(api)

        const tabsContainer = E("div", { class: "tabs-container" })
        tabsContainer.addEventListener("click", (event) => {
            if (event.ctrlKey || event.shiftKey) return
            const target = event.target as HTMLElement
            const tab = target.closest(".tab") as HTMLElement | null
            if (tab === null) return
            this.selectTab(tab)
            // Prevent tab from getting added to the regular selection
            event.stopImmediatePropagation()
        })
        this.tabsContainer = tabsContainer

        const tabSelection = new Selection(tabsContainer, {
            isSelectable: (el) => el.classList.contains("tab")
        })

        const multipleTabsSelected = (tab: HTMLElement) =>
            tabSelection.contains(tab) && tabSelection.size() > 1
        let copiedTags: EnhancedTags
        const tabContextMenu = new ContextMenu([
            { title: "Copy tags", icon: "copy", action: (tab) => {
                const instance = this.tabToInstance.get(tab)!
                copiedTags = instance.getGroupedTags()
            }, condition: (tab) => {
                return !multipleTabsSelected(tab) &&
                    this.tabToInstance.get(tab)!.getGroupedTags().groupToTags.size > 0
            } },
            { title: "Paste tags", icon: "paste", action: (tab) => {
                const instance = this.tabToInstance.get(tab)!
                instance.insertGroupedTags(copiedTags)
            }, condition: (tab) => {
                return !multipleTabsSelected(tab) && copiedTags !== undefined
            } },
            { title: "Close tab", icon: "trash", action: (tab) => {
                if (this.selectedTab === tab) {
                    if (tab.previousElementSibling !== null) {
                        this.selectTab(tab.previousElementSibling as HTMLElement)
                    } else if (tab.nextElementSibling !== null) {
                        this.selectTab(tab.nextElementSibling as HTMLElement)
                    } else {
                        this.addTab()
                    }
                }
                tab.remove()
                if (tabsContainer.children.length === 1 && !this.settings.showTabs) {
                    this.mainWrapper.classList.remove("partial-scrolling")
                    this.tabsWrapper.classList.add("hidden")
                }
            }, condition: (tab) => {
                return !multipleTabsSelected(tab)
            } },

            { title: "Close selected", icon: "trash", action: () => {
                let prevTab: HTMLElement | null = this.selectedTab
                while (true) {
                    prevTab = prevTab.previousElementSibling as HTMLElement | null
                    if (prevTab === null) break
                    if (tabSelection.contains(prevTab)) continue
                    this.selectTab(prevTab as HTMLElement)
                    break
                }
                if (prevTab === null) {
                    let nextTab: HTMLElement | null = this.selectedTab
                    while (true) {
                        nextTab = nextTab.nextElementSibling as HTMLElement | null
                        if (nextTab === null) break
                        if (tabSelection.contains(nextTab)) continue
                        this.selectTab(nextTab as HTMLElement)
                        break
                    }
                    if (nextTab === null) {
                        this.addTab()
                    }
                }
                for (const otherTab of tabSelection.get()) {
                    otherTab.remove()
                }
                if (tabsContainer.children.length === 1 && !this.settings.showTabs) {
                    this.mainWrapper.classList.remove("partial-scrolling")
                    this.tabsWrapper.classList.add("hidden")
                }
            }, condition: (tab) => {
                return multipleTabsSelected(tab)
            } },

            { title: "Upload to pool", icon: "upload", action: async () => {
                const poolName = window.prompt("Enter a name for the pool")
                if (!poolName) return
                const selectedTabs = [...tabSelection.get()]
                const postIds = await this.uploadTabs(selectedTabs)
                if (postIds === undefined) return
                let poolId: string
                const authErrorMessage = "Not authenticated (you need to " +
                    "set your API key and username in the extension settings)"
                try {
                    poolId = await this.api.createPool(poolName)
                } catch (error) {
                    if (error instanceof AuthError) {
                        window.alert(authErrorMessage)
                    } else {
                        window.alert("Failed to create pool.")
                    }
                    return
                }
                try {
                    await this.api.addToPool(postIds, poolId)
                } catch (error) {
                    if (error instanceof AuthError) {
                        window.alert(authErrorMessage)
                    } else {
                        window.alert("Failed to add posts to pool.")
                    }
                }
            }, condition: multipleTabsSelected }
        ])
        tabContextMenu.attachToMultiple(tabsContainer, ".tab", (e) => e)

        const addTabButton = E("div", { class: "tab add-tab-button" }, [
            E("div", { class: "tab-status" }, "+")
        ])
        addTabButton.addEventListener("click", () => this.addTab())

        // Make it possible to drag pictures on new-tab-button as a shortcut
        addTabButton.addEventListener("dragover", (event) => {
            event.preventDefault()
        })
        addTabButton.addEventListener("drop", (event) => {
            event.preventDefault()
            addTabButton.classList.remove("dragover")
            if (!event.dataTransfer) return
            const tab = this.addTab()
            const instance = this.tabToInstance.get(tab)!
            instance.passDroppedFile(event.dataTransfer)
        })
        addTabButton.addEventListener("dragenter", () => {
            addTabButton.classList.add("dragover")
        })
        addTabButton.addEventListener("dragleave", () => {
            addTabButton.classList.remove("dragover")
        })

        const tabsWrapper = E("div", { class: "tabs-wrapper" }, [
            tabsContainer, addTabButton
        ])
        this.tabsWrapper = tabsWrapper
        if (!settings.showTabs) tabsWrapper.classList.add("hidden")

        const interfaceWrapper = E("div", { class: "interface-wrapper" })
        this.interfaceWrapper = interfaceWrapper
        const largeImagePreviewWrapper = E("div", { class: "large-image-preview-wrapper" })
        this.largeImagePreviewWrapper = largeImagePreviewWrapper

        // Create a status message for upload result or errors
        const uploadStatus = E("div", { class: "upload-status hidden" })
        this.uploadStatus = uploadStatus

        // Create a button to reset components for a new upload
        const resetButton = E("button", { class: "styled-button" }, "Clear")
        resetButton.addEventListener("click", () => {
            this.resetTab(this.selectedTab)
        })

        // Create a button for submitting the data
        const uploadButton = E("button", { class: "styled-button upload-button" }, "Upload")
        uploadButton.addEventListener("click", async () => {
            this.uploadTabs([this.selectedTab])
        })
        this.uploadButton = uploadButton as HTMLButtonElement

        // Put buttons next to each other, upload status to the right
        const buttonContainer = E("div", { class: "buttons-container" }, [
            uploadButton,
            resetButton,
            uploadStatus
        ])

        this.mainWrapper = E("div", { class: "main-wrapper" }, [
            tabsWrapper, interfaceWrapper, buttonContainer
        ])
        if (settings.showTabs) this.mainWrapper.classList.add("partial-scrolling")
        this.root = E("div", { class: "main-interface-wrapper" }, [
            this.mainWrapper
        ])

        if (settings.showLargeImagePreview) {
            this.root.classList.add("large-image-preview-enabled")
            this.root.appendChild(largeImagePreviewWrapper)
        }

        // If Ctrl + C is pressed, try to copy selected tags in the active tab
        window.addEventListener("keydown", (event) => {
            if ((event.key === "c" || event.key === "x") && event.ctrlKey) {
                const instance = this.tabToInstance.get(this.selectedTab)!
                const tagsCopied = instance.copyTags(event.key === "x")
                if (tagsCopied) event.preventDefault()
            }
        })

        // When F2 is pressed, open the wiki page for the currently relevant tag
        window.addEventListener("keydown", (event) => {
            if (event.key !== "F2") return
            const instance = this.tabToInstance.get(this.selectedTab)!
            const activeInput = instance.getLastActiveInput()
            if (!activeInput) return
            const hoveredCompletion = activeInput.getHoveredCompletion()
            if (hoveredCompletion) {
                this.wikiModal.openPage(hoveredCompletion.title)
                return
            }
            const currentInput = activeInput.getCurrentInput()
            if (currentInput) {
                this.wikiModal.openPage(currentInput)
                return
            }
        })

        this.addTab()
    }

    addTab(select=true) {
        const number = this.tabsContainer.children.length + 1
        const imagePreview = E("img", { class: "small preview" }) as HTMLImageElement
        const statusContainer = E("div", { class: "tab-status" }, `Tab ${number}`)
        const tab = E("div", { class: "tab" }, [statusContainer, imagePreview])
        const uploadInstance = new UploadInterface(
            this.api, this.wikiModal, this.settings)
        this.tabToInstance.set(tab, uploadInstance)
        this.tabToScrollTop.set(tab, 0)
        this.setTabStatus(tab, TabStatus.Empty)
        this.tabsContainer.appendChild(tab)
        const instanceElement = uploadInstance.getElement()
        instanceElement.classList.add("hidden")
        this.interfaceWrapper.appendChild(instanceElement)
        uploadInstance.addFileUploadListener((objectUrl) => {
            imagePreview.src = objectUrl
            statusContainer.classList.remove("success", "failure", "uploaded")
            statusContainer.textContent = "Checking..."
            this.setTabStatus(tab, TabStatus.Checking)
            uploadInstance.clearPixivTags()
        })
        uploadInstance.addStatusCheckListener((matchIds) => {
            const status = this.tabToStatus.get(tab)
            if (status !== TabStatus.Checking) return
            this.setTabStatus(tab, TabStatus.Checked)
            if (matchIds.length === 0) {
                statusContainer.textContent = `Checked ✔`
                statusContainer.classList.add("success")
            } else {
                statusContainer.textContent = matchIds.length === 1 ?
                    `1 match` : `${matchIds.length} matches`
                statusContainer.classList.add("failure")
            }
        })
        if (this.tabsContainer.children.length > 1 && !this.settings.showTabs) {
            this.mainWrapper.classList.add("partial-scrolling")
            this.tabsWrapper.classList.remove("hidden")
        }
        if (select) this.selectTab(tab)
        return tab
    }

    async uploadTabs(tabs: HTMLElement[]): Promise<number[] | undefined> {
        let encounteredError = false
        for (const tab of tabs) {
            const statusContainer = tab.querySelector(".tab-status")!
            const instance = this.tabToInstance.get(tab)!
            const error = instance.checkData() 
            if (error) {
                statusContainer.classList.add("failure")
                statusContainer.innerHTML = "Upload failed"
                this.setTabStatus(tab, TabStatus.UploadFailed, error)
                encounteredError = true
            }
        }

        // If the data is invalid in at least one tab, abort all uploads
        if (encounteredError) {
            if (tabs.length > 1) {
                showInfoModal(`
                    Cannot upload all of the selected tabs
                    because some contain incomplete/invalid data.
                `)
            }
            return
        }

        // Set status of all tabs at once
        for (const tab of tabs) {
            const statusContainer = tab.querySelector(".tab-status")!
            statusContainer.classList.remove("failure", "success", "uploaded")
            statusContainer.innerHTML = "Uploading..."
            this.setTabStatus(tab, TabStatus.Uploading, "Queued for upload...")
        }

        // Upload one tab after another in the given order
        const resultIds: number[] = []
        let someUploadFailed = false
        for (const tab of tabs) {
            this.setTabStatus(tab, TabStatus.Uploading, "Waiting for server response...")
            const statusContainer = tab.querySelector(".tab-status")!
            const instance = this.tabToInstance.get(tab)!
            const uploadData = instance.getData()
            const result = await this.api.createPost(uploadData)
            if (result.successful) {
                const postLink = `<a target="_blank" href="${result.url}">${result.postId}</a>`
                statusContainer.classList.add("uploaded")
                statusContainer.innerHTML = "Uploaded!"
                this.setTabStatus(tab, TabStatus.UploadSuccess, "Upload successful! Created post with ID " + postLink)
                resultIds.push(result.postId)

                // Notify associated extensions if an image from Pixiv has been uploaded
                if (uploadData.pixivId) {
                    const statusUpdate: StatusUpdate = {
                        host: this.api.host,
                        pixivId: uploadData.pixivId,
                        filename: uploadData.file.name,
                        postIds: [result.postId]
                    }
                    browser.runtime.sendMessage({
                        type: Message.NotifyAssociatedExtensions,
                        args: statusUpdate
                    })
                }
            } else {
                statusContainer.classList.add("failure")
                statusContainer.innerHTML = "Upload failed"
                this.setTabStatus(tab, TabStatus.UploadFailed, result.error)
                someUploadFailed = true
            }
        }
        return someUploadFailed ? undefined : resultIds
    }

    selectTab(tab: HTMLElement) {
        if (tab === this.selectedTab) return
        if (this.selectedTab) {
            this.selectedTab.classList.remove("main-selected")
            this.tabToScrollTop.set(this.selectedTab, this.interfaceWrapper.scrollTop)
            const selectedInstance = this.tabToInstance.get(this.selectedTab)!
            selectedInstance.getElement().classList.add("hidden")
        }
        const instance = this.tabToInstance.get(tab)!
        instance.getElement().classList.remove("hidden")
        this.interfaceWrapper.scrollTop = this.tabToScrollTop.get(tab)!
        this.selectedTab = tab
        this.selectedTab.classList.add("main-selected")
        this.selectedTab.scrollIntoView({ block: "nearest" })
        this.setTabStatus(tab, this.tabToStatus.get(tab)!, this.tabToStatusMessage.get(tab)!)
        if (this.settings.showLargeImagePreview) {
            if (this.largeImagePreviewWrapper.firstChild)
                this.largeImagePreviewWrapper.firstChild.remove()
            this.largeImagePreviewWrapper.appendChild(instance.getLargeImagePreview())
        }
    }
    
    resetTab(tab: HTMLElement) {
        const instance = this.tabToInstance.get(tab)!
        instance.reset()
        this.setTabStatus(this.selectedTab, TabStatus.Empty)
        const imagePreview = this.selectedTab.querySelector("img")!
        imagePreview.removeAttribute("src")
        const filename = this.tabToFilename.get(tab)
        if (filename) this.filenameToTab.delete(filename)
        this.tabToFilename.delete(tab)
        const tabNumber = [...this.tabsContainer.children].indexOf(this.selectedTab) + 1
        const statusContainer = this.selectedTab.querySelector(".tab-status")!
        statusContainer.innerHTML = `Tab ${tabNumber}`
        statusContainer.classList.remove("failure", "success", "uploaded")
    }

    private setTabStatus(tab: HTMLElement, status: TabStatus, text="") {
        this.tabToStatus.set(tab, status)
        this.tabToStatusMessage.set(tab, text)
        if (tab !== this.selectedTab) return
        this.uploadButton.disabled = status === TabStatus.Uploading
                 || status === TabStatus.Empty || status === TabStatus.UploadSuccess
        this.uploadStatus.classList.toggle("hidden", status === TabStatus.Empty)
        this.uploadStatus.classList.toggle("failure", status === TabStatus.UploadFailed)
        this.uploadStatus.classList.toggle("success", status === TabStatus.UploadSuccess)
        this.uploadStatus.innerHTML = text
    }

    addFile(dataTransfer: DataTransfer, pixivTags: { [key in string]: string }) {
        let firstEmptyTab
        for (const tab of this.tabsContainer.children) {
            const instance = this.tabToInstance.get(tab as HTMLElement)!
            if (instance.isEmpty()) {
                firstEmptyTab = tab as HTMLElement
                break
            }
        }
        if (!firstEmptyTab) {
            firstEmptyTab = this.addTab(false)
        }
        const filename = dataTransfer.files[0].name
        this.filenameToTab.set(filename, firstEmptyTab)
        this.tabToFilename.set(firstEmptyTab, filename)
        const instance = this.tabToInstance.get(firstEmptyTab)!
        const checkResult = instance.passDroppedFile(dataTransfer)
        // Timeout is needed so on-upload handler doesn't immediately clear tags again
        setTimeout(() => instance.displayPixivTags(pixivTags), 0)
        return checkResult
    }

    focusTabByFilename(filename: string): boolean {
        const tab = this.filenameToTab.get(filename)
        if (!tab) return false
        this.selectTab(tab)
        return true
    }
}
