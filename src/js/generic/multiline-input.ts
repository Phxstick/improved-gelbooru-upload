import Component from "js/generic/component"
import { E } from "js/utility"

interface MultilineInputProps {
    header?: string
    numRows?: number
    lines?: string[]
    onChange?: (lines: string[]) => void
}

export default class MultilineInput extends Component {
    private textArea: HTMLTextAreaElement

    constructor(props: MultilineInputProps) {
        super()
        const { header, numRows, lines, onChange } = props
        const field = E("div", { class: "field" })
        if (header) {
            field.appendChild(E("label", {}, header))
        }
        const textArea = E("textarea") as HTMLTextAreaElement
        if (numRows) {
            textArea.setAttribute("rows", numRows.toString())
        }
        if (lines) {
            textArea.value = lines.join("\n")
        }
        field.appendChild(textArea)
        let previousValue: string
        textArea.addEventListener("focusin", () => {
            previousValue = textArea.value
        })
        const checkChange = () => {
            const newValue = textArea.value
            if (previousValue === newValue) return
            if (onChange) onChange(newValue.split("\n").map(line => line.trim()))
        }
        if (onChange) {
            textArea.addEventListener("focusout", checkChange)
            window.addEventListener("beforeunload", checkChange)
        }
        this.textArea = textArea
        this.root = E("div", { class: "ui form" }, [field])
    }

    getValue(): string {
        return this.textArea.value
    }
}