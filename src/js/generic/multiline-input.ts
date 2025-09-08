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
    private dynamicHeight: boolean
    private currentNumRows: number

    constructor(props?: MultilineInputProps) {
        super()
        const { header, numRows, lines, onChange } = props || {}
        this.dynamicHeight = !numRows

        const field = E("div", { class: "field" })
        if (header) {
            field.appendChild(E("label", {}, header))
        }
        const textArea = E("textarea") as HTMLTextAreaElement
        field.appendChild(textArea)
        this.textArea = textArea
        this.root = E("div", { class: "ui form" }, [field])

        // Set initial contents and height
        this.currentNumRows = numRows || 1
        if (lines) {
            if (this.dynamicHeight) {
                this.currentNumRows = lines.length
            }
            this.setValue(lines.join("\n"))
        }
        textArea.setAttribute("rows", this.currentNumRows.toString())

        if (this.dynamicHeight) {
            textArea.addEventListener("input", () => this.adjustHeightToContent())
        }

        // Call event listener if content has changed after focus is lost
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
    }

    private adjustHeightToContent() {
        if (!this.dynamicHeight) return
        const newNumRows = this.textArea.value.split("\n").length
        if (newNumRows === this.currentNumRows) return
        this.currentNumRows = newNumRows
        this.textArea.setAttribute("rows", this.currentNumRows.toString())
    }

    getValue(): string {
        return this.textArea.value.trim()
    }
    setValue(value: string) {
        this.textArea.value = value
        this.adjustHeightToContent()
    }
}