import { createFileRoute } from "@tanstack/react-router";

import ScannerTest from "../../pages/ScannerTest/ScannerTest";

// A bare bench for the barcode scanner: it reads the HID device directly and
// needs no navigation, no data and no layout around it.
//
// Developer-only: the component renders a notice outside `vite dev` so the
// bench never ships as a usable page in a production build.
export const Route = createFileRoute("/_app/test")({
  component:
    import.meta.env.DEV
      ? ScannerTest
      : () => (
          <p style={{ padding: "2rem", textAlign: "center" }}>
            هذه شاشة تجريبية للفريق التقني فقط.
          </p>
        ),
});
