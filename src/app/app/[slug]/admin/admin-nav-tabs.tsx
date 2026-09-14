"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  Shield,
  FileSpreadsheet,
  FileText,
  History,
  Bot,
} from "lucide-react";

export interface AdminTabItem {
  id: string;
  name: string;
  href: string;
  iconName: string;
  visible: boolean;
  disabled?: boolean;
}

export function AdminNavTabs({
  tabs,
}: {
  tabs: AdminTabItem[];
}) {
  const pathname = usePathname();

  function getIcon(name: string) {
    switch (name) {
      case "layers":
        return <Layers className="w-4 h-4" />;
      case "roles":
        return <Shield className="w-4 h-4" />;
      case "matrix":
        return <FileSpreadsheet className="w-4 h-4" />;
      case "privacy":
        return <FileText className="w-4 h-4" />;
      case "audit":
        return <History className="w-4 h-4" />;
      case "ai":
        return <Bot className="w-4 h-4" />;
      default:
        return <Layers className="w-4 h-4" />;
    }
  }

  const visibleTabs = tabs.filter((t) => t.visible);

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto" aria-label="Tabs de Administración">
        {visibleTabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);

          if (tab.disabled) {
            return (
              <span
                key={tab.id}
                className="flex items-center gap-2 py-3 px-3 border-b-2 border-transparent text-xs font-medium text-zinc-400 dark:text-zinc-600 cursor-not-allowed shrink-0"
                title="Próximamente"
              >
                {getIcon(tab.iconName)}
                <span>{tab.name}</span>
                <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-1.5 py-0.5 rounded font-normal">
                  Próximamente
                </span>
              </span>
            );
          }

          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex items-center gap-2 py-3 px-3 border-b-2 text-xs font-medium transition-colors shrink-0 ${
                isActive
                  ? "border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400 font-semibold"
                  : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-300"
              }`}
            >
              {getIcon(tab.iconName)}
              <span>{tab.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
