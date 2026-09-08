'use server';

import { signOutAndRedirect as signOutInternal } from '@/server/auth/session';

export async function signOutAction(): Promise<void> {
  await signOutInternal();
}
