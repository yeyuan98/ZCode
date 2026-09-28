import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

// P5 [ulw] RB：plugin-creator@zcode-plugins-official 随幽灵定义删除后「创建插件」
// 入口永远不可用，入口与 usePluginCreator/pluginCreatorPrefill 链一并移除；
// 若后续在 libre 市场重新上架 plugin-creator，可按 git 历史恢复该入口。
export function PluginAddMenu({
  onAddMarketplace,
  testId,
}: {
  onAddMarketplace: () => void;
  testId: string;
}) {
  const { intl } = useZCodeIntl();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="default" data-testid={testId}>
          {intl.formatMessage({ id: "pluginCreator.add" })}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="plugin-add-menu">
        <DropdownMenuItem
          data-testid="plugin-store-add-source-menu-item"
          onSelect={onAddMarketplace}
        >
          <Plus className="size-4" aria-hidden="true" />
          {intl.formatMessage({ id: "pluginCreator.addMarketplace" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
