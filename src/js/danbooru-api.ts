import { TagInfo, TagType, BooruApi, BooruPost, AuthError, HostName, UploadData, UploadResult, IqdbSearchParams, IqdbSearchResult, Message, ServerError } from "js/types"
import IQDB from "js/iqdb-search"
import browser, { search } from "webextension-polyfill";
import { wikiPageToHtml, unescapeHtml } from "js/utility"

const origin = "https://danbooru.donmai.us"

interface Credentials {
    apiKey: string
    username: string
}

// Format returned by completion API
interface RawTagCompletion {
    antecedent: string
    category: number
    label: string
    post_count: number
    type: "tag-word"
    value: string
}

// Format returned by tags API
interface RawTagInfo {
    id: number  // > 0
    name: string
    category: number
    post_count: number
    is_locked: boolean
    is_deprecated: boolean
    created_at: string
    updated_at: string
}

// Format returned by post API
interface RawPost {
    id: number
    md5: string
    source: string
    preview_file_url: string
    score: number
    fav_count: number
    created_at: string
    // uploader_id: number
    // approver_id: number
    // rating: "g" | "s" | "q" | "e"
}

const postAttributes = [
    "id", "md5", "source", "preview_file_url",
    "score", "fav_count", "created_at"
]

interface CreateUploadParams {
    source?: string
    tag_string?: string
    rating?: string
    parent_id?: number
    artist_commentary_title?: string
    artist_commentary_desc?: string
    artist_translated_commentary_title?: string
    artist_translated_commentary_desc?: string
}

interface CreateUploadResponse {
    id: number
    status: string
    error: string | null
    message: string
}

interface MediaAsset {
    id: number
    upload_id: number
    media_asset_id: number
}

interface UploadInfo {
    error: string | null
    upload_media_assets: MediaAsset[]
}

interface WikiPage {
    id: number
    title: string
    body: string
    other_names: string[]
    is_deleted: boolean
    is_locked: boolean
    created_at: string
    updated_at: string
}

interface RawArtistInfo {
    id: number
    name: string
    other_names: string[]
    is_banned: boolean
    is_deleted: boolean
}

interface ArtistInfo {
    name: string
    isBanned: boolean
}

const numberToTagType: { [key in number]: TagType } = {
    0: "tag",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "metadata",
    6: "deprecated"  // This is probably not used on Danbooru
}
const tagTypeToNumber: { [key in TagType]: number } = {
    "tag": 0,
    "artist": 1,
    "copyright": 3,
    "character": 4,
    "metadata": 5,
    "deprecated": 6
}

export default class DanbooruApi implements BooruApi {
    readonly host = HostName.Danbooru
    private readonly credentials: Credentials | undefined
    private readonly csrfToken: string | undefined

    constructor(credentials?: Credentials, csrfToken?: string) {
        this.credentials = credentials
        this.csrfToken = csrfToken
    }

    isAuthenticated(): boolean {
        return this.credentials !== undefined || !!this.csrfToken
    }

    getQueryUrl(tags: string[]): string {
        const encodedTags = tags.map(tag => encodeURIComponent(tag))
        return origin + "/posts?tags=" + encodedTags.join("+")
    }

    getPostUrl(id: number): string {
        return origin + "/posts/" + id.toString()
    }

    getUploadUrl(): string {
        return origin + "/uploads/new"
    }

    getSettingsUrl(): string {
        return origin + "/profile"
    }

    private processRawTagInfo(info: RawTagInfo): TagInfo {
        const { id, name, post_count, category, is_deprecated } = info
        return {
            id,
            title: name,
            type: is_deprecated ? "deprecated" : numberToTagType[category],
            postCount: post_count
        }
    }

    private async getSingleRawTagInfo(tagName: string): Promise<RawTagInfo | null> {
        const params = new URLSearchParams({
            "search[name]": tagName.replaceAll(" ", "_")
        })
        const url = origin + "/tags.json?" + params.toString()
        const response = await fetch(url, {
            credentials: "same-origin",  // Send cookies instead of API key
        })
        const responseData = await response.json() as RawTagInfo[]
        if (responseData.length === 0) return null
        return responseData[0]
    }

    async getSingleTagInfo(tagName: string): Promise<TagInfo | undefined> {
        const rawTagInfo = await this.getSingleRawTagInfo(tagName)
        if (rawTagInfo === null) return
        return this.processRawTagInfo(rawTagInfo)
    }

    private async getMultipleRawTagInfos(tagNames: string[]): Promise<RawTagInfo[]> {
        const tagList = tagNames.map(tag => tag.replaceAll(" ", "_")).join(",")
        const params = new URLSearchParams({
            "search[name_normalize]": tagList,
            "limit": "100"
        })
        const url = origin + "/tags.json?" + params.toString()
        const response = await fetch(url, {
            credentials: "same-origin",  // Send cookies instead of API key
        })
        return await response.json() as RawTagInfo[]
    }

