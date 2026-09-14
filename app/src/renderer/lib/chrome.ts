/**
 * Window chrome geometry (issue #21).
 *
 * The window is `titleBarStyle: 'hiddenInset'` with `trafficLightPosition {x:14, y:14}`, so
 * macOS paints close/minimise/zoom *over* the renderer's top-left corner and nothing in the
 * DOM knows they are there. Anything the renderer draws in that corner — the brand, a title,
 * a toolbar button — ends up underneath them.
 *
 * The fix is one number, kept here so the title bar and its tests agree on it: reserve the
 * left edge of the custom title bar as an empty, draggable spacer.
 *
 * 14 px inset + three 12 px buttons + two 20 px gaps ≈ 64 px, and the zoom button's focus ring
 * needs a little air after it — 78 px is that, rounded up to something a designer can reason
 * about. In fullscreen macOS takes the buttons away entirely, so the spacer must collapse or
 * the title sits absurdly far right (and, in a narrow window, pushes the toolbar off the edge).
 */

/** Width of the empty region the traffic lights occupy, in CSS pixels. */
export const TRAFFIC_LIGHT_INSET = 78;

/** Left padding for the custom title bar: the traffic-light reserve, or nothing in fullscreen. */
export function titleBarInset(fullScreen: boolean): number {
  return fullScreen ? 0 : TRAFFIC_LIGHT_INSET;
}
