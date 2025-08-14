import browser from "webextension-polyfill";
import { E, showInfoModal, showConfirmModal, imageToCanvas, loadImage } from "js/utility"
import { Settings, BooruApi, AuthError, StatusUpdate, MessageType, EnhancedTags, HostName, UploadInstanceData, PixivTags } from "js/types"
import ContextMenu from "js/generic/context-menu"
import Component from "js/generic/component"
import Selection from "js/generic/selection"
import UploadInterface from "js/components/upload-interface"
import WikiModal from "js/components/wiki-modal"
import { CheckResult } from "js/components/file-upload";
import DanbooruApi from "js/danbooru-api";
import "./main-interface.scss"

type TabDataStore = {
    [key in string]: {
        title: string
        source: string
        rating: string
        tags: EnhancedTags
    }
}

export enum TabStatus {
    Empty = "empty",
    Checking = "checking",
    CheckFailed = "check-failed",
    Matched = "matched",
    Uploadable = "uploadable",
    Uploading = "uploading",
    UploadSuccess = "upload-success",
    UploadFailed = "upload-failed"
}

const MAX_THUMBNAIL_SIZE = 125

export default class MainInterface extends Component {
    private readonly api: BooruApi
    private readonly settings: Settings
    private readonly wikiModal: WikiModal
    private readonly tabDataStorageKey: string

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
        this.tabDataStorageKey = "tabData-" + api.host

