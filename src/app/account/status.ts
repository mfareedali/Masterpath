import type { AuthStatusCode } from '@/lib/supabase/auth';

export interface StatusMessage {
  tone: 'accent' | 'warning' | 'neutral';
  title: string;
  text: string;
}

/** Fixed messages for /account?auth=<code>. The URL only ever carries a code, never the text itself. */
export const AUTH_STATUS_MESSAGES: Record<AuthStatusCode, StatusMessage> = {
  signed_in: {
    tone: 'accent',
    title: 'You are signed in.',
    text: 'You can now save your profile to your account.',
  },
  signed_out: {
    tone: 'neutral',
    title: 'You are signed out.',
    text: 'Your data on this device is still here.',
  },
  deleted: {
    tone: 'neutral',
    title: 'Your account is deleted.',
    text: 'Your account and the profile saved in it are gone for good. Data on this device is still here. You can delete it below.',
  },
  link_failed: {
    tone: 'warning',
    title: 'That sign-in link did not work.',
    text: 'A link works once, for a short time, and only in the browser where you asked for it. Ask for a new email, or type the code from the email.',
  },
  link_expired: {
    tone: 'warning',
    title: 'That sign-in link has expired.',
    text: 'Please ask for a new email below.',
  },
  not_enabled: {
    tone: 'neutral',
    title: 'Accounts are not turned on for this website.',
    text: 'Everything still works without an account.',
  },
};
