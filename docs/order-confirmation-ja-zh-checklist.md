# Order confirmation — Japanese and Chinese (2026-11-15): what to paste where

The Japanese and Chinese orders use the store's CUSTOMISED template (the one that already contains the ICHIREI block from `docs/ichirei-order-email.liquid`, placed under the heading). Checked the same way as the English one:

1. **The block is there and links to the buyer's page** (`/a/AN-…`, never `/g/…`) with its own button — 「ご注文ページを開く」 / 「打開訂單頁面」 / 「打开订单页面」. So a ja / zh customer can reach the gift from the e-mail. Nothing to change for that.
2. **The template's own action row** ("ご注文の詳細を表示" → Shopify's order page, "ストアにアクセス" → the shared store) is the part that sends people to the wrong place. For an ICHIREI order hide it, and keep Shopify's order page only as a small "receipt" link. Paste this at the very top of the customised template, once:

```liquid
{%- assign has_ichirei = false -%}
{%- for line in subtotal_line_items -%}
  {%- assign ref = line.properties['_order_ref'] | default: line.properties['order_ref'] -%}
  {%- if ref != blank or line.sku contains 'ICHIREI-' -%}{%- assign has_ichirei = true -%}{%- endif -%}
{%- endfor -%}
```

   then wrap the template's action row (the buttons "ご注文の詳細を表示" / "ストアにアクセス", in the Chinese template the equivalents) in `{%- unless has_ichirei -%} … {%- endunless -%}`, and below the order summary add `{%- if has_ichirei and order_status_url -%}<p><a href="{{ order_status_url }}">ご注文の詳細（領収書）</a></p>{%- endif -%}` (Chinese: 訂單詳情／收據 · 订单详情／收据).
3. **English orders** do not use the customised template: paste `docs/order-confirmation-en.liquid` into the ENGLISH version of "Order confirmation".

Where: Shopify admin → Settings → Notifications → Customer notifications → Order confirmation → (language switch at the top) → Edit code. The owner and the architect paste it; nothing here touches Shopify.
