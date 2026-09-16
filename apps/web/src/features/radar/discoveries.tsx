import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { Button } from "@radar/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@radar/ui/components/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@radar/ui/components/tabs";
import { useWorkspace } from "./context";
import {
  Empty,
  FindingCard,
  FindingModal,
  PageTitle,
  SearchField,
  WorkspacePage,
} from "./components";
import type { Finding } from "./model";

export default function Discoveries() {
  const { state, readFindings } = useWorkspace();
  const [tab, setTab] = useState("All");
  const [query, setQuery] = useState("");
  const [task, setTask] = useState("all");
  const [selected, setSelected] = useState<Finding | null>(null);
  const findings = state.findings.filter(
    (finding) =>
      (tab === "All" || (tab === "Saved" ? finding.saved : !finding.read)) &&
      (task === "all" || finding.taskId === task) &&
      `${finding.title} ${finding.summary} ${finding.source}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  return (
    <WorkspacePage>
      <PageTitle
        title="Discoveries"
        action={
          <Button variant="outline" onClick={readFindings}>
            <CheckCheck />
            Mark all read
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <TabsList aria-label="Finding status" className="w-full sm:w-fit">
            {["All", "Unread", "Saved"].map((status) => (
              <TabsTrigger key={status} value={status}>
                {status}
                <span className="text-[11px] text-muted-foreground">
                  {
                    state.findings.filter(
                      (finding) =>
                        status === "All" || (status === "Saved" ? finding.saved : !finding.read),
                    ).length
                  }
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <NativeSelect
              size="sm"
              className="sm:max-w-48 [&_select]:rounded-full"
              aria-label="Filter by task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
            >
              <NativeSelectOption value="all">All tasks</NativeSelectOption>
              {state.tasks.map((item) => (
                <NativeSelectOption value={item.id} key={item.id}>
                  {item.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <SearchField label="Search findings" value={query} onChange={setQuery} />
          </div>
        </div>
        <TabsContent value={tab}>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {findings.map((finding) => (
              <FindingCard key={finding.id} item={finding} open={setSelected} />
            ))}
          </div>
          {!findings.length && <Empty>No findings match your filters.</Empty>}
        </TabsContent>
      </Tabs>
      {selected && <FindingModal item={selected} close={() => setSelected(null)} />}
    </WorkspacePage>
  );
}
