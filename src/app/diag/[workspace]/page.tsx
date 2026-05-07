import { notFound } from "next/navigation";
import { loadFramework } from "@/lib/framework/loader";
import { DiagnosisForm } from "./_diagnosis-form";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

export default async function DiagnosisPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) {
    notFound();
  }

  const framework = loadFramework();

  return <DiagnosisForm workspace={workspace} framework={framework} />;
}
