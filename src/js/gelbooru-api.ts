import { TagInfo, TagType, BooruApi, BooruPost, AuthError, HostName, UploadData, UploadResult, IqdbSearchParams, IqdbSearchResult } from "js/types"
import { wikiPageToHtml } from "js/utility"
import IQDB from "js/iqdb-search"

const origin = "https://gelbooru.com/"
const baseUrl = origin + "index.php?"

interface Credentials {
    apiKey: string
    userId: string
}

// Format returned by completion API
interface RawTagCompletion {
    category: TagType
    label: string
    post_count: string
    type: "tag"
    value: string
}

// Format returned by tags API
interface RawTagInfo {
    id: number
    name: string
    count: number
    type: number
    ambiguous: 0 | 1
}

interface TagResponse {
    "@attributes": {
        limit: number
        offset: number
        count: number
    }
    tag?: RawTagInfo[]
}

const numberToTagType: { [key in number]: TagType } = {
    0: "tag",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "metadata",
    6: "deprecated"
}

interface RawPost {
    id: string | number
    source: string
    directory: string
    md5: string
    image: string
    preview_height: string
    preview_width: string
    score: string | number
    rating: string
    status: string
}

interface QueryResponse {
    "@attributes": {
        limit: string
        offset: string
        count: string
    }
    post?: RawPost | RawPost[]
}

enum PoolType {
    Public = "1",
    Private = "2",
    Personal = "3"
}

export default class GelbooruApi implements BooruApi {
    readonly host = HostName.Gelbooru
    private readonly credentials: Credentials | undefined

    constructor(credentials?: Credentials) {
        this.credentials = credentials
    }

    isAuthenticated(): boolean {
        return this.credentials !== undefined
    }

    getQueryUrl(tags: string[]): string {
        const params = new URLSearchParams({
            "page": "post",
            "s": "list",
            "tags": tags.join(" ")
        })
        return baseUrl + params.toString()
    }

    getPostUrl(id: number): string {
        const params = new URLSearchParams({
            "page": "post",
            "s": "view",
            "id": id.toString()
        })
        return baseUrl + params.toString()
    }

    getUploadUrl(): string {
        const params = new URLSearchParams({
            "page": "post",
            "s": "add",
        })
        return baseUrl + params.toString()
    }

    getSettingsUrl(): string {
        const params = new URLSearchParams({
            "page": "account",
            "s": "options",
        })
        return baseUrl + params.toString()
    }

    async getTagInfo(tagName: string): Promise<TagInfo | undefined> {
        if (!this.credentials) throw new AuthError()
        const { userId, apiKey } = this.credentials
        tagName = tagName.replaceAll(" ", "_")
        const params = new URLSearchParams({
            "page": "dapi",
            "s": "tag",
            "q": "index",
            "json": "1",
            "api_key": apiKey,
            "user_id": userId,
            "name": tagName
        })
        const response = await fetch(baseUrl + params.toString())
        const responseData = await response.json() as TagResponse
        if (!responseData.tag || responseData.tag.length === 0) return
        const { id, name, count, type, ambiguous } = responseData.tag[0]
        return {
            id,
            title: name,
            type: numberToTagType[type],
            postCount: count,
            ambiguous: ambiguous !== 0
        }
    }

    async getTagCompletions(query: string): Promise<TagInfo[] | undefined> {
        let response
        const params = new URLSearchParams({
            "page": "autocomplete2",
            "type": "tag_query",
            "limit": "10",
            "term": query
        })
        try {
            response = await fetch(baseUrl + params.toString(), { 
                credentials: "same-origin",  // Send cookies
                headers: { "Accept": "application/json" }
            })
        } catch (error) {
            return
        }
        if (!response.ok) return []
        const responseData = await response.json() as RawTagCompletion[]
        return responseData.map(({ category, label, post_count }) =>
            ({ type: category, title: label, postCount: parseInt(post_count) }))
    }

    async setTagType(tagName: string, type: TagType): Promise<boolean> {
        const params = new URLSearchParams({
            "page": "tags",
            "s": "edit"
        })
        const formData = new FormData()
        formData.set("tag", tagName)
        formData.set("type", type)
        formData.set("commit", "Save")  // Not sure if this is needed
        try {
            const response = await fetch(baseUrl + params.toString(), {
                method: "POST",
                body: formData
            })
            return response.ok
        } catch (error) {
            return false
        }
    }

    async searchPostsRaw(tags: string[], limit?: number): Promise<RawPost[]> {
        if (!this.credentials) throw new AuthError()
        const { userId, apiKey } = this.credentials
        const fullResults = []
        let pid = 0
        const pageSize = 100
        if (!limit) limit = Infinity
        while (pageSize * pid < limit) {
            const params = new URLSearchParams({
                "page": "dapi",
                "s": "post",
                "q": "index",
                "api_key": apiKey,
                "user_id": userId,
                "json": "1",
                "pid": pid.toString(),
                "tags": tags.join(" "),
                "limit": Math.min(limit, pageSize).toString()
            })
            const response = await fetch(baseUrl + params.toString())
            const data = await response.json() as QueryResponse
            if (data.post === undefined) return []
            const results = Array.isArray(data.post) ? data.post : [data.post]
            fullResults.push(...results)
            if (results.length === 0) break
            limit = Math.min(limit, parseInt(data["@attributes"].count))
            pid += 1
        }
        return fullResults
    }

