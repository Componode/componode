import { DockerSetupWizard } from "@/ux/components/importers/docker-setup-wizard";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";

export function UxDockerSetupPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Guided Docker setup"
        description="Connect a Docker Engine and create an importer in one guided flow — Hub execution only."
      />
      <DockerSetupWizard />
    </PageContainer>
  );
}
