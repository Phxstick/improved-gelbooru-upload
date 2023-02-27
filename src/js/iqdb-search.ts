import browser from "webextension-polyfill";
import { HostName, IqdbMatch, IqdbSearchParams, IqdbSearchResult, Message } from "js/types";

namespace IQDB {

    export async function search(params: IqdbSearchParams): Promise<IqdbSearchResult> {
        let response
        try {
            // Query IQDB via background page to circumvent CORS
            response = await browser.runtime.sendMessage({
                type: Message.QueryIqdb,
                args: params
            })
        } catch (e) {
            return { success: false, error: "Cannot reach IQDB server!" }
        }
        if (!response.html) {
            console.log("IQDB response status:", response.status)
            let error: string
            if (response.status === 413) {
                error = "File is too large for IQDB request!"
            } else {
                error = "IQDB search request failed!"
            }
            return { success: false, error }
        }
        const parser = new DOMParser()
        const doc = parser.parseFromString(response.html, "text/html")
        const errorMsg = doc.querySelector(".err")
        if (errorMsg !== null) {
            console.log("IQDB error:", errorMsg.textContent)
            let error: string
            if (errorMsg.textContent!.includes("too large")) {
                error = "File is too large for IQDB query (8192 KB max)."
            } else if (errorMsg.textContent!.includes("format not supported")) {
                error = "File format is not supported by IQDB."
            } else {
                error = "IQDB search request failed!"
            }
            return { success: false, error }
        }
        try {
            const matches = parseIqdbSearchResults(doc, params.host)
                            .filter(match => match.similarity > 80)
            return { success: true, matches }
        } catch (e) {
            return { success: false, error: "Failed to parse IQDB response." }
        }
    }

    function parseIqdbSearchResults(doc: Document, host: HostName): IqdbMatch[] {
        const matches: IqdbMatch[] = []
        const pages = doc.querySelectorAll("#pages > div")
        if (pages.length === 0) {
            throw new Error("Search result is not valid.")
        }
        for (const page of pages) {
            const rows = page.querySelectorAll("tr")
            const head = rows[0].textContent!.trim().toLowerCase()
            if (head === "your image" || head === "no relevant matches") continue
            const link = rows[1].querySelector("a")!
            const image = link.querySelector("img")!
            let postUrl = link.getAttribute("href")!
            let thumbnailUrl = image.getAttribute("src")!
            if (postUrl[0] === "/" && postUrl[1] === "/") {
                postUrl = "https:" + postUrl
            }
            if (thumbnailUrl[0] === "/") {
                thumbnailUrl = `https://${host}.iqdb.org` + thumbnailUrl
            }
            const dimensions = rows[2].textContent!.split(" ")[0]
            const [width, height] = dimensions.split("×").map(n => parseInt(n))
            const similarity = parseInt(rows[3].textContent!.split("%")[0])
            matches.push({
                postId: -1,  // Correct value will be set by the corresponding API
                postUrl,
                thumbnailUrl,
                width,
                height,
                similarity
            })
        }
        return matches
    }
}

export default IQDB;