    async searchPosts(tags: string[], limit?: number): Promise<BooruPost[]> {
        const rawPosts = await this.searchPostsRaw(tags, limit)
        return rawPosts.map(post => ({
            id: typeof post.id === "number" ? post.id : parseInt(post.id),
            md5: post.md5,
            source: post.source,
            thumbnailUrl: `https://img3.gelbooru.com/thumbnails/${post.directory}/thumbnail_${post.md5}.jpg`
        }))
    }

    private async getPostIdFromUrl(url: string): Promise<number> {
        const urlParts = new URL(url)
        if (urlParts.searchParams.has("id"))
            return parseInt(urlParts.searchParams.get("id")!)
        if (urlParts.searchParams.has("md5")) {
            const md5 = urlParts.searchParams.get("md5")!
            const md5response = await this.searchPosts(["md5:" + md5])
            if (md5response.length === 0) {
                console.log(`WARNING: cannot find post for MD5 hash (${url}).`)
                return -1
            }
            return md5response[0].id
        }
        console.log(`WARNING: Post contains neither ID nor MD5 (${url})`)
        return -1
    }

    async searchIqdb(params: IqdbSearchParams): Promise<IqdbSearchResult> {
        const result = await IQDB.search(params)
        if (!result.success) return result
        for (const match of result.matches) {
            match.postId = await this.getPostIdFromUrl(match.postUrl)
        }
        return { success: true, matches: result.matches }
    }

    private async searchWiki(query: string): Promise<{ id: number, name?: string }[]> {
        const formData = new FormData()
        formData.set("search", query)
        formData.set("commit", "Search")
        const params = new URLSearchParams({ "page": "wiki", "s": "list" })
        const response = await fetch(baseUrl + params.toString(), {
            method: "POST",
            body: formData
        })
        if (response.redirected) {
            const url = new URL(response.url)
            if (url.searchParams.has("id")) {
                return [{ id: parseInt(url.searchParams.get("id")!) }]
            } else if (url.searchParams.get("s")! === "create") {
                return []
            }
        }
        const html = await response.text()
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, "text/html")
        const linkElements = doc.querySelectorAll(
            "table td:not(:first-child) a[href^='index.php?page=wiki&s=view'")
        return [...linkElements].map(element => {
            const url = new URL((element as HTMLAnchorElement).href)
            return {
                name: element.textContent!,
                id: parseInt(url.searchParams.get("id")!)
            }
        })
    }

    async getWikiPage(tagName: string): Promise<string | null> {
        tagName = tagName.replaceAll(" ", "_")
        const searchResults = await this.searchWiki(tagName)
        if (searchResults.length === 0) return null
        const match = searchResults.length === 1 && !searchResults[0].name ?
            searchResults[0] : searchResults.find(entry => entry.name === tagName)
        if (!match) return null
        const params = new URLSearchParams({
            "page": "wiki",
            "s": "edit",
            "id": match.id.toString()
        })
        const response = await fetch(baseUrl + params.toString())
        const html = await response.text()
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, "text/html")!
        const page = doc.querySelector("textarea")!.textContent!
        return wikiPageToHtml(page, {
            separator: "\n"
        })
    }

    async createPost(data: UploadData): Promise<UploadResult> {
        const { file, source, title, tags, rating } = data
        const formData = new FormData()
        formData.set("upload", file)
        formData.set("source", source)
        formData.set("title", title)
        formData.set("tags", tags.join(" "))
        formData.set("rating", rating)
        formData.set("submit", "Upload")  // Not sure if this is needed
        const params = new URLSearchParams({
            "page": "post",
            "s": "add",
        })
        const response = await fetch(baseUrl + params.toString(), {
            method: "POST",
            body: formData
        })

        // Handle server response (302 = successful upload, 200 = unsuccessful)
        let uploadError: string
        if (response.redirected) {  // Can't read code 302 directly, check for redirection
            const urlParts = new URL(response.url)
            if (urlParts.searchParams.has("id")) {
                const postId = parseInt(urlParts.searchParams.get("id")!)
                return { successful: true, postId, url: response.url }
            } else {
                uploadError = "Unexpected server response."
            }
        } else if (response.status === 200) {
            uploadError = "Upload failed. Please try again."
        } else {
            uploadError = "Unexpected server response."
        }
        return { successful: false, error: uploadError }
    }

    async createPool(name: string, type=PoolType.Private): Promise<string> {
        const params = new URLSearchParams({
            "page": "pool",
            "s": "add"
        })
        const formData = new FormData()
        formData.set("pool[name]", name)
        formData.set("pool[type]", type)
        // formData.set("pool[description]", "")
        formData.set("commit", "Save")
        const response = await fetch(baseUrl + params.toString(), {
            method: "POST",
            credentials: "same-origin",  // Send cookies
            body: formData
        })
        if (!response.ok) return ""
        const poolUrlParts = new URL(response.url)
        return poolUrlParts.searchParams.get("id") || ""
    }

    async addToPool(gelbooruIds: number[], poolId: string): Promise<boolean> {
        const params = new URLSearchParams({
            "page": "pool",
            "s": "import",
            "id": poolId
        })
        let counter = 0
        const formData = new FormData()
        formData.set("id", poolId)
        formData.set("commit", "Import")
        for (const gelbooruId of gelbooruIds) {
            formData.set(`posts[${gelbooruId}]`, counter.toString())
            counter++
        }
        const response = await fetch(baseUrl + params.toString(), {
            method: "POST",
            credentials: "same-origin",  // Send cookies
            body: formData
        })
        return response.ok
    }
}
