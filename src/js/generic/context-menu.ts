
type Condition<DataType> = (data: DataType) => boolean | Promise<boolean>
type Action<DataType> = (data: DataType) => void
interface ContextMenuItem<DataType> {
    title: string,
    action: Action<DataType>,
    icon?: string,
    condition?: Condition<DataType>
}

export default class ContextMenu<DataType=HTMLElement> {
    private isOpen = false
    private currentData!: DataType
    private indexToCondition = new Map<number, Condition<DataType>>();

    private wrapper: HTMLElement = document.createElement("div");
    private menu: HTMLElement = document.createElement("div");
    private elements: HTMLElement[] = []

    constructor(items: (ContextMenuItem<DataType> | null)[]) {

        // Create HTML elements
        this.wrapper = document.createElement("div");
        this.wrapper.style.position = "fixed";
        this.wrapper.style.zIndex = "1000";  // Should be above semantic modal
        this.wrapper.classList.add("hidden");
        this.menu = document.createElement("div");
        this.menu.classList.add("ui", "compact", "vertical",
                                "borderless", "menu");

        const itemsHTML = [];
        const callbacks: Action<DataType>[] = [];
        let index = 0;
        for (const menuItem of items) {
            if (menuItem === null) {
                itemsHTML.push("<div class='ui divider'></div>")
                continue;
            }
            const { title, icon, action, condition } = menuItem
            callbacks.push(action);
            if (condition) this.indexToCondition.set(index, condition)
            const iconHTML = icon ? `<i class="left ${icon} icon"></i>\n` : "";
            const itemHTML = `
                <a class="item" data-index="${index}">
                  ${iconHTML}${title}
                </a>
            `;
            itemsHTML.push(itemHTML.trim());
            index++;
        }
        this.menu.innerHTML = itemsHTML.join("\n");
        this.wrapper.appendChild(this.menu);
        for (const menuElement of this.menu.children) {
            this.elements.push(menuElement as HTMLElement)
        }

        // Execute given callbacks when an item is clicked
        this.menu.addEventListener("click", (event) => {
            let node = event.target as HTMLElement
            while (node.parentNode !== this.menu) {
                if (node.parentNode === null) return
                node = node.parentNode as HTMLElement
            }
            this.close()
            callbacks[parseInt(node.dataset.index!)](this.currentData);
        });

        // Close menu when mouse is pressed somewhere outside of it
        window.addEventListener("mousedown", (event) => {
            if (!this.isOpen) return
            if (this.wrapper.contains(event.target as HTMLElement)) return
            this.close()
        });
    }
    
    async open(event: MouseEvent, data: DataType) {
        event.preventDefault()  // Don't open native context menu
        this.isOpen = true;
        this.currentData = data;

        // Attach menu to DOM if not done yet
        if (this.wrapper.parentElement === null) {
            document.body.appendChild(this.wrapper);
        }

        // Determine which items get displayed (using given condition functions)
        this.menu.innerHTML = ""
        const visibleItems = new Set<HTMLElement>()
        for (const menuItemElement of this.elements) {
            let index = menuItemElement.dataset.index
            // No index means that the item is a separator
            if (index === undefined) {
                this.menu.appendChild(menuItemElement)
                continue
            }
            const conditionFunc = this.indexToCondition.get(parseInt(index))
            // No condition function means that the item is always visible
            if (!conditionFunc || await conditionFunc(data)) {
                this.menu.appendChild(menuItemElement)
                visibleItems.add(menuItemElement)
            }
        }

        // If no items are displayed, don't show the menu at all
        if (visibleItems.size === 0) {
            this.isOpen = false;
            return 
        }

        // Hide separators that are not needed anymore (i.e. they're the last
        // visible item or they are followed by another separator)
        for (const menuItemElement of this.elements) {
            let index = menuItemElement.dataset.index
            if (index !== undefined) continue
            let nextItem = menuItemElement.nextElementSibling as HTMLElement | null
            if (nextItem === null || nextItem.dataset.index === undefined) {
                menuItemElement.remove()
            }
        }

        // Show menu and make sure it's doesn't leave the page bounds
        this.wrapper.classList.remove("hidden");
        const height = this.wrapper.offsetHeight;
        const width = this.wrapper.offsetWidth;
        let x = event.clientX;
        let y = event.clientY;
        if (y + height > window.innerHeight) {
            y -= height
            // Reverse item order if menu is displayed above instead of below
            const reversedItems = [...this.menu.children].reverse()
            this.menu.innerHTML = ""
            this.menu.append(...reversedItems)
        }
        if (x + width > window.innerWidth) x -= (x + width - window.innerWidth)
        this.wrapper.style.left = `${x}px`;
        this.wrapper.style.top = `${y}px`;
    }

    close() {
        if (!this.isOpen) return;
        this.wrapper.classList.add("hidden");
        this.isOpen = false;
    }

    attachTo(element: HTMLElement, data: DataType) {
        element.addEventListener("contextmenu", (event) => {
            if (event.target !== element) return
            this.open(event, data)
        })
    }

    attachToMultiple(rootElement: HTMLElement, selector: string,
            dataExtractor: (element: HTMLElement) => DataType) {
        rootElement.addEventListener("contextmenu", (event) => {
            if (event.target === rootElement) return
            const element = event.target as HTMLElement
            const contextMenuTarget = element.closest(selector) as HTMLElement
            if (contextMenuTarget === null) return
            this.open(event, dataExtractor(contextMenuTarget))
        })
    }

    getElement(): HTMLElement {
        return this.wrapper
    }
}
