"use client"

import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { cn } from "cn"
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react"

type ToastManagerType = React.ComponentProps<typeof ToastPrimitive.Provider>['toastManager']

interface ToastProps extends React.PropsWithChildren {
  toastManager: ToastManagerType
}

function Toast({ toastManager, ...props }: ToastProps) {
  return <ToastPrimitive.Provider data-slot="toast-provider" toastManager={toastManager} {...props} />
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed right-0 top-0 flex max-h-screen w-full flex-col-reverse gap-2 p-4 z-50 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ToastRoot({ className, ...props }: ToastPrimitive.Root.Props) {
  const toast = props.toast as { type?: string; title?: string; description?: string } | undefined
  const isSuccess = toast?.type === 'success'
  const isError = toast?.type === 'error'
  const isWarning = toast?.type === 'warning'
  const isInfo = toast?.type === 'info'

  const iconClass = isSuccess
    ? 'text-emerald-600 dark:text-emerald-400'
    : isError
      ? 'text-rose-600 dark:text-rose-400'
      : isWarning
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-primary'

  const bgClass = isSuccess
    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200/50 dark:border-emerald-800/40'
    : isError
      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200/50 dark:border-rose-800/40'
      : isWarning
        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200/50 dark:border-amber-800/40'
        : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200/50 dark:border-blue-800/40'

  const textClass = isSuccess
    ? 'text-emerald-900 dark:text-emerald-100'
    : isError
      ? 'text-rose-900 dark:text-rose-100'
      : isWarning
        ? 'text-amber-900 dark:text-amber-100'
        : 'text-blue-900 dark:text-blue-100'

  return (
    <ToastPrimitive.Root
      data-slot="toast-root"
      className={cn(
        "pointer-events-auto relative w-full overflow-hidden rounded-lg border shadow-lg p-4 space-y-2",
        bgClass,
        textClass,
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          {isSuccess && <CheckCircle2 className={cn("w-5 h-5 shrink-0 mt-0.5", iconClass)} />}
          {isError && <AlertCircle className={cn("w-5 h-5 shrink-0 mt-0.5", iconClass)} />}
          {isWarning && <AlertTriangle className={cn("w-5 h-5 shrink-0 mt-0.5", iconClass)} />}
          {isInfo && <Info className={cn("w-5 h-5 shrink-0 mt-0.5", iconClass)} />}
          <div className="space-y-1">
            {toast?.title && (
              <ToastPrimitive.Title data-slot="toast-title" className="font-semibold text-sm">
                {toast.title}
              </ToastPrimitive.Title>
            )}
            {toast?.description && (
              <ToastPrimitive.Description data-slot="toast-description" className="text-sm">
                {toast.description}
              </ToastPrimitive.Description>
            )}
          </div>
        </div>
        <ToastClose />
      </div>
    </ToastPrimitive.Root>
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("font-semibold text-sm", className)}
      {...props}
    />
  )
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm", className)}
      {...props}
    />
  )
}

function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1 text-current opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        className
      )}
      {...props}
    >
      <X className="w-4 h-4" />
    </ToastPrimitive.Close>
  )
}

export {
  Toast,
  ToastPortal,
  ToastViewport,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastClose,
}
