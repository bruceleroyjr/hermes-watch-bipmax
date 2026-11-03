// Long answers on the watch are shown a page at a time, with "< Back" and "More >". Pure text splitting, so it is tested in Node (test/pager.test.mjs).
export const PAGE_CHARS = 320

// Split text into pages of at most max characters, breaking between words (the last space before the
// limit); line breaks inside a page stay. One word longer than max (a long link) is cut at max.
export function paginate(text, max = PAGE_CHARS) {
  let rest = String(text == null ? '' : text).trim()
  if (rest.length <= max) return [rest]
  const pages = []
  while (rest.length > max) {
    let cut = rest.slice(0, max + 1).search(/\s\S*$/)
    if (cut <= 0) cut = max
    pages.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) pages.push(rest)
  return pages
}
