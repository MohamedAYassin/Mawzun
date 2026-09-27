import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ScannerTransactions from "../../../pages/ScannerTransactions/ScannerTransactions";

export const Route = createFileRoute("/_app/dashboard/scanner-transactions")({
  component: asRoute(ScannerTransactions),
});
