
// Clear active selection by pressing escape
window.addEventListener("keydown", (event) => {
    if (Selection.activeSelection && event.key === "Escape") {
        Selection.activeSelection.clear()
    }
});

// Clear active selection if no selectable element was clicked
window.addEventListener("click", (event) => {
    if (Selection.activeSelection && !Selection.elementClicked &&
            Selection.activeSelection.isCancelledByClickedElement(event.target as HTMLElement)) {
        Selection.activeSelection.clear()
    }
    Selection.elementClicked = false
})

interface Params {
    isSelectable?: (element: HTMLElement) => boolean
    // Clicking elements which are included in the set of associated elements or
    // descendents thereof will not cancel the selection
    associatedElements?: Set<HTMLElement>
    onCleared?: () => void
}

export default class Selection {
    // Only a single selection can be active at a time
    static activeSelection: Selection | null = null
    static elementClicked = false

    private selectedElements = new Set<HTMLElement>()
    private associatedElements = new Set<HTMLElement>()
    private onChanged = () => { }
    private onCleared = () => { }

    constructor(viewElement: HTMLElement, {
        isSelectable=(element: HTMLElement) => element.parentElement === viewElement,
        associatedElements=new Set(),
        onCleared=() => {}
    }: Params={}) {
        this.onCleared = onCleared
        this.associatedElements = associatedElements
        viewElement.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;

            // Find the closest selectable ancestor that's part of the view
            while (target !== viewElement) {
                if (isSelectable(target)) break
                target = target.parentElement!
            }
            if (target === viewElement) return;
            Selection.elementClicked = true

            // Clear active selection if it's in a different view
            if (Selection.activeSelection !== this) {
                if (Selection.activeSelection) Selection.activeSelection.clear()
                Selection.activeSelection = this
            }

            // If no modifier key is pressed, narrow selection to clicked element
            const modifierUsed = event.ctrlKey || event.shiftKey;
            if(!modifierUsed) {
                const singleElementSelected = this.selectedElements.size === 1
                this.clear();
                Selection.activeSelection = this
                if (!this.selectedElements.has(target)) {
                    this.selectedElements.add(target);
                    target.classList.add("selected");
                    target.classList.add("last-selected");
                
                // If only this element was selected, unselect clicked element
                } else if (singleElementSelected) {
                    Selection.activeSelection = null
                }
            }

            // If ctrl is pressed (but not shift), add/remove from selection
            const next = target.nextElementSibling as HTMLElement;
            const prev = target.previousElementSibling as HTMLElement;
            if (event.ctrlKey && !event.shiftKey) {
                if (!this.selectedElements.has(target)) {
                    this.selectedElements.add(target);
                    target.classList.add("selected");
                    if (next === null || !this.selectedElements.has(next))
                        target.classList.add("last-selected");
                    if (prev !== null && this.selectedElements.has(prev))
                        prev.classList.remove("last-selected");
                } else {
                    this.selectedElements.delete(target);
                    target.classList.remove("selected");
                    target.classList.remove("last-selected");
                    if (prev !== null && this.selectedElements.has(prev))
                        prev.classList.add("last-selected");
                }
                if (this.selectedElements.size === 0)
                    Selection.activeSelection = null
                this.onChanged();
            }

            if (!event.shiftKey) return
            // TODO: consider to allow choosing arbitrary views or multiple
            const children = viewElement.children;

            // Shift pressed, nothing selected -> select all up to first
            if (this.selectedElements.size === 0) {
                let i = 0;
                while (children[i] !== target) {
                    this.selectedElements.add(children[i] as HTMLElement);
                    children[i].classList.add("selected");
                    ++i;
                }
                this.selectedElements.add(target);
                target.classList.add("selected");
                target.classList.add("last-selected");
                this.onChanged();
                return;
            }

            // If only selected element is this one, do nothing
            if (this.selectedElements.size === 1 &&
                    this.selectedElements.has(target)) return;

            // Otherwise, try to select until first selected above this
            let element = target.previousElementSibling as HTMLElement | null;
            while (element !== null) {
                if (this.selectedElements.has(element)) {
                    element.classList.remove("last-selected");
                    const selectionChanged = element !== target;
                    while (element !== target) {
                        element = element!.nextSibling as HTMLElement | null;
                        this.selectedElements.add(element!);
                        element!.classList.add("selected");
                    }
                    if (next === null || !this.selectedElements.has(next))
                        target.classList.add("last-selected");
                    if (selectionChanged) this.onChanged();
                    return;
                }
                element = element.previousSibling as HTMLElement | null;
            }

            // If there's no selected node above, select bottomwards
            element = target;
            const selectionChanged = !this.selectedElements.has(element);
            while (element && !this.selectedElements.has(element)) {
                this.selectedElements.add(element);
                element.classList.add("selected");
                element = element.nextSibling as HTMLElement | null;
            }
            if (selectionChanged) this.onChanged();
        })
    }

    clear() {
        for (const element of this.selectedElements) {
            element.classList.remove("selected");
            element.classList.remove("last-selected");
        }
        Selection.activeSelection = null
        this.selectedElements.clear();
        this.onCleared();
        this.onChanged();
    }

    add(element: HTMLElement, triggerListener=true) {
        if (this.selectedElements.has(element)) return
        element.classList.add("selected")
        const nextElement = element.nextElementSibling as HTMLElement | null
        const prevElement = element.previousElementSibling as HTMLElement | null
        if (nextElement === null || !this.selectedElements.has(nextElement)) {
            element.classList.add("last-selected")
        }
        if (prevElement !== null && this.selectedElements.has(prevElement)) {
            prevElement.classList.add("last-selected")
        }
        this.selectedElements.add(element)
        if (triggerListener) this.onChanged();
    }

    addMultiple(elements: HTMLElement[]) {
        for (const element of elements) {
            this.add(element, false)
        }
        this.onChanged()
    }

    size(): number {
        return this.selectedElements.size
    }

    contains(element: HTMLElement): boolean {
        return this.selectedElements.has(element)
    }

    get(): Set<HTMLElement> {
        return this.selectedElements
    }

    isCancelledByClickedElement(element: HTMLElement) {
        for (const associatedElement of this.associatedElements) {
            if (associatedElement.contains(element)) return false
        }
        return true
    }

    setOnChanged(callback: () => void) {
        this.onChanged = callback
    }

    setOnCleared(callback: () => void) {
        this.onCleared = callback
    }

    setAssociatedElements(elements: Set<HTMLElement>) {
        this.associatedElements = elements
    }
}