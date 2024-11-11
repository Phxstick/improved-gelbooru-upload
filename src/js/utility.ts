import DanbooruApi from "js/danbooru-api";
import { BooruApi, HostName } from "js/types";

export function fragmentFromString(htmlString: string): DocumentFragment {
    const template = document.createElement("template");
    template.innerHTML = htmlString;
    return document.importNode(template.content, true);
}

export function elementFromString(htmlString: string) : HTMLElement {
    return fragmentFromString(htmlString).children[0] as HTMLElement;
}

export function E(type: string, props?: any, children?: (HTMLElement | string)[] | string): HTMLElement {
    const element = document.createElement(type);
    if (props !== undefined) {
        for (const prop in props) {
            if (prop === "dataset") {
                for (const key in props.dataset) {
                    element.setAttribute(`data-${key}`, props.dataset[key].toString())
                }
            } else if (prop === "style") {
                for (const key in props.style) {
                    element.style.setProperty(key, props.style[key])
                }
            } else if (props[prop] !== undefined) {
                element.setAttribute(prop, props[prop])
            }
        }
    }
    if (children !== undefined) {
        if (typeof children === "string") {
            element.innerHTML = children;
        } else {
            for (const child of children) {
                element.append(child);
            }
        }
    }
    return element
}

export type ElementStore = (idOrClass: string) => HTMLElement
export function createElementStore(rootElement: HTMLElement): ElementStore {
    const cache: { [key: string]: HTMLElement } = {}
    return (idOrClass: string) => {
        if (!(idOrClass in cache)) {
            let element = rootElement.querySelector(`#${idOrClass}`)
            if (element === null) {
                element = rootElement.querySelector(`.${idOrClass}`)
            }
            if (element === null) {
                throw new Error(`Couldn't find element with id/class '${idOrClass}'.`)
            }
            cache[idOrClass] = element as HTMLElement
        }
        return cache[idOrClass]
    }
}

export async function finishEventQueue(): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
}

// Apparently, the following way of concatenating arrays is the fastest
// (https://dev.to/uilicious/javascript-array-push-is-945x-faster-than-array-concat-1oki)
export function concatenateArrays<T>(arrays: T[][]): T[] {
    const union = arrays[0]
    let start = union.length
    union.length = arrays.reduce((sum, a) => sum + a.length, 0)
    for (let i = 1; i < arrays.length; ++i) {
        const array = arrays[i]
        for (let j = 0; j < array.length; ++j) {
            union[start + j] = array[j]
        }
        start += array.length
    }
    return union
}

interface TimeSpan {
    seconds?: number
    minutes?: number
    hours?: number
    days?: number
    weeks?: number
    months?: number 
    years?: number
}

const intervals = {
    years: 60 * 60 * 24 * 365,
    months: 60 * 60 * 24 * 30,
    weeks: 60 * 60 * 24 * 7,
    days: 60 * 60 * 24,
    hours: 60 * 60,
    minutes: 60,
    seconds: 1
}

export function secondsToTimeSpan(secondsTotal: number): TimeSpan {
    const timeSpan = {} as TimeSpan
    for (const intervalName in intervals) {
        const interval = intervals[intervalName as keyof TimeSpan]
        timeSpan[intervalName as keyof TimeSpan] = Math.floor(secondsTotal / interval)
        secondsTotal %= interval
    }
    return timeSpan
}

export function timeSpanObjectToShortString(timeSpan: TimeSpan): string {
    let unit: keyof TimeSpan
    if (timeSpan.years) unit = "years"
    else if (timeSpan.months) unit="months"
    else if (timeSpan.weeks) unit="weeks"
    else if (timeSpan.days) unit="days"
    else if (timeSpan.hours) unit="hours"
    else if (timeSpan.minutes) unit="minutes"
    else if (timeSpan.seconds) unit="seconds"
    else return ""
    // Remove plural "s" at the end if unit is equal to 1
    const numberString =
        timeSpan[unit] == 1 ? "one" :
        timeSpan[unit] == 2 ? "two" :
        timeSpan[unit]
    return `${numberString} ` + (timeSpan[unit]! > 1 ? unit : unit.slice(0, -1))
} 

export function secondsToShortString(seconds: number): string {
    return timeSpanObjectToShortString(secondsToTimeSpan(seconds))
}

