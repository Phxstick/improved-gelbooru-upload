import Component from "js/generic/component"
import { E } from "js/utility"

interface DropdownMenuProps {
    header: string
    onSelect: (value: string) => void
    values?: string[]
    labels?: Record<string, string>
    duration?: number
    direction?: "auto" | "upward" | "downward"
}

export default class DropdownMenu extends Component {
    private dropdownMenu: HTMLElement
    private dropdownLabel: HTMLElement

    constructor(props: DropdownMenuProps) {
        super()
        const { header, onSelect, values, labels, duration=160, direction="auto" } = props
        this.dropdownMenu = E("div", { class: "menu" })
        this.dropdownLabel = E("div", { class: "ui dropdown" }, [
            E("div", { class: "text" }, header),
            E("i", { class: "dropdown icon" }),
            this.dropdownMenu
        ])
        $(this.dropdownLabel).dropdown({
            action: "hide",
            onChange: (value: string) => onSelect(value),
            duration,
            direction
        } as any)
        this.root = this.dropdownLabel
        if (values) this.setItems(values, labels)
    }

    addMenuItem(value: string, label?: string) {
        const menuItem = E("a", { class: "item", value }, label || value)
        this.dropdownMenu.appendChild(menuItem)
    }

    setItems(newValues: string[], newLabels: Record<string, string>={}) {
        this.dropdownMenu.innerHTML = ""
        newValues.forEach(value => this.addMenuItem(value, newLabels[value]))
        this.dropdownLabel.classList.toggle("hidden", newValues.length === 0)
    }
}