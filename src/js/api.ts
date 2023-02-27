import browser from "webextension-polyfill"
import SettingsManager from "js/settings-manager"
import GelbooruApi from "js/gelbooru-api"
import DanbooruApi from "js/danbooru-api"
import { BooruApi, HostName, Settings } from "js/types"

export async function getApi(
    host: HostName,
    settings?: Settings,
    csrfToken?: string)
: Promise<BooruApi> {
    switch (host) {
        case HostName.Gelbooru: {
            const { apiKey, userId } = settings ? settings :
                await SettingsManager.get(["apiKey", "userId"])
            const credentials = apiKey && userId ?
                { apiKey, userId } : undefined
            return new GelbooruApi(credentials)
        }
        case HostName.Danbooru: {
            const { danbooruApiKey, danbooruUsername } = settings ? settings :
                await SettingsManager.get(["danbooruApiKey", "danbooruUsername"])
            const credentials = danbooruApiKey && danbooruUsername ? {
                apiKey: danbooruApiKey,
                username: danbooruUsername
            } : undefined
            return new DanbooruApi(credentials, csrfToken)
        }
        default:
            throw new Error(`Unknown host ${host}.`)
    }
}

