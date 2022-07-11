namespace GelbooruApi {
    export interface Credentials {
        apiKey: string
        userId: string
    }

    export type TagType = "artist" | "character" | "copyright" | "metadata" | "tag" | "deprecated"

    export interface TagInfo {
        title: string,
        type: TagType,
        postCount: number,
        ambiguous?: boolean
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

    /**
     * Get information about a single tag using the tags API.
     */
    export async function getTagInfo(tagName: string, { userId, apiKey }: Credentials): Promise<TagInfo | undefined> {
        tagName = tagName.replaceAll(" ", "_")
        const url = `https://gelbooru.com/index.php?page=dapi&s=tag&q=index&json=1&api_key=${apiKey}&user_id=${userId}1&name=${tagName}`
        let response
        try {
            response = await fetch(url)
        } catch (error) {
            return
        }
        const responseData = await response.json() as TagResponse
        if (!responseData.tag || responseData.tag.length === 0)
            return { title: tagName, type: "tag", postCount: 0 }
        const { count, type, ambiguous } = responseData.tag[0]
        return { title: tagName, type: numberToTagType[type], postCount: count, ambiguous: ambiguous !== 0 }
    }

    /**
     * Get tag search completions for a given query.
     */
    export async function getTagCompletions(query: string): Promise<TagInfo[] | undefined> {
        let response
        try {
            response = await fetch(`https://gelbooru.com/index.php?page=autocomplete2&term=${query}&type=tag_query&limit=10`, { 
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

    /**
     * Change the type of a tag via form submission.
     */
    export async function setTagType(tagElement: HTMLElement, type: TagType) {
        const tagName = tagElement.dataset.value!.replaceAll(" ", "_")
        const formData = new FormData()
        formData.set("tag", tagName)
        formData.set("type", type)
        formData.set("commit", "Save")  // Not sure if this is needed
        const response = await fetch("https://gelbooru.com/index.php?page=tags&s=edit", {
            method: "POST",
            body: formData
        })
        if (!response.ok) return
        tagElement.dataset.type = type
        if (type !== "tag") tagElement.classList.remove("rare")
    }

    interface Post {
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
        post?: Post | Post[]
    }

    /**
     * Find posts matching the given tags.
     */
    export async function query(tags: string[], { userId, apiKey }: Credentials): Promise<Post[]> {
        const fullResults = []
        let pid = 0
        let count = Infinity
        while (100 * pid < count) {
            const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&api_key=${apiKey}&user_id=${userId}&json=1&pid=${pid}&tags=${tags.join("+")}`
            const response = await fetch(url)
            const data = await response.json() as QueryResponse
            if (data.post === undefined) return []
            const results = Array.isArray(data.post) ? data.post : [data.post]
            fullResults.push(...results)
            count = parseInt(data["@attributes"].count)
            pid += 1
        }
        return fullResults
    }

    /**
     * Add posts specified by given IDs to pool with given ID.
     */
    export async function addToPool(gelbooruIds: string[], poolId: string): Promise<boolean> {
        const url = `https://gelbooru.com/index.php?page=pool&s=import&id=${poolId}`
        let counter = 0
        const formData = new FormData()
        formData.set("id", poolId)
        formData.set("commit", "Import")
        for (const gelbooruId of gelbooruIds) {
            formData.set(`posts[${gelbooruId}]`, counter.toString())
            counter++
        }
        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",  // Send cookies
            body: formData
        })
        if (!response.ok) return false
        return true
    }

    enum PoolType {
        Public = "1",
        Private = "2",
        Personal = "3"
    }

    /**
     * Create a pool with the given options.
     */
    export async function createPool(name: string, type=PoolType.Private): Promise<string> {
        const url = `https://gelbooru.com/index.php?page=pool&s=add`
        const formData = new FormData()
        formData.set("pool[name]", name)
        formData.set("pool[type]", type)
        // formData.set("pool[description]", "")
        formData.set("commit", "Save")
        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",  // Send cookies
            body: formData
        })
        if (!response.ok) return ""
        const poolUrlParts = new URL(response.url)
        return poolUrlParts.searchParams.get("id") || ""
    }

}

export default GelbooruApi;