import { Storage } from "webextension-polyfill";

// Declare global objects
declare global {
    interface Window {
        $: JQueryStatic,
        jQuery: JQueryStatic
    }
}

declare module "html/*" {
    const value: string;
    export default value
}

// Following is only implemented in Chrome
declare module "webextension-polyfill" {
    namespace Storage {
        interface SessionStorageArea extends StorageArea {
            QUOTA_BYTES: 1048576;
        }
        interface Static {
            session: SessionStorageArea;
        }
    }
}