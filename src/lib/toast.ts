import { Toast } from '@base-ui/react/toast'

export const toastManager = Toast.createToastManager()

export const toast = {
  success: (description: string, title?: string) =>
    toastManager.add({ type: 'success', title, description }),
  error: (description: string, title?: string) =>
    toastManager.add({ type: 'error', title, description }),
  warning: (description: string, title?: string) =>
    toastManager.add({ type: 'warning', title, description }),
  info: (description: string, title?: string) =>
    toastManager.add({ type: 'info', title, description }),
}
