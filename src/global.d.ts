
// Remove this when Semantic UI typings are updated
declare namespace SemanticUI {
    namespace DropdownSettings {
        type Param = Partial<_Impl> & {
            clearable: boolean;
            delimiter: string;
        }
    }
    namespace SearchSettings {
        type Param = Partial<_Impl> & {
            searchOnFocus: boolean
            fullTextSearch: boolean
        }
    }
}