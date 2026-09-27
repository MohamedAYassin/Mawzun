import { memo } from "react";

// Product image with quota-friendly loading. R2 objects are stored with
// `Cache-Control: public, max-age=31536000, immutable`, so the browser serves
// repeat views from disk and R2 egress happens once per image per device.
// lazy + async decode keeps long gallery lists from fetching off-screen.
function ProductImageBase({
  src,
  alt,
  size = 40,
  style,
}: {
  src: string | null | undefined;
  alt: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  if (!src) {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          background: "var(--bg-secondary, #eee)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted, #999)",
          fontSize: size * 0.4,
          ...style,
        }}
      >
        🖼
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, ...style }}
    />
  );
}

export const ProductImage = memo(ProductImageBase);
