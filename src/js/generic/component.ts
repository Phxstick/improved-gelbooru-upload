import { ElementStore, createElementStore } from "js/utility"

export default class Component {
    protected root: HTMLElement
    protected $: ElementStore
    
    protected constructor(rootElement?: HTMLElement) {
        this.root = rootElement ? rootElement : document.createElement("div");
        this.$ = createElementStore(this.root)
    }

    public getElement(): HTMLElement {
        return this.root
    }
}