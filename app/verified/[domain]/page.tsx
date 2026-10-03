import Link from "next/link";
import { getPublicVerifiedByDomain } from "@/lib/registry/registry";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface VerifiedPageProps {
  params: Promise<{ domain: string }>;
}

export default async function VerifiedDomainPage({ params }: VerifiedPageProps) {
  const { domain: rawDomain } = await params;
  const domain = decodeURIComponent(rawDomain).toLowerCase();
  const info = await getPublicVerifiedByDomain(domain);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">AgentLedger merchant verification</CardTitle>
          <CardDescription className="font-mono text-foreground/80">{info.domain}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {info.verified ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="emerald" className="normal-case tracking-normal">
                Verified by AgentLedger
              </Badge>
              {info.isDemoFixture ? (
                <Badge variant="sky" className="normal-case tracking-normal">
                  demo fixture
                </Badge>
              ) : null}
            </div>
          ) : (
            <Badge variant="neutral" className="normal-case tracking-normal">
              Not verified
            </Badge>
          )}
          {info.companyName ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Company:</span> {info.companyName}
            </p>
          ) : null}
          {info.verifiedAt ? (
            <p className="text-sm text-muted-foreground">
              Verified at {formatDateTime(info.verifiedAt)}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Domain verification proves control of the hostname. It is not a safety rating — your
            delegation and guardrail policy still apply.
          </p>
          <Link href="/" className="text-sm text-sky-400 hover:underline">
            AgentLedger home
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
