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
    enableOnDanbooru: boolean
    danbooruApiKey: string
    danbooruUsername: string
}

export type SettingType = "boolean" | "string" | "string-list" | "integer"

export type SettingsDefinition = {
    [key in keyof Settings]: {
        type: SettingType,
        text: string,
        details?: string,
        subSettings?: (keyof Settings)[],
        action?: (value: any) => boolean | Promise<boolean>
    }
}

export type TagType = "artist" | "character" | "copyright" | "metadata" | "tag" | "deprecated"

export interface TagInfo {
    title: string,
    type: TagType,
    postCount: number,
    ambiguous?: boolean
}

export interface BooruPost {
    id: number
    md5: string
    source: string
    thumbnailUrl: string
}

export enum HostName {
    Gelbooru = "gelbooru",
    Danbooru = "danbooru"
}

export interface IqdbSearchParams {
    host: HostName
    fileUrl: string
    filename: string
}
export interface IqdbMatch {
    postId: number
    postUrl: string
    thumbnailUrl: string
    width: number
    height: number
    similarity: number
}
interface IqdbSearchSuccess {
    success: true
    matches: IqdbMatch[]
}
interface IqdbSearchFailure {
    success: false
    error: string
}
export type IqdbSearchResult = IqdbSearchSuccess | IqdbSearchFailure

export interface UploadData {
    file: File
    title: string
    source: string
    tags: string[]
    rating: string
}
export interface UploadSuccess {
    successful: true
    postId: number
    url: string
}
export interface UploadFailure {
    successful: false
    error: string
}
export type UploadResult = UploadSuccess | UploadFailure

export interface BooruApi {
    host: HostName
    isAuthenticated(): boolean
    getPostUrl(id: number): string
    getQueryUrl(tags: string[]): string
    getUploadUrl(): string
    getSettingsUrl(): string
    getTagInfo(tagName: string): Promise<TagInfo | undefined>
    getTagCompletions(query: string): Promise<TagInfo[] | undefined>
    setTagType(tagName: string, type: TagType): Promise<boolean>
    query(tags: string[]): Promise<BooruPost[]>
    searchIqdb(params: IqdbSearchParams): Promise<IqdbSearchResult>
    getWikiPage(tagName: string): Promise<string | null>
    createPost(data: UploadData): Promise<UploadResult>
    createPool(name: string): Promise<string>
    addToPool(postIds: number[], poolId: string): Promise<boolean>
}

export class AuthError extends Error {
    constructor() {
        super("Credentials are required for this action.")
        this.name = "AuthError"
    }
}

export interface StatusUpdate {
    host: HostName
    pixivId: string
    filename: string
    postIds: number[]
}

export enum Message {
    QueryIqdb = "query-iqdb",
    GetArtistTag = "get-artist-tag",
    OpenExtensionOptions = "open-extension-options",
    NotifyAssociatedExtensions = "notify-associated-extensions",
    RegisterUploadPageTab = "register-upload-page-tab"
}
