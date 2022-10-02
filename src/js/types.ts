export interface Settings {
    userId: string
    apiKey: string
    tagGroups: string[]
    autoSelectFirstCompletion: boolean
    separateTagsWithSpace: boolean
    showLargeImagePreview: boolean
    splitTagInputIntoGroups: boolean
    showTabs: boolean
    hideTitleInput: boolean
    minimumPostCount: number
    searchDelay: number
}

export type SettingType = "boolean" | "string" | "string-list" | "integer"

export type SettingsDefinition = {
    [key in keyof Settings]: {
        type: SettingType,
        text: string,
        details?: string,
        subSettings?: (keyof Settings)[]
    }
}