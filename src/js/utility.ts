
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
        // onChange: () => {
        //     const isChecked = $(element).checkbox("is checked")
        //     if (props.onChange) props.onChange(isChecked)
        // }
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

interface PageToHtmlParams {
    separator: string,
}

const tagRegex = /\[([^\]]+)\](.*?)\[\/\1\]/g

function convertMarkupTags(markup: string): string {
    return markup.replaceAll(tagRegex, (match, tagType, content) => {
        if (tagType === "i") {
            return `<i>${content}</i>`
        } else if (tagType === "b") {
            return `<b>${content}</b>`
        } else if (tagType === "post") {
            const postId = parseInt(content)  
            return `<a class="post-link" data-post-id="${postId}">post ${postId}</a>`
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
        const lines = part.split(separator)
        for (const line of lines) {
            convertedParts.push(`<li>${line.slice(2)}</li>`)
        }
        convertedParts.push("</ul>")
        return
    }

    // Handle headers
    const headerMatch = part.match(/^h(\d)\. /)
    if (headerMatch) {
        const sepPos = part.indexOf(separator)
        const headerText = part.slice(4, sepPos >= 0 ? sepPos : undefined)
        const level = headerMatch[1]
        convertedParts.push(`<h${level}>${headerText}</h${level}>`)
        if (sepPos >= 0) {
            convertMarkupSegment(
                part.slice(sepPos + separator.length), convertedParts, separator)
        }
        return
    }

    // In all other cases, assume that the part is just lines of text
    const lines = part.split(separator)
    convertedParts.push("<p>" + lines.join("<br>") + "</p>")
}

export function wikiPageToHtml(page: string, params: PageToHtmlParams): string {
    const { separator } = params

    // Escape certain characters for safety
    page = escapeHtml(page)

    // Handle external links of the form `"term":[url]`
    page = page.replaceAll(/&quot;([^&]+)&quot;:\[([^\]]+)\]/g, (_, text, url) => {
        return `<a href="${url}" target="_blank">${text}</a>`
    })

    // Handle style tags like "[i]" or "[b]"
    // (do multiple passes to handle nested tags)
    page = convertMarkupTags(convertMarkupTags(page))

    // Replace references of the form "[[tag_name|alt]]" with <a> elements
    page = page.replaceAll(/\[\[([^\]]*)\]\]/g, (_, text) =>
        `<a class="wiki-link">${text.split("|")[0]}</a>`)

    // Handle post references of the form "post #id"
    page = page.replaceAll(/post #(\d+)/g, (_, postIdString) => {
        const postId = parseInt(postIdString)  
        return `<a class="post-link" data-post-id="${postId}">post #${postId}</a>`
    })

    // Handle post queries of the form "{{tag1 tag2 ...}}
    page = page.replaceAll(/\{\{([^}]+)\}\}/g, (_, tags) => {
        return `<a class="posts-search" data-tags="${tags}">${tags}</a>`
    })

    // Break page into segments and handle each one separately
    const parts = page.split(separator + separator)
    const convertedParts: string[] = []
    parts.forEach(part =>
        convertMarkupSegment(part, convertedParts, separator))

    return convertedParts.join("")
}
