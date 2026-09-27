import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import Welcome from "../../pages/Welcome/Welcome";

const SITE = "https://mawzun.org";
const OG_IMAGE = `${SITE}/og.png`; // 1200x630 raster — SVG is not rendered by WhatsApp/Facebook/LinkedIn/iMessage
const TITLE = "موزون | نظام إدارة المبيعات والمخازن والعمليات";
const DESC =
  "موزون — نظام عربي لإدارة المبيعات والمخازن والمشتريات والشحن والحسابات من لوحة واحدة، مع مزامنة Shopify تلقائية ومفاتيح API للوكلاء.";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },

      /* ── Indexing ── */
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      { name: "googlebot", content: "index, follow, max-image-preview:large" },
      { name: "author", content: "Mawzun" },
      { name: "publisher", content: "Mawzun" },
      { name: "theme-color", content: "#0f172a" },
      { name: "color-scheme", content: "light dark" },
      { name: "format-detection", content: "telephone=no" },
      { name: "application-name", content: "Mawzun" },
      { name: "apple-mobile-web-app-title", content: "موزون" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },

      /* ── Keywords (low weight, harmless) ── */
      {
        name: "keywords",
        content:
          "نظام إدارة المبيعات, إدارة المخزون, مزامنة شوبيفاي, Shopify, ERP عربي, برنامج حسابات, إدارة الطلبات, المخازن, المشتريات, الشحن, فواتير, وكلاء الذكاء الاصطناعي, API, موزون, Mawzun",
      },

      /* ── Open Graph — this is what WhatsApp / Facebook / LinkedIn / Slack read ── */
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "موزون" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: `${SITE}/` },
      { property: "og:locale", content: "ar_EG" },
      { property: "og:locale:alternate", content: "ar" },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:secure_url", content: OG_IMAGE },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "موزون — لوحة إدارة المبيعات والمخازن والعمليات" },

      /* ── Link preview (used by WhatsApp, Slack, Discord, Telegram, iMessage) ── */
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:image:alt", content: "موزون — لوحة إدارة المبيعات والمخازن" },
    ],
    links: [
      { rel: "canonical", href: `${SITE}/` },
      // NOTE: the key must be lowercase `hreflang` — TanStack renders link attrs
      // verbatim, and React-style `hrefLang` emits invalid HTML that crawlers ignore.
      { rel: "alternate", hreflang: "ar", href: `${SITE}/` },
      { rel: "alternate", hreflang: "ar-EG", href: `${SITE}/` },
      { rel: "alternate", hreflang: "x-default", href: `${SITE}/` },
      { rel: "alternate", type: "text/plain", href: `${SITE}/llms.txt`, title: "llms.txt" },
      { rel: "sitemap", type: "application/xml", href: `${SITE}/sitemap.xml` },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/og.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE}/#org`,
              name: "موزون",
              alternateName: "Mawzun",
              url: `${SITE}/`,
              logo: { "@type": "ImageObject", url: `${SITE}/logo_scale.svg` },
              image: OG_IMAGE,
              email: "help@mawzun.org",
              founder: { "@type": "Person", name: "Mohamed A. Yassin", url: "https://yassin.dev" },
              sameAs: [
                "https://docs.mawzun.org/",
                "https://app.mawzun.org/",
                "https://status.mawzun.org/",
              ],
            },
            {
              "@type": "SoftwareApplication",
              "@id": `${SITE}/#app`,
              name: "موزون",
              alternateName: "Mawzun",
              url: `${SITE}/`,
              applicationCategory: "BusinessApplication",
              applicationSubCategory: "ERP",
              operatingSystem: "Web",
              browserRequirements: "Requires JavaScript",
              inLanguage: "ar",
              isAccessibleForFree: true,
              image: OG_IMAGE,
              description:
                "Arabic-first operations platform: sales, inventory, purchasing, fulfillment, shipping and accounting in one dashboard, with automatic Shopify sync and API keys for AI agents.",
              featureList: [
                "قيادة المبيعات",
                "قيادة المخزون",
                "مزامنة Shopify تلقائية",
                "وكلاء AI عبر API",
                "دورة الطلب كاملة",
                "صلاحيات دقيقة",
                "فواتير وكوبونات",
                "تعدد المخازن",
              ],
              offers: { "@type": "Offer", price: "0", priceCurrency: "EGP" },
              provider: { "@id": `${SITE}/#org` },
            },
            {
              "@type": "WebSite",
              "@id": `${SITE}/#website`,
              url: `${SITE}/`,
              name: "موزون",
              alternateName: "Mawzun",
              inLanguage: "ar",
              publisher: { "@id": `${SITE}/#org` },
            },
            {
              "@type": "WebPage",
              "@id": `${SITE}/#webpage`,
              url: `${SITE}/`,
              name: TITLE,
              description: DESC,
              isPartOf: { "@id": `${SITE}/#website` },
              about: { "@id": `${SITE}/#app` },
              inLanguage: "ar",
              primaryImageOfPage: OG_IMAGE,
            },
          ],
        }),
      },
    ],
  }),
  component: asRoute(Welcome),
});
