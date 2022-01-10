import Component from "js/generic/component"
import { E } from "js/utility"

interface RadiobuttonProps {
    name: string
    header?: string
    inline?: boolean
    values: string[]
    labels: { [key in string]: string }
    defaultValue: string
    onChange?: (value: string) => void
}

export default class RadioButtons extends Component {
    private currentValue: string
    private defaultValue: string
    private valueToCheckbox: { [key in string]: HTMLElement } = {}
    private onChange?: (value: string) => void

    constructor(props: RadiobuttonProps) {
        super()
        const { name, header, values, labels, defaultValue, onChange } = props
        const buttonContainer = E("div", { class: "grouped fields" })
        if (props.header) {
            buttonContainer.appendChild(E("label", {}, header))
        }
        if (props.inline) {
            buttonContainer.classList.add("inline")
        }
        for (const value of values) {
            const checked = defaultValue === value ? "checked" : undefined
            const checkbox = E("div", { class: "ui radio checkbox" }, [
                E("input", { type: "radio", name, checked }),
                E("label", {}, labels[value])
            ])
            this.valueToCheckbox[value] = checkbox
            $(checkbox).checkbox({
                onChecked: () => {
                    this.currentValue = value
                    if (onChange) onChange(value)
                }
            })
            const row = E("div", { class: "field" }, [checkbox])
            buttonContainer.appendChild(row)
        }
        this.currentValue = props.defaultValue
        this.defaultValue = defaultValue
        this.onChange = onChange
        this.root = E("div", { class: "ui form" }, [buttonContainer])
    }

    getValue(): string {
        return this.currentValue
    }

    setValue(value: string) {
        $(this.valueToCheckbox[value]).checkbox("set checked")
        this.currentValue = value
        if (this.onChange) this.onChange(value)
    }

    reset() {
        this.setValue(this.defaultValue)
    }
}