import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import { Terms } from "../../pages/Legal/Legal";

const SITE = "https://mawzun.org";
const URL = `${SITE}/terms`;
const TITLE = "الشروط والأحكام | موزون";
const DESC =
  "شروط وأحكام استخدام منصة موزون: طبيعة الخدمة، والتزامات المستخدم، وإخلاء المسؤولية، والإيقاف والإنهاء، والقانون الواجب التطبيق والاختصاص القضائي.";

export const Route = createFileRoute("/_public/terms")({
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
  component: asRoute(Terms),
});