    async getMultipleTagInfos(tagNames: string[]): Promise<Map<string, TagInfo>> {
        const rawInfos = await this.getMultipleRawTagInfos(tagNames)
        const map = new Map<string, TagInfo>()
        for (const rawInfo of rawInfos) {
            map.set(unescapeHtml(rawInfo.name), this.processRawTagInfo(rawInfo))
        }
        return map
    }

    async getTagCompletions(query: string): Promise<TagInfo[] | undefined> {
        let response
        // Append an asterisk to disable fuzzy search
        if (!query.endsWith("*")) query += "*"
        const params = new URLSearchParams({
            "search[query]": query,
            "search[type]": "tag_query",
            "version": "1",
            "limit": "10"
        })
        try {
            response = await fetch(origin + "/autocomplete?" + params.toString(), {
                credentials: "same-origin",  // Send cookies
                headers: { "Accept": "application/json" }
            })
        } catch (error) {
            return
        }
        if (!response.ok) return []
        const responseData = await response.json() as RawTagCompletion[]
        return responseData.map(({ category, label, post_count, antecedent }) => ({
            type: numberToTagType[category],
            title: label,
            postCount: post_count,
            synonyms: antecedent ? [antecedent] : []
        }))
    }

    async setTagType(tagName: string, tagType: TagType): Promise<boolean> {
        if (!this.credentials) return false
        const { username, apiKey } = this.credentials
        try {
            const rawTagInfo = await this.getSingleRawTagInfo(tagName)
            if (rawTagInfo === null) return false
            const tagId = rawTagInfo.id
            const authParams = new URLSearchParams({
                "login": username,
                "api_key": apiKey,
            })
            const url = `${origin}/tags/${tagId}.json?${authParams.toString()}`
            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    tag: {
                        category: tagTypeToNumber[tagType]
                    }
                })
            })
            return response.ok
        } catch (error) {
            return false
        }
    }

    private normalizePost(rawPost: RawPost): BooruPost {
        const { id, md5, source, preview_file_url,
            score, fav_count, created_at } = rawPost
        return {
            id, md5, source, score,
            thumbnailUrl: preview_file_url,
            favCount: fav_count,
            creationDate: created_at
        }
    }

    async getPostInfo(postId: number): Promise<BooruPost> {
        const url = origin + `/posts/${postId}.json`
        const response = await fetch(url, { credentials: "same-origin" })
        if (!response.ok) throw new Error(`Failed with status ${response.status}.`)
        const rawPost = await response.json() as RawPost
        return this.normalizePost(rawPost)
    }

    async searchPosts(tags: string[], limit?: number): Promise<BooruPost[]> {
        const fullResults = []
        let pid = 0
        if (!limit) limit = 1000
        const pageSize = Math.min(100, limit)
        while (pageSize * pid < limit) {
            const params = new URLSearchParams({
                "format": "json",
                "post[tags]": tags.join(" "),
                "limit": pageSize.toString(),
                "page": pid.toString(),
                "only": postAttributes.join(",")
            })
            const url = origin + "/posts.json?" + params.toString()
            const response = await fetch(url, {
                credentials: "same-origin"  // Send cookies instead of API key
            })
            const results = await response.json() as RawPost[]
            if (results.length === 0) break
            fullResults.push(...results)
            if (results.length < pageSize) break
            pid += 1
        }
        return fullResults.map(rawPost => this.normalizePost(rawPost))
    }

    async searchIqdb(params: IqdbSearchParams): Promise<IqdbSearchResult> {
        const result = await IQDB.search(params)
        if (!result.success) return result
        return {
            success: true,
            matches: result.matches.map(match => ({
                ...match,
                postId: parseInt(match.postUrl.split("/").slice(-1)[0])
            }))
        }
    }

    async getWikiPage(tagName: string): Promise<string | null> {
        const params = new URLSearchParams({
            "search[title_eq]": tagName.replaceAll(" ", "_")
        })
        const url = origin + "/wiki_pages.json?" + params.toString()
        const response = await fetch(url, {
            credentials: "same-origin"  // Send cookies instead of API key
        })
        const pages = await response.json() as WikiPage[]
        if (pages.length === 0) return null
        return wikiPageToHtml(pages[0].body, {
            separator: "\r\n"
        })
    }

    async createPostUsingApi(data: UploadData): Promise<UploadResult> {
        // Upload the image first
        const uploadFormData = new FormData()
        uploadFormData.set("upload[files][0]", data.file)
        const uploadResponse = await fetch(origin + "/uploads.json", {
            method: "POST",
            credentials: "same-origin",
            body: uploadFormData
        })
        const uploadResponseObject = await uploadResponse.json() as CreateUploadResponse
        if (uploadResponseObject.error) {
            const error = `Image upload failed (${uploadResponseObject.message})`
            return { successful: false, error }
        }
        const uploadId = uploadResponseObject.id

        // Get info about the media asset associated with the uploaded image
        const showUploadResponse = await fetch(origin + `/uploads/${uploadId}.json`, {
            credentials: "same-origin",
        })
        const showUploadResponseObject = await showUploadResponse.json() as UploadInfo
        if (showUploadResponseObject.error) {
            const error = `Image upload failed (${showUploadResponseObject.error})`
            return { successful: false, error }
        }

        // Create a new post
        const mediaAsset = showUploadResponseObject.upload_media_assets[0]
        const postData: CreateUploadParams = {}
        if (data.source) postData.source = data.source
        if (data.title) postData.artist_commentary_title = data.title
        if (data.tags.length) postData.tag_string = data.tags.join(" ")
        if (data.rating) postData.rating = data.rating
        const postUrl = origin + "/posts.json"
        const postResponse = await fetch(postUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                authenticity_token: this.csrfToken,
                media_asset_id: mediaAsset.media_asset_id,
                upload_media_asset_id: mediaAsset.id,
                post: postData
            })
        })
        if (!postResponse.ok) {
            let details
            if (postResponse.status === 422) {
                details = "upload limit reached"
            } else {
                details = `status code ${postResponse.status}`
            }
            const error = `Failed to create post (${details})`
            return { successful: false, error }
        }
        const postResponseObject = await postResponse.json() as RawPost
        const postId = postResponseObject.id
        return { successful: true, postId, url: this.getPostUrl(postId) }
    }

    async createPost(data: UploadData): Promise<UploadResult> {
        return this.createPostUsingApi(data)
    }

    async createPool(name: string): Promise<string> {
        if (!this.credentials) throw new AuthError()
        const { username, apiKey } = this.credentials
        const authParams = new URLSearchParams({
            "login": username,
            "api_key": apiKey
        })
        const url = origin + "/pools.json?" + authParams.toString()
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pool: { name, category: "series" } })
        })
        if (!response.ok) return ""
        const responseData = await response.json() as { id: number }
        return responseData.id.toString()
    }

    async addToPool(postIds: number[], poolId: string): Promise<boolean> {
        if (!this.credentials) throw new AuthError()
        const { username, apiKey } = this.credentials
        const authParams = new URLSearchParams({
            "login": username,
            "api_key": apiKey
        })
        const url = `${origin}/pools/${poolId}.json?${authParams.toString()}`
        const response = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pool: { post_ids: postIds } })
        })
        return response.ok
    }

    private async searchArtistViaForm(
        query: { url?: string, name?: string }
    ): Promise<ArtistInfo[]> {
        const response = await browser.runtime.sendMessage({
            type: Message.GetArtistTag,
            args: query 
        })
        const parser = new DOMParser()
        const doc = parser.parseFromString(response.html, "text/html")
        const table = doc.querySelector("#artists-table tbody")!
        const rows = [...table.querySelectorAll("tr")]
        return rows.map(row => {
            const nameCol = row.querySelector("td.name-column a")!
            const statusCol = row.querySelector("td.status-column a")
            return {
                name: nameCol.textContent!.replaceAll("_", " "),
                isBanned: statusCol ? statusCol.textContent === "Banned" : false
            }
        })
    }

    private async searchArtistViaApi(
        query: { url?: string, name?: string }
    ): Promise<ArtistInfo[]> {
        let params
        if (query.url && !query.name) {
            params = new URLSearchParams({ "search[url_matches]": query.url })
        } else if (query.name && !query.url) {
            params = new URLSearchParams({ "search[name_eq]": query.name })
        } else {
            throw new Error("Artist query must contain either a URL or name.")
        }
        const apiUrl = origin + "/artists.json?" + params.toString()
        const response = await fetch(apiUrl, {
            credentials: "same-origin"  // Send cookies instead of API key
        })
        const infos = await response.json() as RawArtistInfo[] 
        return infos.map(info => ({
            name: info.name,
            isBanned: info.is_banned
        }))
    }

    async searchArtistByUrl(url: string): Promise<ArtistInfo[]> {
        const searchFunc = this.credentials ?
            this.searchArtistViaApi : this.searchArtistViaForm
        return searchFunc({ url })
    }

    async getArtistInfo(name: string): Promise<ArtistInfo | null> {
        const searchFunc = this.credentials ?
            this.searchArtistViaApi : this.searchArtistViaForm
        const infos = await searchFunc({ name })
        if (infos.length === 0) return null
        return infos[0]
    }
}
