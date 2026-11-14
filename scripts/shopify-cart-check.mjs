// Cart-only check against the Shopify Storefront API (no checkout is opened, nothing is bought, no model call):
//
//   SHOPIFY_STOREFRONT_TOKEN_PUBLIC=… SHOPIFY_VARIANT_EGIFT=67913881616632 node scripts/shopify-cart-check.mjs [--en]
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

const base = (process.env.SHOPIFY_API_BASE || `https://${domain}`).replace(/\/$/, "")
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
