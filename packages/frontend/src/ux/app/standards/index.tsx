import { Link } from "react-router-dom";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { StandardsContent } from "@/ux/components/standards/standards-content";
import { Button } from "@/ux/components/ui/button";
import { ux } from "@/ux/lib/paths";

export function UxStandardsPage() {
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="UI standards"
        description="The contract every Componode screen follows. Build new pages from these tokens and patterns — not from scratch."
        actions={
          <Button variant="outline" asChild>
            <Link to={ux("/standards/wiring")}>Wiring guide</Link>
          </Button>
        }
      />
      <StandardsContent />
    </PageContainer>
  );
}
