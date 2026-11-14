import { Link } from "react-router";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/vennora/page";
import { RequirePermission } from "@/components/vennora/require-permission";
import { useDocumentTitle } from "@/lib/title";
import { QrScanner } from "./qr-scanner";

export function ScannerPage() {
  useDocumentTitle("Scanner");
  return (
    <RequirePermission permission="equipment.view">
      <div className="mx-auto max-w-md">
        <PageHeader
          title="Scanner un équipement"
          description="Chaque équipement porte une étiquette QR qui ouvre directement son historique."
        />
        <QrScanner />
        <Button asChild variant="outline" className="mt-4 w-full gap-1.5">
          <Link to="/equipements">
            <Search className="size-4" />
            Chercher un équipement
          </Link>
        </Button>
      </div>
    </RequirePermission>
  );
}
