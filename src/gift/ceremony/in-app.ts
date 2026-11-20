// Part 13 (2026-11-20): an in-app browser (LINE, Instagram, Facebook, WeChat), detected from the user agent. In it a 保存 only downloads a file the person cannot find, so the keepsakes screen
// says to open the page in the browser. Safari and Chrome are not in-app browsers.

const IN_APP = /\bLine\/|\bLIAPP\b|Instagram|FBAN|FBAV|FB_IAB|MicroMessenger|WeChat/i

export const isInAppBrowser = (userAgent: string | null | undefined): boolean => IN_APP.test(userAgent ?? '')
