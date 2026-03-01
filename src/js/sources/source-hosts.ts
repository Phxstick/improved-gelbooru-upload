import { HostName, SourceHost, SourceInfo } from "js/types"

namespace SourceHosts {
    const hostDisplayNames: Record<SourceHost, string> = {
        [SourceHost.Pixiv]: "Pixiv",
        [SourceHost.Nijie]: "Nijie"
    }

    export function extractSourceHost(sourceUrl: string): SourceHost | null {
        const url = new URL(sourceUrl)
        switch (url.hostname) {
            case "nijie.info":
            case "pic.nijie.net":
                return SourceHost.Nijie
            case "www.pixiv.net":
            case "i.pximg.net":
                return SourceHost.Pixiv
            default:
                return null
        }
    }

    export function extractSourceInfo(sourceUrl: string): SourceInfo | null {
        let url
        try {
            url = new URL(sourceUrl)
        } catch (e) {
            return null
        }
        const pathParts = url.pathname.split("/")
        const host = extractSourceHost(sourceUrl)
        if (!host) return null
        switch (url.hostname) {
            case "nijie.info":
                const nijieId = url.searchParams.get("id")
                if (!nijieId) return null
                return {
                    host,
                    id: nijieId
                }

            case "i.pximg.net":
                const filename = pathParts[pathParts.length - 1]
                return {
                    host,
                    id: filename.split("_")[0]
                }

            case "www.pixiv.net":
                if (!pathParts.includes("artworks")) return null
                return {
                    host,
                    id: pathParts[pathParts.length - 1]
                }
            
            default:
                return null
        }
    }

    export function constructPageUrl({ host, id }: SourceInfo): string {
        switch (host) {
            case SourceHost.Pixiv:
                return `https://www.pixiv.net/artworks/${id}`
            case SourceHost.Nijie:
                return `https://nijie.info/view.php?id=${id}`
        }
    }

    export function getSourceUrl(fileUrl: string, postHost: HostName): string | null {
        const url = new URL(fileUrl)

        if (url.hostname === "i.pximg.net") {
            if (postHost === HostName.Danbooru) {
                return fileUrl  // Danbooru wants the direct image URL from Pixiv
            } else {
                const sourceInfo = extractSourceInfo(fileUrl)
                return sourceInfo ? constructPageUrl(sourceInfo) : null
            }
        }

        return null
    }

    export function getSourceQueries({ host, id }: SourceInfo): string[] {
        switch (host) {
            case SourceHost.Pixiv:
                return [`*pixiv*${id}*`, `*pximg*${id}*`]
            case SourceHost.Nijie:
                return [`*nijie*${id}*`]
        }
    }

    export function getDisplayName(sourceHost: SourceHost): string {
        return hostDisplayNames[sourceHost]
    }

    export function isDirectDownloadPossible(sourceHost: SourceHost) {
        switch (sourceHost) {
            case SourceHost.Pixiv:
                return false
            case SourceHost.Nijie:
                return true
        }
        return true
    }

    export function isArtistSearchPossible(sourceUrl: string) {
        const url = new URL(sourceUrl)
        const quickSearchHosts = ["i.pximg.net", "www.pixiv.net", "nijie.info"]
        return quickSearchHosts.includes(url.hostname)
    }
}

export default SourceHosts