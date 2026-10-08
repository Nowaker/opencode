import { onClick } from "../../ui/click"

// A section header is also the handle that drags a section and the place another section
// is dropped on, so it toggles only when it is pressed and released on the same cell.
export const onHeaderClick = onClick
