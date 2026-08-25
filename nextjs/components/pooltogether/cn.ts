/** Minimal classNames joiner (stand-in for the classnames package used by
 *  the original pooltogether.com source this layout is derived from). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
