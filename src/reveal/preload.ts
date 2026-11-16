const BASE = import.meta.env.BASE_URL

/** The same sources as <Picture> (WebP at 640/1280 with the JPG as the fallback), fetched ahead so a slide can wait until its picture is really there. Resolves true when it loaded. */
export function preloadPicture(name: string, sizes: string): Promise<boolean> {
  const one = (set: (img: HTMLImageElement) => void) =>
    new Promise<boolean>((resolve) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      set(img)
    })
  return one((img) => {
    img.sizes = sizes
    img.srcset = `${BASE}img/${name}-640.webp 640w, ${BASE}img/${name}-1280.webp 1280w`
  }).then((ok) => ok || one((img) => (img.src = `${BASE}img/${name}.jpg`)))
}
