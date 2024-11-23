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
    id?: number,
    title: string,
    type: TagType,
    postCount: number,
    ambiguous?: boolean
    synonyms?: string[]
}

export interface BooruPost {
    id: number
    md5: string
    source: string
    thumbnailUrl: string
    score: number
    creationDate: string
    favCount?: number
}

export type PostAttribute = keyof BooruPost

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
    pixivId?: string
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

export type PixivTags = { [key in string]: string }
export interface UploadInstanceData {
    file?: {
        objectUrl: string
        name: string
        type: string
    }
    fileUrl?: string
    title?: string
    source?: string
    tags?: EnhancedTags
    rating?: string
    pixivId?: string
    pixivTags?: PixivTags
}

export interface IndexOptions {
    limit?: number
    customOrder?: boolean
}

export interface BooruApi {
    host: HostName
    isAuthenticated(): boolean
    getUrl(path: string): string
    getPostUrl(id: number): string
    getQueryUrl(tags: string[]): string
    getWikiUrl(name: string): string
    getUploadUrl(): string
    getSettingsUrl(): string
    getSingleTagInfo(tagName: string): Promise<TagInfo | undefined>
    getMultipleTagInfos(tagNames: string[], only?: string[]): Promise<Map<string, TagInfo>>
    getTagCompletions(query: string): Promise<TagInfo[] | undefined>
    setTagType(tagName: string, type: TagType): Promise<boolean>
    getPostInfo(postId: number): Promise<BooruPost>
    searchPosts(tags: string[], options?: IndexOptions): Promise<BooruPost[]>
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

export class ServerError extends Error {
    public status: number

    constructor(status: number, statusText: string) {
        super(`HTTP Error ${status}: ${statusText}`)
        this.name = "ServerError"
        this.status = status
    }
}

export interface StatusUpdate {
    host: HostName
    pixivId: string
    filename: string
    postIds: number[]
    posts?: { [key in number]: BooruPost }
}

export interface ArtistQuery {
    url?: string
    name?: string
}

export enum MessageType {
    QueryIqdb = "query-iqdb",
    GetArtistTag = "get-artist-tag",
    OpenExtensionOptions = "open-extension-options",
    NotifyAssociatedExtensions = "notify-associated-extensions",
    RegisterUploadPageTab = "register-upload-page-tab",
    DownloadPixivImage = "download-pixiv-image",
    DownloadPage = "download-page",
    PrepareUpload = "prepare-upload",
    FocusTab = "focus-tab"
}

export interface EnhancedTags {
    groupToTags: { [key in string]: string[] }
    tagToType: { [key in string]: TagType }
}