export function selectContents(element: HTMLElement) {
    const range = document.createRange()
    range.setStart(element, 0)
    range.setEnd(element, 1)
    const selection = document.getSelection()
    if (selection !== null) {
        selection.removeAllRanges()
        selection.addRange(range)
    }
}

export function convertStringToNumber(s: string): number | typeof NaN {
    if (s.length === 0) return NaN
    const units = ["k", "m", "b"]
    const unit = s[s.length - 1].toLowerCase()
    if (units.includes(unit)) {
        let newValue = parseFloat(s.slice(0, s.length - 1))
        if (isNaN(newValue)) return NaN
        if (unit === "k") {
            newValue *= 1000
        } else if (unit === "m") {
            newValue *= 1000 * 1000
        } else if (unit === "b") {
            newValue *= 1000 * 1000 * 1000
        }
        return newValue
    } else {
        return parseFloat(s)
    }
}

export function convertNumberToString(n: number): string {
    if (n < 1000) return n.toString()
    const numDigits = Math.floor(Math.log10(n)) + 1
    if (numDigits >= 9 && n % 10000000 === 0) {
        return (n / 1000000000).toString() + "B"
    } else if (numDigits >= 6 && n % 10000 === 0) {
        return (n / 1000000).toString() + "M"
    } else if (numDigits >= 3 && n % 10 === 0) {
        return (n / 1000).toString() + "k"
    }
    return n.toString()
}

export async function getImageFromUrl(url: string): Promise<File | null> {
    const [fileName] = url.split("/").slice(-1)
    const splitName = fileName.split(".")
    if (splitName.length < 2) return null
    const fileType = fileName.split(".")[1]
    const imageTypes = ["png", "jpg", "jpeg", "gif"]
    if (!imageTypes.includes(fileType)) return null
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    return new File([buffer], fileName, { type: `image/${fileType}` })
}

interface ToggleProps {
    label: string
    defaultValue: boolean
    canToggle?: (value: boolean) => boolean | Promise<boolean>
    onChange?: (value: boolean) => void
}

export function createToggle(props: ToggleProps) {
    const element = E("div", { class: "ui toggle checkbox" }, [
        E("input", { type: "checkbox" }),
        E("label", {}, props.label)
    ])
    $(element).checkbox({
        beforeChecked: () => {
            if (!props.canToggle) return
            Promise.resolve(props.canToggle(true)).then((allowed) => {
                if (!allowed) return
                $(element).checkbox("set checked")
                if (props.onChange) props.onChange(true)
            })
            return false
        },
        beforeUnchecked: () => {
            if (!props.canToggle) return
            Promise.resolve(props.canToggle(false)).then((allowed) => {
                if (!allowed) return
                $(element).checkbox("set unchecked")
                if (props.onChange) props.onChange(false)
            })
            return false
        },
        onChange: () => {
            if (props.canToggle) return
            const isChecked = $(element).checkbox("is checked")
            if (props.onChange) props.onChange(isChecked)
        }
    })
    if (props.defaultValue) {
        $(element).checkbox("set checked")
    }
    return element
}

interface InputProps {
    header?: string
    value: string
    onChange?: (value: string) => void
    type?: "string" | "integer"
}
export function createInput(props: InputProps) {
    const { header, value, onChange, type } = props
    const field = E("div", { class: "field" })
    const element = E("div", { class: "ui form" }, [field])
    if (header) {
        field.appendChild(E("label", {}, header))
    }
    const input = E("input", { type: "text" }) as HTMLInputElement
    if (value !== undefined) input.value = value
    field.appendChild(input)
    if (type === "integer") {
        input.addEventListener("input", () => {
            input.value = input.value.replaceAll(/[^0-9]/g, "")
        })
    }
    let previousValue: string
    input.addEventListener("focusin", () => {
        previousValue = input.value.trim()
    })
    const checkChange = () => {
        const newValue = input.value.trim()
        if (previousValue === newValue) return
        if (onChange) onChange(newValue)
    }
    input.addEventListener("focusout", checkChange)
    window.addEventListener("beforeunload", checkChange)
    return {
        getElement: () => element,
        getValue: () => input.value,
        setValue: (value: string) => {
            input.value = value
        }
    }
}

