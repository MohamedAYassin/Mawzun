import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import { Privacy } from "../../pages/Legal/Legal";

const SITE = "https://mawzun.org";
const URL = `${SITE}/privacy`;
const TITLE = "سياسة الخصوصية | موزون";
const DESC =
  "سياسة الخصوصية لمنصة موزون: البيانات التي نجمعها، وأغراض المعالجة، ومشاركتها، ومدة الاحتفاظ بها، وحقوق المستخدم، وفقاً لأحكام قانون حماية البيانات الشخصية المصري.";

export const Route = createFileRoute("/_public/privacy")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "article" },
      { property: "og:site_name", content: "موزون" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:locale", content: "ar_EG" },
      { property: "og:image", content: `${SITE}/og.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: `${SITE}/og.png` },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: asRoute(Privacy),
});
