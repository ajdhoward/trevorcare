"use client";

import { useMemo, useState } from "react";
import { FileText, Download, ExternalLink, ShieldCheck, HeartHandshake, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { type DocInfo, fmtSize, fmtDate } from "@/lib/record";

const ENC = (s: string) => encodeURIComponent(s);

function typeIcon(t: string) {
  const v = t.toLowerCase();
  if (v.includes("care plan")) return <HeartHandshake className="h-5 w-5 text-rose-600" />;
  if (v.includes("risk")) return <ShieldCheck className="h-5 w-5 text-amber-600" />;
  if (v.includes("policy")) return <BookOpen className="h-5 w-5 text-teal-700" />;
  return <FileText className="h-5 w-5 text-teal-700" />;
}

export default function Documents({ docs }: { docs: DocInfo[] }) {
  const [q, setQ] = useState("");

  const sorted = useMemo(() => {
    const rank = (t: string) =>
      t.toLowerCase().includes("care plan") ? 0 : t.toLowerCase().includes("risk") ? 1 : 2;
    return docs
      .filter((d) => d.file.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => rank(a.type) - rank(b.type) || a.file.localeCompare(b.file));
  }, [docs, q]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">{docs.length} files</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((d) => {
          const isCarePlan = d.type.toLowerCase().includes("care plan");
          return (
            <Card
              key={d.file}
              className={`py-4 ${isCarePlan ? "border-rose-200 bg-rose-50/40" : ""}`}
            >
              <CardContent className="space-y-2 px-4">
                <div className="flex items-start gap-2.5">
                  {typeIcon(d.type)}
                  <div className="min-w-0">
                    <div className="break-words text-sm font-medium leading-snug">{d.file}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-900">
                        {d.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{fmtSize(d.size)}</span>
                      {d.uploaded && (
                        <span className="text-xs text-muted-foreground">
                          · uploaded {fmtDate(d.uploaded)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <a href={`/downloads/documents/${ENC(d.file)}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      View
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <a href={`/downloads/documents/${ENC(d.file)}`} download={d.file}>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
