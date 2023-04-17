import browser from "webextension-polyfill"
import { Settings, SettingsDefinition } from "js/types";

type SettingKey = keyof Settings
type SettingValue<Key extends SettingKey> = Settings[Key]

class SettingsManager {
    private static readonly defaults: Settings = {
        autoSelectFirstCompletion: true,
        showLargeImagePreview: true,
        showTabs: false,
        hideTitleInput: true,
        splitTagInputIntoGroups: true,
        tagGroups: [
            "Artist / Characters / Copyright",
            "Face / Hair / Body",
            "Clothing / Exposure",
            "Posture / Gesture / Action",
            "Background / Scene",
            "Other tags"
        ],
        separateTagsWithSpace: false,
        minimumPostCount: 10,
        searchDelay: 80,
        apiKey: "",
        userId: "",
        enableOnDanbooru: false,
        danbooruApiKey: "",
        danbooruUsername: ""
    }

    public static getDefinitions(): SettingsDefinition {
        return {
            autoSelectFirstCompletion: {
                type: "boolean",
                text: "Automatically select the first entry in tag completions"
            },
            showLargeImagePreview: {
                type: "boolean",
                text: "Display a large preview of the uploaded image on the right side of the page"
            },
            showTabs: {
                type: "boolean",
                text: "Show tab bar"
            },
            hideTitleInput: {
                type: "boolean",
                text: "Hide title field"
            },
            splitTagInputIntoGroups: {
                type: "boolean",
                text: "Split input field for tags into multiple fields with custom names",
                subSettings: ["tagGroups"]
            },
            tagGroups: {
                type: "string-list",
                text: "Tag groups (one group per line)"
            },
            separateTagsWithSpace: {
                type: "boolean",
                text: "Separate tags with space bar (use underscores within multi-word tags)"
            },
            minimumPostCount: {
                type: "integer",
                text: "Minimum number of occurrences for a tag to be considered common"
            },
            searchDelay: {
                type: "integer",
                text: "Search delay for tag completions",
                details: "In milliseconds, usually between 0 and 100. Lower delay makes " +
                    "completions more responsive, but also increases flickering."
            },
            apiKey: {
                type: "string",
                text: "Gelbooru API key"
            },
            userId: {
                type: "string",
                text: "Gelbooru account ID"
            },
            enableOnDanbooru: {
                type: "boolean",
                text: "Enable the extension on Danbooru",
                subSettings: ["danbooruApiKey", "danbooruUsername"],
                action: async (enable) => {
                    const danbooruIqdbUrl = "https://danbooru.iqdb.org/"
                    if (enable) {
                        const granted = await browser.permissions.request({
                            "permissions": ["scripting"],
                            "origins": [danbooruIqdbUrl]
                        })
                        if (!granted) return false
                        await SettingsManager.enableDanbooruScript()
                        return true
                    } else {
                        browser.scripting.unregisterContentScripts({
                            ids: ["danbooru-script"]
                        })
                        await browser.permissions.remove({
                            "permissions": ["scripting"],
                            "origins": [danbooruIqdbUrl]
                        })
                        return true
                    }
                }
            },
            danbooruApiKey: {
                type: "string",
                text: "Danbooru API key",
                details: "On Danbooru, the API key is not needed for most of the extension functionality,<br>" +
                    "but it's required for certain actions such as changing tag types or creating pools"
            },
            danbooruUsername: {
                type: "string",
                text: "Danbooru username"
            }
        }
    }

    public static async enableDanbooruScript() {
        const danbooruUrl = "https://danbooru.donmai.us/uploads/new"
        console.log("Registering script.")
        await browser.scripting.registerContentScripts([{
            id: "danbooru-script",
            matches: [danbooruUrl],
            js: ["jquery.js", "contentScript.js"]
        }])
    }

    private static getStorageKey(key: SettingKey): string {
        return "setting-" + key
    }

    public static async set<
        Key extends SettingKey,
        Value extends SettingValue<Key>
    >(key: Key, value: Value) {
        const storageKey = this.getStorageKey(key)
        const storageUpdate = { [storageKey]: value }  
        await browser.storage.sync.set(storageUpdate)
    }

    public static async get<
        Key extends SettingKey,
        Value extends SettingValue<Key>
    >(keys: Key[]): Promise<{ [key in Key]: Value }> {
        const storageKeys = keys.map(key => this.getStorageKey(key))
        const values = await browser.storage.sync.get(storageKeys)
        const keyToValue: any = {}
        for (const key of keys) {
            const storageKey = this.getStorageKey(key)
            keyToValue[key] = values[storageKey] !== undefined ?
                values[storageKey] : this.defaults[key]
        }
        return keyToValue
    }

    public static async remove<
        Key extends SettingKey
    >(key: Key) {
        const storageKey = this.getStorageKey(key)
        await browser.storage.sync.remove(storageKey)
    }

    public static getDefaultValue<
        Key extends SettingKey,
        Value extends SettingValue<Key>
    >(key: Key): Value {
        return this.defaults[key] as Value
    }

    public static async getAll(): Promise<Settings> {
        const keys = Object.keys(SettingsManager.defaults) as (keyof Settings)[]
        const storageKeys = keys.map(key => SettingsManager.getStorageKey(key))
        const values = await browser.storage.sync.get(storageKeys)
        const settings: any = {}
        for (const key of keys) {
            const storageKey = this.getStorageKey(key)
            settings[key] = values[storageKey] !== undefined ?
                values[storageKey] : this.defaults[key]
        }
        return settings as Settings
    }
}

export default SettingsManager
