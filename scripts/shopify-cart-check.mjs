// Cart-only check against the Shopify Storefront API (no checkout is opened, nothing is bought, no model call):
//
//   SHOPIFY_STOREFRONT_TOKEN_PUBLIC=… SHOPIFY_VARIANT_EGIFT=67913881616632 node scripts/shopify-cart-check.mjs [--en]
//   SHOPIFY_STOREFRONT_TOKEN_PUBLIC=… SHOPIFY_ADMIN_CLIENT_ID=… SHOPIFY_ADMIN_CLIENT_SECRET=… node scripts/shopify-cart-check.mjs --promo
//
// --promo (hotfix 2026-11-16, the free gift): makes ONE real private code the way a hold does (engine/promo-shopify.ts: GIFT-XXXXXXXX, single use, 100% off the e-gift variant, all customers,
// ends in 10 minutes), makes ONE English cart with it (US, English, the code in discountCodes), prints whether the code is `applicable` and the cart total — it must be `true` and `0.00 USD` —
// and deletes the code again. Nothing is bought, no checkout is opened, no order is made, and only the last four characters of the code are printed. (Needs Node 22.18+, or run it with
// `node --experimental-strip-types`, because it uses the site's own Admin client.) The Admin client id and secret are the Tracking app's; the app needs write_discounts.
//
// --en makes the cart the way an ENGLISH order does (buyerIdentity { countryCode: "US" }, the "ICHIREI English" market) and checks that Shopify prices it in USD: the line's unit price should be
// 25.00 USD, and 17.50 USD in the cart total while the 30% Thanksgiving discount is on. If the currency is not USD it says so and exits with 1 (our site logs the same thing as en_cart_currency_mismatch
// and still sends the buyer to checkout).
//
// It makes one cart with the e-gift variant and prints what Shopify returns: the line's title, the product's title, the SKU, the unit price and the cart's
// totals — and whether an AUTOMATIC discount (the Thanksgiving 30%) was applied to it (discountAllocations / the cart's total). The token is the PUBLIC
// storefront token (it ships in every storefront); it is read from the environment and never printed. Our site never sets a price: this only shows what Shopify does.

const token = (process.env.SHOPIFY_STOREFRONT_TOKEN_PUBLIC || process.env.SHOPIFY_STOREFRONT_TOKEN || '').trim()
const variant = (process.env.SHOPIFY_VARIANT_EGIFT || '67913881616632').trim()
const domain = (process.env.SHOPIFY_STORE_DOMAIN || 'soul-id-2.myshopify.com').trim()
const version = (process.env.SHOPIFY_API_VERSION || '2025-01').trim()
if (!token) {
  console.error('Set SHOPIFY_STOREFRONT_TOKEN_PUBLIC (the public storefront token) first.')
  process.exit(2)
}
const en = process.argv.includes('--en')
const gid = /^\d+$/.test(variant) ? `gid://shopify/ProductVariant/${variant}` : variant
const base = (process.env.SHOPIFY_API_BASE || `https://${domain}`).replace(/\/$/, '')
if (process.argv.includes('--promo')) process.exit(await promoCheck())

