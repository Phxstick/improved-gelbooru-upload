import Component from "js/generic/component"
import { E } from "js/utility"

interface DropdownMenuProps {
    header: string
    onSelect: (value: string) => void
    values?: string[]
    labels?: Record<string, string>
    position?: string
}

export default class DropdownMenu extends Component {
    private popupMenu: HTMLElement
    private dropdownLabel: HTMLElement

    constructor(props: DropdownMenuProps) {
        super()
        const { header, onSelect, values, labels, position="bottom left" } = props
        this.popupMenu = E("div", { class: "ui popup vertical menu hidden" })
        this.popupMenu.addEventListener("click", (event) => {
            const target = event.target as HTMLElement | null
            if (target === null) return
            if (target.parentElement !== this.popupMenu) return
            onSelect(target.dataset.value!)
        })
        this.dropdownLabel = E("div",
            { class: "ui hidden dropdown", dataset: { position } },
            [ header, E("i", { class: "dropdown icon" }) ])
        $(this.dropdownLabel).popup({
            popup: $(this.popupMenu),
            variation: "basic",
            hoverable: true,
            lastResort: position,
            distanceAway: -7
        })
        this.root = this.dropdownLabel
        if (values) this.setItems(values, labels)
    }

    addMenuItem(value: string, label?: string) {
        const menuItem = E("a", { class: "item", dataset: { value } }, label || value)
        this.popupMenu.appendChild(menuItem)
    }

    setItems(newValues: string[], newLabels: Record<string, string>={}) {
        this.popupMenu.innerHTML = ""
        newValues.forEach(value => this.addMenuItem(value, newLabels[value]))
        this.dropdownLabel.classList.toggle("hidden", newValues.length === 0)
    }
}