// Taken from: https://stackoverflow.com/a/6234804
export function escapeHtml(html: string) {
    return html.replaceAll(/&/g, "&amp;")
               .replaceAll(/</g, "&lt;")
               .replaceAll(/>/g, "&gt;")
               .replaceAll(/"/g, "&quot;")
               .replaceAll(/'/g, "&#039;")
}

export function unescapeHtml(str: string) {
    return str.replaceAll("&amp;", "&")
              .replaceAll("&lt;", "<")
              .replaceAll("&gt;", ">")
              .replaceAll("&quot;", `"`)
              .replaceAll("&#039;", `'`)
}

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

    // Handle list
    if (part.startsWith("* ")) {
        convertedParts.push("<ul>")
        let currentLevel = 1
        const lines = part.split(separator)
        for (const line of lines) {
            const listItemMatch = line.match(/[*]+/)
            if (!listItemMatch) {
                // This case shouldn't happen if the markdown is valid
                convertedParts.push(line)
                continue
            }
            const level = listItemMatch[0].length
            while (level < currentLevel) {
                // convertedParts.push("</ul></li>")
                convertedParts.push("</ul>")
                currentLevel -= 1
            }
            if (level > currentLevel) {
                // convertedParts.pop()  // Remove last </li> tag
                convertedParts.push("<ul>")
                currentLevel += 1
            }
            convertedParts.push("<li>", line.slice(level + 1), "</li>")
        }
        while (currentLevel > 0) {
            convertedParts.push("</ul>")
            // if (currentLevel > 1) {
            //     convertedParts.push("</li>")
            // }
            currentLevel -= 1
        }
        return
    }

    // Handle headers
    const headerMatch = part.match(/^h(\d)(?:#([^.]*))?\. /)
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

    // In all other cases, assume that the part is just lines of text
    const lines = part.split(separator)
    convertedParts.push("<p>" + lines.join("<br>") + "</p>")
}

async function handlePostReferences(page: string, params: PageToHtmlParams, api: DanbooruApi): Promise<string> {
    const referenceRegex = /(?:[-*] )?!(post|asset) #(\d+)(?:: ([^\r\n]+))?(?:[\r\n]+)?/g
    const matches = [...page.matchAll(referenceRegex)]
    if (matches.length === 0) return page

    // Seperate posts and assets and make one request for each of the two types
    const postMatches = []
    const assetMatches = []
    for (const match of matches) {
        const type = match[1]
        if (type === "post") postMatches.push(match)
        else if (type === "asset") assetMatches.push(match)
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
    const replacements: Replacement[] = []
    for (const match of matches) {
        const [fullMatch, resourceType, resourceIdString, description] = match
        const resourceId = parseInt(resourceIdString)
        // For some reason, TS compiler complains without "!" but TS-server doesn't
        const map = resourceType === "post" ? postInfoMap : assetInfoMap
        const { url, thumbnailUrl } = map[resourceId]
        const start = match.index!
        const end = start + fullMatch.length
        const linkElement = E("div", { class: "booru-post-with-description" }, [
            E("a", { class: "booru-post", href: url, target: "_blank" }, [
                E("img", { class: "small preview", src: thumbnailUrl })
            ])
        ])
        if (description) {
            linkElement.appendChild(
                E("div", { class: "booru-post-description" }, description)
            )
        }
        replacements.push({ start, end, newText: linkElement.outerHTML })
    }

    // Add line separators after the last match because newline characters are
    // consumed by matches (not ideal since it assumes that all matches are part
    // of the same list, which might not always be the case)
    const separators = params.separator + params.separator
    if (matches[matches.length - 1][0].endsWith(separators)) {
        replacements[replacements.length - 1].newText += separators
    }

    return replaceSubstrings(page, replacements)
}

async function handleWikiReferences(page: string, api: BooruApi): Promise<string> {
    const wikiReferenceRegex = /\[\[([^\]]*)\]\]/g
    const matches = [...page.matchAll(wikiReferenceRegex)]
    const pageNames = matches.map(match => match[1].split("|")[0])
    console.log(`Page contains ${matches.length} wiki links`)
    const tagInfos = matches.length > 30 ? undefined :
        await api.getMultipleTagInfos(pageNames, ["name", "category"])
    const replacements: Replacement[] = []
    for (const match of matches) {
        const [fullMatch, innerMatch] = match
        const parts = innerMatch.split("|")
        const displayName = parts.length > 1 ? parts[1] : parts[0]
        const pageId = parts[0].toLowerCase().replaceAll(" ", "_")
        const type = tagInfos && tagInfos.has(pageId) ? tagInfos.get(pageId)!.type : ""
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
    console.log(page)

    // Escape certain characters for safety
    page = escapeHtml(page)

    // Handle external links of the form `"term":[url]` or `"term":url`
    page = page.replaceAll(/&quot;(.+?)&quot;:(?:(http\S+)|\[([^\]]+)\])/g, (_, text, url1, url2) => {
        return `<a href="${url1 || url2}" target="_blank">${text}</a>`
    })

    // Handle other external links with just a URL
    page = page.replaceAll(/(?<!href=")(http:\/\/\S+)/g, (_, url) => {
        return `<a href="${url}" target="_blank">${url}</a>`
    })

    // Handle local section links of the form `"name":#refId`
    page = page.replaceAll(/&quot;([^&]+)&quot;:#(\S+)/g, (_, text, refId) => {
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
        page = await handlePostReferences(page, params, api)
    }

    // Handle simple post references of the form "post #id"
    page = page.replaceAll(/post #(\d+)/g, (_, postIdString) => {
        const postId = parseInt(postIdString)  
        const postUrl = api.getPostUrl(postId)
        return `<a class="post-link" data-post-id="${postId}" href="${postUrl}" target="_blank">post #${postId}</a>`
    })

    // Handle post queries of the form "{{tag1 tag2 ...}}
    page = page.replaceAll(/\{\{([^}]+)\}\}/g, (_, query) => {
        const tags = query.trim().split(" ")
        const queryUrl = api.getQueryUrl(tags)
        return `<a class="posts-search" data-tags="${tags}" href="${queryUrl}" target="_blank">${query}</a>`
    })

    // Break page into segments and handle each one separately
    const parts = page.split(separator + separator)
    const convertedParts: string[] = []
    parts.forEach(part =>
        convertMarkupSegment(part, convertedParts, separator))

    return convertedParts.join("")
}

interface InfoModalOptions {
    dimmer?: boolean
    closable?: boolean
}

export function showInfoModal(text: string, options: InfoModalOptions={}) {
    const { dimmer=false, closable=true } = options
    const actions = []
    if (!closable) {
        actions.push({ text: "Okay" })
    }
    $("body").modal({
        class: 'mini',
        classContent: "centered",
        content: text,
        duration: 160,
        dimmer,
        closable,
        actions
    } as any).modal('show');
}

export function showConfirmModal(text: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        $("body").modal({
            class: 'mini',
            classContent: "centered",
            content: text,
            duration: 160,
            actions: [{
                text: "Proceed",
                click: () => resolve(true)
            }, {
                text: "Cancel",
                click: () => resolve(false)
            }]
        } as any).modal('show');
    })
}

type Func<T> = () => (T | Promise<T>)
type ResultAndError<T> = [T, null] | [null, Error]

export async function catchError<T>(func: Func<T>): Promise<ResultAndError<T>> {
    try {
        const result = await func()
        return [result, null]
    } catch (error) {
        if (error instanceof Error) {
            return [null, error]
        } else if (typeof error === "string") {
            return [null, new Error(error)]
        } else {
            return [null, new Error("Internal error")]
        }
    }
}

export async function loadImage(imageUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = imageUrl
    })
}

export function imageToCanvas(
    image: HTMLImageElement,
    size: { width: number, height: number }
): HTMLCanvasElement
{
    const canvas = document.createElement("canvas")
    const { width, height } = size
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Couldn't get 2D context.")
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
}

interface Replacement {
    start: number
    end: number
    newText: string
}
export function replaceSubstrings(text: string, replacements: Replacement[]): string {
    let offset = 0
    const parts = []
    for (const replacement of replacements) {
        const { start, end, newText } = replacement
        parts.push(text.slice(offset, start), newText)
        offset = end
    }
    parts.push(text.slice(offset))
    return parts.join("")
}