        const tabsContainer = E("div", { class: "tabs-container" })
        tabsContainer.addEventListener("click", (event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey) return
            const target = event.target as HTMLElement
            const tab = target.closest(".tab") as HTMLElement | null
            if (tab === null) return
            this.selectTab(tab)
            // Prevent tab from getting added to the regular selection
            event.stopImmediatePropagation()
        })
        this.tabsContainer = tabsContainer

        const addTabButton = E("div", { class: "tab add-tab-button" }, [
            E("div", { class: "tab-status" }, "+")
        ])
        addTabButton.addEventListener("click", () => this.addTab())

        const tabsWrapper = E("div", { class: "tabs-wrapper" }, [
            tabsContainer, addTabButton
        ])
        this.tabsWrapper = tabsWrapper
        if (!settings.showTabs) tabsWrapper.classList.add("hidden")

        const tabSelection = new Selection(tabsContainer, {
            isSelectable: (el) => el.classList.contains("tab"),
            associatedElements: new Set([tabsWrapper])
        })

        const tabsWrapperContextMenu = new ContextMenu([
            { title: "Close unneeded tabs", action: () => {
                const tabs = new Set<HTMLElement>()
                for (const child of this.tabsContainer.children) {
                    const tab = child as HTMLElement
                    const status = this.tabToStatus.get(tab)
                    if (status === TabStatus.Empty ||
                            status === TabStatus.UploadSuccess ||
                            status === TabStatus.Matched) {
                        tabs.add(tab)
                    }
                }
                this.closeMultipleTabs(tabs)
            } }
        ])
        tabsWrapperContextMenu.attachTo(tabsWrapper, tabsWrapper)

        // For every other image board, create a context menu item which copies
        // over the data of selected tabs to the corresponding upload page
        const hostToLabel: { [key in HostName]: string } = {
            [HostName.Gelbooru]: "Gelbooru",
            [HostName.Danbooru]: "Danbooru"
        }
        const otherHosts = Object.values(HostName).filter(name => name !== api.host)
        const crossSiteItems = []
        for (const host of otherHosts) {
            crossSiteItems.push({
                title: `Upload to ${hostToLabel[host]}`,
                icon: "share",
                action: async (tab: HTMLElement) => {
                    const tabs = multipleTabsSelected(tab) ? tabSelection.get() : [tab]
                    const data: UploadInstanceData[] = []
                    for (const tab of tabs) {
                        const instance =this.tabToInstance.get(tab)!
                        data.push(instance.getEnhancedData())
                    }
                    await browser.runtime.sendMessage({
                        type: MessageType.PrepareUpload,
                        args: { host, data }
                    })
                    if (data[0].file) {
                        browser.runtime.sendMessage({
                            type: MessageType.FocusTab,
                            args: { host, details: { filename: data[0].file.name } }
                        })
                    }
                },
                condition: (tab: HTMLElement) => {
                    const tabs = multipleTabsSelected(tab) ? tabSelection.get() : [tab]
                    for (const tab of tabs) {
                        const instance = this.tabToInstance.get(tab)!
                        if (instance.isEmpty()) return false
                    }
                    return true
                }
            })
        }

        const multipleTabsSelected = (tab: HTMLElement) =>
            tabSelection.contains(tab) && tabSelection.size() > 1
        let copiedTags: EnhancedTags | undefined
        const tabContextMenu = new ContextMenu([
            { title: "Copy tags", icon: "copy", action: (tab) => {
                const instance = this.tabToInstance.get(tab)!
                copiedTags = instance.getGroupedTags()
            }, condition: (tab) => {
                const instance = this.tabToInstance.get(tab)!
                return !multipleTabsSelected(tab) && instance.containsTags()
            } },
            { title: "Paste tags", icon: "paste", action: (tab) => {
                const instance = this.tabToInstance.get(tab)!
                if (copiedTags) instance.insertGroupedTags(copiedTags)
            }, condition: (tab) => {
                return !multipleTabsSelected(tab) && copiedTags !== undefined
            } },
            { title: "Close tab", icon: "trash", action: (tab) => {
                this.closeTab(tab)
            }, condition: (tab) => {
                return !multipleTabsSelected(tab)
            } },

            { title: "Close selected", icon: "trash", action: () => {
                this.closeMultipleTabs(tabSelection.get())
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
            }, condition: multipleTabsSelected },

            { title: "Upload as parent/children", icon: "upload", action: async () => {
                const selectedTabs = [...tabSelection.get()]
                const postIds = await this.uploadTabs(selectedTabs)
                if (postIds === undefined) return
                const parentId = postIds[0]
                const api = this.api as DanbooruApi
                const authErrorMessage = "Not authenticated (you need to " +
                    "set your API key and username in the extension settings)"
                try {
                    for (const postId of postIds.slice(1)) {
                        await api.setParent(postId, parentId)
                    }
                } catch (error) {
                    if (error instanceof AuthError) {
                        window.alert(authErrorMessage)
                    } else {
                        window.alert("Failed to add posts to pool.")
                        console.log(error)
                    }
                }
            }, condition: (tab) => api.host === HostName.Danbooru
                && multipleTabsSelected(tab) },

            ...crossSiteItems
        ])
        tabContextMenu.attachToMultiple(tabsContainer, ".tab", (e) => e)

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

        const interfaceWrapper = E("div", { class: "interface-wrapper" })
        this.interfaceWrapper = interfaceWrapper
        const largeImagePreviewWrapper = E("div", { class: "large-image-preview-wrapper" })
        this.largeImagePreviewWrapper = largeImagePreviewWrapper

        // Create a status message for upload result or errors
        const uploadStatus = E("div", { class: "upload-status hidden" })
        this.uploadStatus = uploadStatus

        // Create a button to reset components for a new upload
        const resetButton = E("button", { class: "styled-button" }, "Clear")
        resetButton.addEventListener("click", async () => {
            const instance = this.tabToInstance.get(this.selectedTab)!
            const status = this.tabToStatus.get(this.selectedTab)
            if (status !== TabStatus.UploadSuccess && !instance.isEmpty()) {
                const confirmed = await showConfirmModal(
                    "Are you sure you want to clear all data?")
                if (!confirmed) return
            }
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

        // If Ctrl + c is pressed, try to copy selected tags in the active tab
        window.addEventListener("keydown", (event) => {
            if ((event.key === "c" || event.key === "x") && (event.ctrlKey || event.metaKey)) {
                const instance = this.tabToInstance.get(this.selectedTab)!
                const tagsCopied = instance.copyTags(event.key === "x")
                if (tagsCopied) event.preventDefault()
            }
        })

        // If Ctrl + s is pressed, save the state of all tabs where tags
        // were entered and a file was added but it hasn't been uploaded yet
        window.addEventListener("keydown", async (event) => {
            if (event.key !== "s" || (!event.ctrlKey && !event.metaKey)) return
            event.preventDefault()
            let numAdded = 0
            let numDeleted = 0
            const storageKey = this.tabDataStorageKey
            const storageData = await browser.storage.local.get(storageKey)
            const dataObject = (storageData[storageKey] || {}) as TabDataStore
            for (const tab of this.tabsContainer.children) {
                const instance = this.tabToInstance.get(tab as HTMLElement)!
                const fileUrl = instance.getFileUrl()
                if (!fileUrl) continue
                const tabStatus = this.tabToStatus.get(tab as HTMLElement)
                if (tabStatus === TabStatus.UploadSuccess ||
                        !instance.containsTags()) {
                    if (fileUrl in dataObject) {
                        delete dataObject[fileUrl]
                        ++numDeleted
                    }
                    continue
                }
                const data = instance.getData()
                const groupedTags = instance.getGroupedTags()
                dataObject[fileUrl] = {
                    title: data.title,
                    source: data.source,
                    tags: groupedTags,
                    rating: data.rating
                }
                ++numAdded
            }
            try {
                await browser.storage.local.set({ [storageKey]: dataObject })
            } catch (e) {
                showInfoModal(
                    `Failed to save data<br>(probably exceeded storage quota)`)
            }
            if (numAdded === 0 && numDeleted === 0) {
                showInfoModal(`There is no data to save or remove.`)
            } else {
                const strings = []
                if (numAdded) strings.push(`Saved the state of ${numAdded} tabs.`)
                if (numDeleted) strings.push(`Removed data for ${numDeleted} tabs.`)
                showInfoModal(strings.join("<br>"))
            }
        })
        // If Ctrl + p is pressed, load all saved data into new tabs
        window.addEventListener("keydown", async (event) => {
            if (event.key !== "p" || (!event.ctrlKey && !event.metaKey)) return
            event.preventDefault()
            const storageKey = this.tabDataStorageKey
            const storageData = await browser.storage.local.get(storageKey)
            const dataObject = (storageData[storageKey] || {}) as TabDataStore

            // Remember which images are already loaded to prevent loading twice
            const loadedFileUrls = new Set<string>()
            for (const tab of this.tabsContainer.children) {
                const instance = this.tabToInstance.get(tab as HTMLElement)!
                const fileUrl = instance.getFileUrl()
                if (fileUrl) loadedFileUrls.add(fileUrl)
            }

            for (const fileUrl in dataObject) {
                if (loadedFileUrls.has(fileUrl)) continue
                const data = dataObject[fileUrl]
                const newTab = this.addTab(false)
                const instance = this.tabToInstance.get(newTab)!
                instance.insertData({
                    title: data.title,
                    source: data.source,
                    rating: data.rating
                })
                instance.insertGroupedTags(data.tags)
                instance.setFileUrl(fileUrl)
            }
        })

        // If F2 is pressed, open the wiki page for the currently relevant tag
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
        document.body.style.setProperty(
            "--max-thumbnail-size", `${MAX_THUMBNAIL_SIZE}px`)
    }

    addTab(select=true) {
        const number = this.tabsContainer.children.length + 1
        const imagePreviewWrapper = E("div")
        const statusContainer = E("div", { class: "tab-status" }, `Tab ${number}`)
        const tab = E("div", { class: "tab" }, [statusContainer, imagePreviewWrapper])
        const uploadInstance = new UploadInterface(
            this.api, this.wikiModal, this.settings)
        this.tabToInstance.set(tab, uploadInstance)
        this.tabToScrollTop.set(tab, 0)
        this.setTabStatus(tab, TabStatus.Empty)
        this.tabsContainer.appendChild(tab)
        const instanceElement = uploadInstance.getElement()
        instanceElement.classList.add("hidden")
        this.interfaceWrapper.appendChild(instanceElement)
        uploadInstance.addFileUploadListener(async (objectUrl) => {
            uploadInstance.clearPixivTags()
        
            // Load large image preview
            if (this.selectedTab === tab && this.settings.showLargeImagePreview) {
                if (this.largeImagePreviewWrapper.firstChild)
                    this.largeImagePreviewWrapper.firstChild.remove()
                this.largeImagePreviewWrapper.appendChild(
                        uploadInstance.getLargeImagePreview())
            }

            // Draw a downsized thumbnail on a canvas element
            const divisor = MAX_THUMBNAIL_SIZE * window.devicePixelRatio
            const image = await loadImage(objectUrl)
            const shrinkFactor = image.width > image.height ?
                image.width / divisor : image.height / divisor
            const thumbnail = imageToCanvas(image, {
                width: image.width / shrinkFactor,
                height: image.height / shrinkFactor
            })
            thumbnail.classList.add("thumbnail")
            imagePreviewWrapper.innerHTML = ""
            imagePreviewWrapper.appendChild(thumbnail)

            // Load saved data if available
            const storageKey = this.tabDataStorageKey
            const storageData = await browser.storage.local.get(storageKey)
            const saveData = storageData[storageKey] as TabDataStore | undefined
            if (!saveData) return
            const fileUrl = uploadInstance.getFileUrl()
            const tabData = saveData[fileUrl]
            if (!tabData) return
            uploadInstance.insertData({
                title: tabData.title,
                source: tabData.source,
                rating: tabData.rating
            })
            uploadInstance.insertGroupedTags(tabData.tags)
        })
        uploadInstance.addCheckStartListener((checkType) => {
            statusContainer.textContent = "Checking..."
            this.setTabStatus(tab, TabStatus.Checking)
        })
        uploadInstance.addCheckResultListener((checkResult) => {
            const status = this.tabToStatus.get(tab)
            if (status !== TabStatus.Checking) return
            if (!checkResult.postIds) {
                statusContainer.textContent = `Check failed`
                this.setTabStatus(tab, TabStatus.CheckFailed)
                return
            }
            if (checkResult.postIds.length === 0) {
                statusContainer.textContent = `Checked`
                this.setTabStatus(tab, TabStatus.Uploadable)
            } else {
                statusContainer.textContent = checkResult.postIds.length === 1 ?
                    `1 match` : `${checkResult.postIds.length} matches`
                this.setTabStatus(tab, TabStatus.Matched)
            }
        })
        if (this.tabsContainer.children.length > 1 && !this.settings.showTabs) {
            this.mainWrapper.classList.add("partial-scrolling")
            this.tabsWrapper.classList.remove("hidden")
        }
        if (select) this.selectTab(tab)
        return tab
    }

    closeTab(tab: HTMLElement) {
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
        if (this.tabsContainer.children.length === 1 && !this.settings.showTabs) {
            this.mainWrapper.classList.remove("partial-scrolling")
            this.tabsWrapper.classList.add("hidden")
        }
        const filename = this.tabToFilename.get(tab)
        if (filename) this.filenameToTab.delete(filename)
        const uploadInstance = this.tabToInstance.get(tab)
        if (uploadInstance) uploadInstance.reset()
    }

    closeMultipleTabs(tabs: Set<HTMLElement>) {
        // If the currently open tab is among the deleted, find a new one to open
        if (tabs.has(this.selectedTab)) {
            // First, try to find a remaining tab among the following ones
            let prevTab: HTMLElement | null = this.selectedTab
            while (true) {
                prevTab = prevTab.previousElementSibling as HTMLElement | null
                if (prevTab === null) break
                if (tabs.has(prevTab)) continue
                this.selectTab(prevTab as HTMLElement)
                break
            }
            // If no tab was found, try to find one among the previous tabs
            if (prevTab === null) {
                let nextTab: HTMLElement | null = this.selectedTab
                while (true) {
                    nextTab = nextTab.nextElementSibling as HTMLElement | null
                    if (nextTab === null) break
                    if (tabs.has(nextTab)) continue
                    this.selectTab(nextTab as HTMLElement)
                    break
                }
                // If there's no tab left to open, create a new empty one
                if (nextTab === null) {
                    this.addTab()
                }
            }
        }
        for (const tab of tabs) {
            tab.remove()
        }
        if (this.tabsContainer.children.length === 1 && !this.settings.showTabs) {
            this.mainWrapper.classList.remove("partial-scrolling")
            this.tabsWrapper.classList.add("hidden")
        }
    }

    async uploadTabs(tabs: HTMLElement[]): Promise<number[] | undefined> {
        // Check if all tabs contain valid data
        let encounteredError = false
        for (const tab of tabs) {
            const statusContainer = tab.querySelector(".tab-status")!
            const instance = this.tabToInstance.get(tab)!
            const error = instance.checkData() 
            if (error) {
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
                        type: MessageType.NotifyAssociatedExtensions,
                        args: statusUpdate
                    })
                }
                // Delete saved data if it exists
                const storageKey = this.tabDataStorageKey
                const storageData = await browser.storage.local.get(storageKey)
                const data = storageData[storageKey] as TabDataStore | undefined
                const fileUrl = instance.getFileUrl()
                if (data && fileUrl in data) {
                    delete data[fileUrl]
                    await browser.storage.local.set({ [storageKey]: data })
                }
            } else {
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
    }

    private setTabStatus(tab: HTMLElement, status: TabStatus, text="") {
        this.tabToStatus.set(tab, status)
        this.tabToStatusMessage.set(tab, text)
        tab.classList.remove("failure", "success", "uploaded")
        const failStatuses =
            [TabStatus.UploadFailed, TabStatus.Matched, TabStatus.CheckFailed]
        let tabClass = ""
        if (status === TabStatus.Uploadable) {
            tabClass = "success"
        } else if (status === TabStatus.UploadSuccess) {
            tabClass = "uploaded"
        } else if (failStatuses.includes(status)) {
            tabClass = "failure"
        }
        if (tabClass) tab.classList.add(tabClass)
        if (tab !== this.selectedTab) return
        this.uploadButton.disabled = status === TabStatus.Uploading
                 || status === TabStatus.Empty || status === TabStatus.UploadSuccess
        this.uploadStatus.classList.toggle("hidden", status === TabStatus.Empty)
        this.uploadStatus.classList.toggle("failure", status === TabStatus.UploadFailed)
        this.uploadStatus.classList.toggle("success", status === TabStatus.UploadSuccess)
        this.uploadStatus.innerHTML = text
    }

    async addData(dataList: UploadInstanceData[]): Promise<(CheckResult | undefined)[]> {
        const emptyTabs: HTMLElement[] = []
        const fileUrlToTab = new Map<string, HTMLElement>()
        for (const tab of this.tabsContainer.children) {
            const instance = this.tabToInstance.get(tab as HTMLElement)!
            const fileUrl = instance.getFileUrl()
            if (fileUrl) {
                fileUrlToTab.set(fileUrl, tab as HTMLElement)
            } else if (instance.isEmpty()) {
                emptyTabs.push(tab as HTMLElement)
            }
        }
        emptyTabs.reverse()

        const promises: Promise<CheckResult | undefined>[] = []
        for (const data of dataList) {
            let tab: HTMLElement
            if (data.fileUrl && fileUrlToTab.has(data.fileUrl)) {
                tab = fileUrlToTab.get(data.fileUrl)!
            } else {
                if (emptyTabs.length > 0) {
                    tab = emptyTabs.pop()!
                } else {
                    tab = this.addTab(false)
                }
            }
            if (data.file) {
                this.filenameToTab.set(data.file.name, tab)
                this.tabToFilename.set(tab, data.file.name)
            }
            const instance = this.tabToInstance.get(tab)!
            // Important: set file URL immediately to prevent the tab from being
            // simulataneously assigned data from other asynchronous requests.
            // `insertEnhancedData` sets URL too, but not synchronously.
            instance.setFileUrl(data.fileUrl || "")
            promises.push(instance.insertEnhancedData(data))
        }

        return Promise.all(promises)
    }

    focusTabByFilename(filename: string): boolean {
        const tab = this.filenameToTab.get(filename)
        if (!tab) return false
        this.selectTab(tab)
        return true
    }
}