async function promoCheck() {
  const { promoShopifyFrom } = await import('../engine/promo-shopify.ts')
  const api = promoShopifyFrom({ ...process.env, SHOPIFY_VARIANT_EGIFT: variant, SHOPIFY_STORE_DOMAIN: domain })
  if (!api) {
    console.error('--promo needs the Admin API: set SHOPIFY_ADMIN_CLIENT_ID and SHOPIFY_ADMIN_CLIENT_SECRET (the Tracking app; it needs write_discounts).')
    return 2
  }
  const now = new Date()
  let made = null
  let code = 0
  try {
    made = await api.createHoldCode('H-cartcheck-' + now.getTime().toString(36), new Date(now.getTime() + 10 * 60_000), now)
    console.log(`1. code made: GIFT-····${made.code.slice(-4)} (single use, 100% off the e-gift variant, all customers, ends in 10 minutes)`)
    const q = `mutation CartCreate($input: CartInput!) @inContext(country: US, language: EN) {
      cartCreate(input: $input) {
        cart { id discountCodes { code applicable } cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } } }
        userErrors { field message }
      }
    }`
    const tryCart = async () => {
      const r = await fetch(`${base}/api/${version}/graphql.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shopify-storefront-access-token': token },
        body: JSON.stringify({ query: q, variables: { input: { lines: [{ merchandiseId: gid, quantity: 1 }], buyerIdentity: { countryCode: 'US', email: 'cart-check@example.com' }, discountCodes: [made.code] } } }),
      })
      const j = await r.json()
      if (!r.ok || j.errors?.length || j.data?.cartCreate?.userErrors?.length) throw new Error(`cart: ${r.status} ${JSON.stringify(j.errors ?? j.data?.cartCreate?.userErrors ?? j).slice(0, 300)}`)
      return j.data.cartCreate.cart
    }
    let cart = await tryCart()
    let applicable = (cart.discountCodes ?? []).find((d) => d.code.toUpperCase() === made.code.toUpperCase())?.applicable === true
    if (!applicable || Number(cart.cost.totalAmount.amount) !== 0) {
      console.log('   first cart not free yet (a new code can take a few seconds): trying once more in 2 s…')
      await new Promise((r) => setTimeout(r, 2000))
      cart = await tryCart()
      applicable = (cart.discountCodes ?? []).find((d) => d.code.toUpperCase() === made.code.toUpperCase())?.applicable === true
    }
    const total = `${Number(cart.cost.totalAmount.amount).toFixed(2)} ${cart.cost.totalAmount.currencyCode}`
    console.log(`2. en cart made (US, English) with that code; subtotal ${Number(cart.cost.subtotalAmount.amount).toFixed(2)} ${cart.cost.subtotalAmount.currencyCode}`)
    console.log(`3. applicable: ${applicable}`)
    console.log(`   total: ${total}`)
    const ok = applicable && Number(cart.cost.totalAmount.amount) === 0 && cart.cost.totalAmount.currencyCode === 'USD'
    console.log(ok ? '   OK: the held cart is free ($0.00 USD) and the code is applicable.' : '   NOT FREE: expected applicable true and 0.00 USD.')
    code = ok ? 0 : 1
  } catch (err) {
    console.error('--promo failed:', err instanceof Error ? err.message : err)
    code = 1
  } finally {
    if (made) {
      try {
        await api.deleteHoldCode(made.discountId)
        console.log('4. code deleted.')
      } catch (err) {
        console.error('4. the code could not be deleted (it ends by itself in 10 minutes):', err instanceof Error ? err.message : err)
        code = code || 1
      }
    }
  }
  console.log('(cart only — no checkout was opened, nothing was bought)')
  return code
}

const query = `mutation($input: CartInput!) {
  cartCreate(input: $input) {
    cart {
      id
      lines(first: 5) { nodes {
        quantity
        merchandise { ... on ProductVariant { id title sku price { amount currencyCode } product { title } } }
        cost { amountPerQuantity { amount currencyCode } subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
        discountAllocations { discountedAmount { amount currencyCode } ... on CartAutomaticDiscountAllocation { title } }
      } }
      cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
      discountAllocations { discountedAmount { amount currencyCode } ... on CartAutomaticDiscountAllocation { title } }
    }
    userErrors { field message }
  }
}`

const res = await fetch(`${base}/api/${version}/graphql.json`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-shopify-storefront-access-token': token },
  body: JSON.stringify({ query, variables: { input: { lines: [{ merchandiseId: gid, quantity: 1 }], ...(en ? { buyerIdentity: { countryCode: 'US' } } : {}) } } }),
})
const json = await res.json()
if (!res.ok || json.errors?.length) {
  console.error('Shopify said:', res.status, JSON.stringify(json.errors ?? json).slice(0, 500))
  process.exit(1)
}
const out = json.data?.cartCreate
if (out?.userErrors?.length) {
  console.error('The cart was refused:', JSON.stringify(out.userErrors))
  process.exit(1)
}
const cart = out.cart
for (const l of cart.lines.nodes) {
  const m = l.merchandise
  console.log(`line: product "${m.product.title}" · variant "${m.title}" · SKU ${m.sku ?? '(none)'} · list price ${m.price.amount} ${m.price.currencyCode}`)
  console.log(`      unit ${l.cost.amountPerQuantity.amount} · line total ${l.cost.totalAmount.amount} ${l.cost.totalAmount.currencyCode} · discounts on the line: ${JSON.stringify(l.discountAllocations.map((d) => ({ title: d.title ?? null, off: d.discountedAmount.amount })))}`)
}
console.log(`cart: subtotal ${cart.cost.subtotalAmount.amount} · total ${cart.cost.totalAmount.amount} ${cart.cost.totalAmount.currencyCode} · cart-level discounts: ${JSON.stringify(cart.discountAllocations.map((d) => ({ title: d.title ?? null, off: d.discountedAmount.amount })))}`)
if (en) {
  const cur = cart.cost.totalAmount.currencyCode
  console.log(`--en: buyer country US → the cart is priced in ${cur}: ${cur === 'USD' ? 'OK (an English, USD checkout)' : 'MISMATCH — expected USD. Check that the "ICHIREI English" market includes the United States, USD, and the catalog "ICHIREI English" with the e-gift at 25.00.'}`)
  if (cur !== 'USD') {
    console.log('(cart only — no checkout was opened)')
    process.exit(1)
  }
}
console.log('(cart only — no checkout was opened)')
