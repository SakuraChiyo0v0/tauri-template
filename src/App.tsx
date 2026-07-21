import { Boxes, Settings2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModuleManagerPage } from "@/pages/module-manager-page";
import { SettingsPage } from "@/pages/settings-page";

function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Modular Tauri Template</h1>
            <p className="text-xs text-muted-foreground">空业务、可扩展的桌面应用底座</p>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">首版</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-7">
        <Tabs defaultValue="modules">
          <TabsList>
            <TabsTrigger value="modules"><Boxes className="mr-2 size-4" />模块管理</TabsTrigger>
            <TabsTrigger value="settings"><Settings2 className="mr-2 size-4" />设置</TabsTrigger>
          </TabsList>
          <TabsContent value="modules"><ModuleManagerPage /></TabsContent>
          <TabsContent value="settings"><SettingsPage /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default App;
