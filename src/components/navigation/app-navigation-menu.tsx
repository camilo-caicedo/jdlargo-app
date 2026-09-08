'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Building2, 
  ChevronDown, 
  LayoutDashboard, 
  Users, 
  LogOut, 
  ShieldCheck,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/server/auth/actions';
import type { ActiveMembershipSummary } from '@/server/organizations/use-cases';

interface AppNavigationMenuProps {
  currentMembership: ActiveMembershipSummary;
  memberships: ActiveMembershipSummary[];
  canManageMembers: boolean;
}

export function AppNavigationMenu({
  currentMembership,
  memberships,
  canManageMembers,
}: AppNavigationMenuProps) {
  const pathname = usePathname();
  const [orgDropdownOpen, setOrgDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOrgDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const basePath = `/app/${currentMembership.slug}`;
  const isDashboardActive = pathname === basePath;
  const isExpedientesActive = pathname.startsWith(`${basePath}/expedientes`);
  const isMiembrosActive = pathname.startsWith(`${basePath}/miembros`);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          
          {/* Left section: Branding & Organization switcher */}
          <div className="flex items-center gap-4">
            <Link 
              href={basePath} 
              className="flex items-center gap-2 font-semibold text-sm tracking-tight text-zinc-900 dark:text-zinc-100 hover:opacity-85 transition-opacity"
            >
              <div className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                JD
              </div>
              <span className="hidden sm:inline">JD Largo</span>
            </Link>

            <span className="text-zinc-300 dark:text-zinc-700">/</span>

            {/* Org Switcher */}
            <div className="relative" ref={dropdownRef}>
              {memberships.length > 1 ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setOrgDropdownOpen((prev) => !prev)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800/70 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    aria-expanded={orgDropdownOpen}
                  >
                    <Building2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="max-w-[140px] sm:max-w-[200px] truncate">
                      {currentMembership.organizationName}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  </button>

                  {orgDropdownOpen && (
                    <div className="absolute left-0 mt-1.5 w-64 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg py-1 z-50 animate-in fade-in-50 zoom-in-95">
                      <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                        Cambiar de organización
                      </div>
                      {memberships.map((m) => {
                        const isCurrent = m.organizationId === currentMembership.organizationId;
                        return (
                          <a
                            key={m.organizationId}
                            href={`/app/${m.slug}`}
                            onClick={() => setOrgDropdownOpen(false)}
                            className={`flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors ${
                              isCurrent
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <Building2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
                              <span className="truncate">{m.organizationName}</span>
                            </div>
                            {isCurrent && (
                              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 ml-2" />
                            )}
                          </a>
                        );
                      })}
                      <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-1 px-3 py-1.5">
                        <Link
                          href="/login/organizacion"
                          className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                        >
                          Ver todas las organizaciones &rarr;
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <Building2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="max-w-[200px] truncate">{currentMembership.organizationName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Center/Nav items */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href={basePath}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isDashboardActive
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Espacio de trabajo
            </Link>

            <Link
              href={`${basePath}/expedientes`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isExpedientesActive
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Expedientes
            </Link>

            {canManageMembers && (
              <Link
                href={`${basePath}/miembros`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isMiembrosActive
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Miembros
              </Link>
            )}
          </nav>

          {/* Right section: System Badge & Logout */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium border border-emerald-200/50 dark:border-emerald-800/50">
              <ShieldCheck className="w-3 h-3" />
              <span>SARLAFT / PTEE</span>
            </div>

            <form action={signOutAction}>
              <Button 
                variant="ghost" 
                size="sm" 
                type="submit" 
                className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Cerrar sesión</span>
              </Button>
            </form>
          </div>

        </div>

        {/* Mobile secondary navigation row */}
        <div className="flex md:hidden items-center gap-2 py-2 border-t border-zinc-100 dark:border-zinc-800 text-xs overflow-x-auto">
          <Link
            href={basePath}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md shrink-0 ${
              isDashboardActive
                ? 'bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <LayoutDashboard className="w-3 h-3" />
            Inicio
          </Link>
          <Link
            href={`${basePath}/expedientes`}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md shrink-0 ${
              isExpedientesActive
                ? 'bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Expedientes
          </Link>
          {canManageMembers && (
            <Link
              href={`${basePath}/miembros`}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md shrink-0 ${
                isMiembrosActive
                  ? 'bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <Users className="w-3 h-3" />
              Miembros
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
