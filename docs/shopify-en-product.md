# ICHIREI — English product text for Shopify (US e-gift launch, 2026-11-12)

For the owner to paste into the ICHIREI product in Shopify admin. Nothing here is applied by the site's code.

**Title**

```
ICHIREI — One Japanese Character Chosen From Your Story (Personalized Gift from Tokyo)
```

**Description**

```
A personalized gift from Japan. Write a short story about someone you love — your mom, your dad, your partner, a friend — and from that story you choose one Japanese character (kanji) that says what you see in them. It arrives as a private e-gift page the same day: the character with its reading and meaning, a short poem written from your story, four pictures of your story, a short film with music, and a certificate. Share it by email, WhatsApp or text, or schedule it to open on Christmas morning.

Designed in Tokyo. Delivered worldwide.

For: Christmas, Thanksgiving, birthdays, anniversaries, Mother's Day, Father's Day, graduation, retirement, thank-you gifts, and remembrance.

Delivery: the e-gift arrives the same day you order, any day of the year.

Refunds: you can cancel for a full refund within 24 hours of payment, as long as you have not opened the gift with "Collect your gift". After that, the gift has been made for one person and cannot be refunded. If we made a mistake, we will fix it or refund you. Questions: info@beyondculture.ai.
```

## Owner checklist (Shopify admin — the owner's, not the builder's)

Touch only the ICHIREI product. Never change store-wide settings, other products, or the 「つまずき注文チェック」 app.

1. **E-gift variant:** check that "This is a physical product" is off, so checkout asks for email only. Weight 0.
2. **Product text (en):** paste the title and description above.
3. **ChatGPT / Agentic:** in Sales channels → Agentic, check whether the ICHIREI product shows as eligible. If it isn't, send a screenshot to the marketing director before changing anything.
4. **Policies:** check that Settings → Policies has a refund policy. Never overwrite one that other products rely on. If it is empty or generic, the product description above carries the ICHIREI rule.
5. **Business profile:** after the above, claim the business profile at chatgpt.com/business-hub.

## What the site does for the English launch (no Shopify admin involved)

- **UTM:** utm_source / utm_medium / utm_campaign / utm_term / utm_content on an `/en` link are kept for the visitor's tab and sent with an English order as hidden cart-line properties `_utm_source` etc., so each order shows where it came from (ChatGPT adds `utm_source=chatgpt.com` itself).
- **Dollar price (2026-11-14):** `/en` shows a fixed dollar price — `$25` — and no yen, no "about" figure; while the Thanksgiving sale is on, `$25` struck through then `$17`. The numbers are the Cloud Build substitutions `_USD_PRICE_EGIFT` (25) and `_USD_PRICE_EGIFT_SALE` (17), whole dollars, yours to edit. Checkout itself stays in yen (the Shopify variant price, ¥3,980; ¥2,786 in the sale), and one small line above the order button says so. `USD_PER_JPY` is no longer used.
