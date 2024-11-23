import DanbooruApi from "js/danbooru-api"
import { BooruApi } from "js/types"
import { E, escapeHtml, replaceSubstrings, unescapeHtml } from "js/utility"

interface PageToHtmlParams {
    separator: string,
}

const tagRegex = /\[([^\]]+)\](.*?)\[\/\1\]/g

function convertMarkupTags(markup: string, api: BooruApi): string {
    return markup.replaceAll(tagRegex, (match, tagType, content) => {
        if (tagType === "i") {
            return `<i>${content}</i>`
        } else if (tagType === "b") {
            return `<b>${content}</b>`
        } else if (tagType === "post") {
            const postId = parseInt(content)  
            const postUrl = api.getPostUrl(postId)
            return `<a class="post-link" data-post-id="${postId}" href="${postUrl}" target="_blank">post ${postId}</a>`
        } else {
            return match
        }
    })
}

function convertMarkupSegment(part: string, convertedParts: string[], separator: string) {
    part = part.trim()
    if (part.length === 0) return

    // Handle headers
    const headerMatch = part.match(/^h(\d)(?:#([^.]*))?\.(?: )?/)
    if (headerMatch) {
        const [fullMatch, level, refId] = headerMatch
        const sepPos = part.indexOf(separator)
        const headerText = part.slice(
            fullMatch.length, sepPos >= 0 ? sepPos : undefined)
        const hLevel = parseInt(level) - 1
        convertedParts.push(
            `<h${hLevel} data-ref="${refId}">${headerText}</h${hLevel}>`)
        if (sepPos >= 0) {
            convertMarkupSegment(
                part.slice(sepPos + separator.length), convertedParts, separator)
        }
        return
    }

    // Handle expansion
    const expansionMatch = part.match(/\[expand=([^\]]*)\]([^\[]*)\[\/expand\]/)
    if (expansionMatch) {
        const [_, title, content] = expansionMatch
        convertedParts.push(`<h5>${title}</h5>`)
        convertMarkupSegment(content.trim(), convertedParts, separator)
        return
    }

    // Handle paragraphs and lists
    const lines = part.split(separator)
    convertParagraphsAndLists(lines, convertedParts)
}

function convertParagraphsAndLists(lines: string[], convertedParts: string[]) {
    let currentLevel = 0
    const paragraphLines: string[] = []
    for (const line of lines) {
        const listItemMatch = line.match(/^([*]+|[-]) /)
        const level = listItemMatch ? listItemMatch[1].length : 0
        if (level > 0 && paragraphLines.length > 0) {
            convertedParts.push("<p>" + paragraphLines.join("<br>") + "</p>")
            paragraphLines.length = 0;
        }
        while (level < currentLevel) {
            convertedParts.push("</ul>")
            currentLevel -= 1
        }
        if (level > currentLevel) {
            convertedParts.push("<ul>")
            currentLevel += 1
        }
        if (level === 0) {
            paragraphLines.push(line)
        } else {
            convertedParts.push("<li>", line.slice(level + 1), "</li>")
        }
    }
    while (currentLevel > 0) {
        convertedParts.push("</ul>")
        currentLevel -= 1
    }
    if (paragraphLines.length > 0) {
        convertedParts.push("<p>" + paragraphLines.join("<br>") + "</p>")
    }
    return convertedParts
}

async function handleReferenceLists(page: string, params: PageToHtmlParams, api: DanbooruApi): Promise<string> {
    const lines = page.split(params.separator)

    // Gather lists of regex matches in contiguous lines (and their positions)
    const lists = []
    const listPositions = []
    let currentList = []
    let start = 0
    let end = 0
    let offset = 0;
    const referenceRegex = /^(?:[-*] )?!(post|asset) #(\d+)(?::\s?(.+))?$/
    for (const line of lines) {
        const match = line.match(referenceRegex)
        if (match) {
            if (currentList.length === 0) {
                start = offset
            }
            currentList.push(match)
        } else if (currentList.length > 0) {
            lists.push(currentList)
            listPositions.push({ start, end: offset - params.separator.length })
            currentList = []
        }
        offset += line.length + params.separator.length
    }
    if (currentList.length > 0) {
        lists.push(currentList)
        listPositions.push({ start, end: offset - params.separator.length })
    }
    if (lists.length === 0) return page

    // Seperate posts and assets and make one request for each of the two types
    const postMatches = []
    const assetMatches = []
    for (const matches of lists) {
        for (const match of matches) {
            const type = match[1]
            if (type === "post") postMatches.push(match)
            else if (type === "asset") assetMatches.push(match)
        }
    }
    const postIds = postMatches.map(match => parseInt(match[2]))
    const assetIds = assetMatches.map(match => parseInt(match[2]))
    const posts = postIds.length === 0 ? [] :
            await api.getPosts(postIds, { only: ["id", "thumbnailUrl"] })
    const assets = assetIds.length === 0 ? [] :
            await api.getMediaAssets(assetIds, { only: ["id", "variants"] })

    // Map each post/asset to its corresponding resource URL and thumbnail URL
    const postInfoMap: { [key in number]: { url: string, thumbnailUrl: string } } = {}
    const assetInfoMap: { [key in number]: { url: string, thumbnailUrl: string } } = {}
    for (const post of posts) {
        postInfoMap[post.id] = {
            url: api.getPostUrl(post.id),
            thumbnailUrl: post.thumbnailUrl
        }
    }
    for (const asset of assets) {
        const numVariants = asset.variants.length
        const index = numVariants > 1 ? numVariants - 2 : 0
        assetInfoMap[asset.id] = {
            url: api.getMediaAssetUrl(asset.id),
            thumbnailUrl: asset.variants[index].url
        }
    }

    // Replace matched parts with links including thumbnail + description
    const replacements = []
    for (let i = 0; i < lists.length; ++i) {
        const listContainer = E("div", { class: "media-gallery" })
        for (const match of lists[i]) {
            const [_, resourceType, resourceIdString, description] = match
            const resourceId = parseInt(resourceIdString)
            // For some reason, TS compiler complains without "!" but TS-server doesn't
            const map = resourceType === "post" ? postInfoMap : assetInfoMap
            const { url, thumbnailUrl } = map[resourceId]
            const linkElement = E("div", {}, [
                E("a", { class: "booru-post", href: url, target: "_blank" }, [
                    E("img", { class: "small preview", src: thumbnailUrl })
                ])
            ])
            if (description) {
                linkElement.appendChild(
                    E("div", { class: "description" }, description.trim())
                )
            }
            listContainer.appendChild(linkElement)
        }
        const { start, end } = listPositions[i]
        replacements.push({ start, end, newText: listContainer.outerHTML })
    }

    return replaceSubstrings(page, replacements)
}

async function handleWikiReferences(page: string, api: BooruApi): Promise<string> {
    const wikiReferenceRegex = /\[\[([^\]]*)\]\]/g
    const matches = [...page.matchAll(wikiReferenceRegex)]
    // const pageNames = matches.map(match => match[1].split("|")[0])
    // const tagInfos = matches.length > 30 ? undefined :
    //     await api.getMultipleTagInfos(pageNames, ["name", "category"])
    const replacements = []
    for (const match of matches) {
        const [fullMatch, innerMatch] = match
        const parts = innerMatch.split("|")
        const displayName = parts.length > 1 && parts[1] ? parts[1] :
            (parts.length > 1 ? parts[0].replaceAll(/_?\(.*?\)/g, "").trim() : parts[0])
        const pageId = unescapeHtml(parts[0].toLowerCase().replaceAll(" ", "_"))
        // const type = tagInfos && tagInfos.has(pageId) ? tagInfos.get(pageId)!.type : ""
        const type = undefined
        const href = api.getWikiUrl(pageId)
        const start = match.index!
        const end = start + fullMatch.length
        const newText = `<a class="wiki-link" data-page="${pageId}"${type ? ` data-type="${type}"` : ""} href="${href}">${displayName}</a>`
        replacements.push({ start, end, newText })
    }
    return replaceSubstrings(page, replacements)
}

export async function wikiPageToHtml(page: string, params: PageToHtmlParams, api: BooruApi): Promise<string> {
    const { separator } = params

    // Escape certain characters for safety
    page = escapeHtml(page)

    // Handle links of the form `"term":/local/path`, `"term":[url]` or `"term":url`
    page = page.replaceAll(/&quot;((?:(?!&quot;).)+)&quot;:(?:(\/[^,\s]+)|(http\S+)|\[([^\]]+)\])/g, (_, text, url1, url2, url3) => {
        const url = url1 || url2 || url3
        let wikiString = ""
        if (api instanceof DanbooruApi && url.startsWith("/wiki_pages/show_or_new")) {
            try {
                const urlParts = new URL(api.getUrl(unescapeHtml(url)))
                const pageName = urlParts.searchParams.get("title")
                if (pageName) {
                    wikiString = ` class="wiki-link" data-page="${pageName}"`
                }
            } catch (error) {}
        }
        return `<a href="${url}"${wikiString} target="_blank">${text}</a>`
    })

    // Handle other external links with just a URL (try not to match URLs that
    // are already part of named links which are handled above)
    page = page.replaceAll(/(?<!href=")(?<!>)(?<!\/)(http\S+)/g, (_, url) => {
        return `<a href="${url}" target="_blank">${url}</a>`
    })

    // Handle local section links of the form `"name":#refId`
    page = page.replaceAll(/&quot;((?:(?!&quot;).)+)&quot;:#(\S+)/g, (_, text, refId) => {
        if (refId.startsWith("dtext-")) refId = refId.slice(6)
        return `<a class="local-link" data-linkto="${refId}">${text}</a>`
    })

    // Handle style tags like "[i]" or "[b]"
    // (do multiple passes to handle nested tags)
    page = convertMarkupTags(convertMarkupTags(page, api), api)

    // Replace wiki references of the form "[[page name|display name]]" with links
    page = await handleWikiReferences(page, api)

    // Handle references of the form "-/* !post/asset #id: [desc]", which should be
    // converted into a list of inline links with thumbnails and descriptions
    if (api instanceof DanbooruApi) {
        page = await handleReferenceLists(page, params, api)
    }

    // Handle simple post references of the form "post #id"
    page = page.replaceAll(/[Pp]ost #(\d+)/g, (_, postIdString) => {
        const postId = parseInt(postIdString)  
        const postUrl = api.getPostUrl(postId)
        return `<a class="post-link" data-post-id="${postId}" href="${postUrl}" target="_blank">post #${postId}</a>`
    })

    // Handle simple pool references of the form "pool #id"
    if (api instanceof DanbooruApi) {
        page = page.replaceAll(/[Pp]ool #(\d+)/g, (_, poolIdString) => {
            const poolId = parseInt(poolIdString)  
            const poolUrl = api.getPoolUrl(poolId)
            return `<a class="pool-link" href="${poolUrl}" target="_blank">pool #${poolId}</a>`
        })
    }

    // Handle post queries of the form "{{tag1 tag2 ...}}
    page = page.replaceAll(/\{\{([^}]+)\}\}/g, (_, query) => {
        const tags = query.trim().split(" ")
        const queryUrl = api.getQueryUrl(tags)
        return `<a class="posts-search" data-tags="${tags}" href="${queryUrl}" target="_blank">${query}</a>`
    })

    // Break markup into segments and handle each one separately
    const parts = page.split(separator + separator)
    const convertedParts: string[] = []
    parts.forEach(part =>
        convertMarkupSegment(part, convertedParts, separator))

    return convertedParts.join("")
}