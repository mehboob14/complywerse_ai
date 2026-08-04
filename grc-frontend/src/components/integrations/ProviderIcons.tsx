'use client';

/**
 * Brand-mark SVGs for the cloud + scanner integration providers.
 *
 * Lightweight inline SVGs (no external deps) so the icons render even
 * offline and don't fight the rest of the lucide icon set. Each component
 * accepts a `size` prop and is colour-correct on white backgrounds.
 *
 * Why not lucide icons: customers recognise vendors by their brand mark,
 * not generic cloud/shield/database glyphs. The recognition cuts down
 * onboarding friction — a CIO scanning the page sees "AWS / Azure / GCP"
 * instantly.
 */

interface IconProps {
  size?: number;
  className?: string;
}

export function AwsIcon({ size = 18, className }: IconProps) {
  // Classic AWS swoosh + wordmark abstraction. Single-colour version
  // tinted via container CSS so it sits well in any tile background.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      className={className}
    >
      <path
        fill="#FF9900"
        d="M72 156c0 3 .3 5.4.9 7.1.6 1.7 1.4 3.6 2.5 5.7.4.6.6 1.3.6 1.8 0 .8-.5 1.5-1.4 2.3l-4.7 3.1c-.7.5-1.4.7-2 .7-.8 0-1.6-.4-2.3-1.2-1.1-1.2-2-2.4-2.7-3.7-.8-1.3-1.5-2.8-2.4-4.5-6.2 7.3-13.9 11-23.2 11-6.6 0-11.9-1.9-15.8-5.7-3.9-3.8-5.9-8.9-5.9-15.2 0-6.7 2.4-12.2 7.3-16.3 4.8-4.1 11.3-6.2 19.6-6.2 2.7 0 5.5.2 8.5.6 3 .4 6.1 1 9.3 1.7v-5.9c0-6-1.2-10.2-3.7-12.6-2.5-2.4-6.7-3.6-12.8-3.6-2.8 0-5.7.3-8.7 1-3 .7-5.9 1.6-8.7 2.7-1.3.5-2.3.9-2.9 1-.6.1-1 .2-1.3.2-1.1 0-1.7-.8-1.7-2.4v-3.8c0-1.2.2-2.1.6-2.7.4-.6 1.1-1.1 2.1-1.5 2.8-1.4 6.1-2.6 10-3.5 3.9-1 8-1.5 12.4-1.5 9.4 0 16.3 2.1 20.7 6.4 4.3 4.3 6.5 10.8 6.5 19.5V156Zm-31.9 12c2.6 0 5.3-.5 8.1-1.4 2.8-.9 5.3-2.6 7.5-4.9 1.3-1.5 2.2-3.2 2.7-5 .5-1.9.8-4.2.8-6.8v-3.3c-2.4-.6-4.9-1-7.5-1.3-2.6-.3-5.1-.4-7.6-.4-5.4 0-9.4 1-12.1 3.2-2.7 2.1-4 5.2-4 9.2 0 3.7 1 6.5 3 8.4 1.9 1.9 4.7 2.9 8.6 2.9Zm63.1 8.5c-1.3 0-2.3-.2-2.8-.7-.6-.5-1.1-1.5-1.5-2.9L80.3 109c-.4-1.4-.6-2.4-.6-2.9 0-1.1.5-1.7 1.6-1.7h7.7c1.4 0 2.4.2 2.9.7.6.5 1.1 1.5 1.5 2.9l13.4 53 12.5-53c.3-1.4.8-2.4 1.4-2.9.6-.5 1.6-.7 2.9-.7h6.3c1.4 0 2.4.2 2.9.7.6.5 1.1 1.5 1.4 2.9l12.7 53.7 13.8-53.7c.4-1.4.9-2.4 1.5-2.9.6-.5 1.5-.7 2.9-.7h7.3c1.1 0 1.7.6 1.7 1.7 0 .3-.1.7-.2 1.1-.1.4-.2 1-.5 1.8L154 173.8c-.4 1.4-.9 2.4-1.5 2.9-.6.5-1.6.8-2.8.8h-6.7c-1.4 0-2.4-.2-2.9-.8-.6-.5-1.1-1.5-1.4-2.9l-12.4-51.6-12.3 51.5c-.3 1.4-.8 2.4-1.4 2.9-.6.6-1.6.8-2.9.8h-6.8Zm101.1 1.9c-4.1 0-8.2-.5-12.1-1.4-3.9-1-7-2-9.1-3.2-1.3-.7-2.1-1.5-2.4-2.2-.3-.7-.5-1.5-.5-2.2v-4c0-1.6.6-2.4 1.7-2.4.5 0 .9.1 1.3.2.4.2 1 .4 1.7.7 2.3 1 4.8 1.8 7.4 2.4 2.7.6 5.3.9 8 .9 4.2 0 7.5-.7 9.7-2.2 2.3-1.4 3.4-3.5 3.4-6.2 0-1.9-.6-3.4-1.8-4.7-1.2-1.3-3.5-2.5-6.8-3.6l-9.8-3.1c-4.9-1.6-8.5-3.9-10.8-7-2.2-3-3.4-6.4-3.4-10 0-2.9.6-5.5 1.9-7.7 1.3-2.2 3-4.1 5.1-5.7 2.1-1.6 4.5-2.8 7.3-3.6 2.8-.8 5.7-1.2 8.8-1.2 1.5 0 3.1.1 4.7.3 1.6.2 3.1.5 4.6.8 1.4.3 2.7.7 4 1.1 1.3.4 2.3.8 3 1.2.9.5 1.6 1 2 1.5.4.5.6 1.1.6 1.9v3.7c0 1.6-.6 2.5-1.7 2.5-.6 0-1.6-.3-2.9-.8-4.6-2-9.7-3.1-15.4-3.1-3.8 0-6.8.6-8.8 1.8-2.1 1.2-3.1 3.1-3.1 5.6 0 1.9.7 3.5 2.1 4.7 1.4 1.3 3.9 2.6 7.5 3.7l9.6 3c4.9 1.6 8.4 3.7 10.5 6.5 2.1 2.8 3.1 6 3.1 9.6 0 3-.6 5.7-1.8 8.1-1.2 2.4-2.9 4.4-5.1 6-2.2 1.6-4.8 2.9-7.8 3.7-3 .9-6.3 1.4-9.9 1.4Z"
      />
      <path
        fill="#FF9900"
        d="M232.5 196.4c-25.4 18.8-62.4 28.7-94.2 28.7-44.6 0-84.7-16.5-115-44-2.4-2.2-.3-5.1 2.6-3.4 32.7 19 73 30.5 114.7 30.5 28.2 0 59.3-5.9 87.9-17.9 4.3-2 7.9 2.8 3.6 6.1l.4.0Z"
        fillRule="evenodd"
        clipRule="evenodd"
      />
      <path
        fill="#FF9900"
        d="M243 184.9c-3.2-4.1-21.5-2-29.7-1-2.5.3-2.9-1.9-.6-3.4 14.6-10.3 38.6-7.3 41.4-3.9 2.8 3.4-.7 27.5-14.4 39-2.1 1.8-4.1.8-3.2-1.5 3.1-7.4 9.7-24.1 6.5-29.2Z"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function AzureIcon({ size = 18, className }: IconProps) {
  // Microsoft Azure abstract triangle mark — the canonical brand asset.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
    >
      <defs>
        <linearGradient id="azureG1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#114A8B" />
          <stop offset="100%" stopColor="#0669BC" />
        </linearGradient>
        <linearGradient id="azureG2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3CCBF4" />
          <stop offset="100%" stopColor="#2892DF" />
        </linearGradient>
      </defs>
      <path
        fill="url(#azureG1)"
        d="M9.105 1.5h4.799l-5.012 14.86a.766.766 0 0 1-.726.526H4.43a.764.764 0 0 1-.722-1.011L8.378 2.025A.766.766 0 0 1 9.105 1.5Z"
      />
      <path
        fill="#0078D4"
        d="M16.405 16.485H7.943a.353.353 0 0 0-.241.611l5.448 5.082a.776.776 0 0 0 .527.207h4.305l-1.578-5.9Z"
      />
      <path
        fill="url(#azureG2)"
        d="M9.105 1.5a.762.762 0 0 0-.728.532L3.71 15.832a.762.762 0 0 0 .722 1.044h3.86a.825.825 0 0 0 .628-.518L9.873 13.6l3.521 3.286a.78.78 0 0 0 .493.183h4.286l-1.881-5.405-5.487.001L13.16 1.5H9.105Z"
      />
    </svg>
  );
}

export function GcpIcon({ size = 18, className }: IconProps) {
  // Google Cloud four-colour mark.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
    >
      <path
        fill="#EA4335"
        d="M20.46 8.55h.96l2.74-2.74.13-1.16C19.2.69 12.36 1.21 7.97 5.84a11.32 11.32 0 0 0-2.8 5.43c.3-.13.64-.15.96-.07l5.48-.9s.28-.46.42-.43a6.13 6.13 0 0 1 8.39-.68l.04.36Z"
      />
      <path
        fill="#4285F4"
        d="M27.45 11.27a12.65 12.65 0 0 0-3.81-6.15l-3.85 3.85c1.55 1.27 2.43 3.17 2.41 5.17v.68a3.42 3.42 0 0 1 0 6.85h-6.85l-.68.7v4.1l.68.68h6.85a8.91 8.91 0 0 0 5.25-15.88Z"
      />
      <path
        fill="#34A853"
        d="M8.46 27.16h6.85v-5.47H8.46c-.51 0-1-.11-1.46-.32l-.96.32-2.76 2.74-.24.96a8.85 8.85 0 0 0 5.42 1.77Z"
      />
      <path
        fill="#FBBC05"
        d="M8.46 9.32a8.91 8.91 0 0 0-5.37 16l3.97-3.97a3.42 3.42 0 1 1 4.53-4.53l3.97-3.97a8.92 8.92 0 0 0-7.1-3.53Z"
      />
    </svg>
  );
}

export function NessusIcon({ size = 18, className }: IconProps) {
  // Tenable / Nessus — abstracted shield + bug mark in their orange hue.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
    >
      <path
        fill="#00A5E0"
        d="M12 2 3 5v6c0 5.6 3.84 10.8 9 12 5.16-1.2 9-6.4 9-12V5l-9-3Zm0 4 5 1.66v3.4c0 3.86-2.5 7.62-5 8.94-2.5-1.32-5-5.08-5-8.94v-3.4L12 6Z"
      />
      <circle cx="12" cy="11" r="2.2" fill="#00A5E0" />
    </svg>
  );
}

export function NexposeIcon({ size = 18, className }: IconProps) {
  // Rapid7 / Nexpose — abstracted hexagon mark in their signature red.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
    >
      <path
        fill="#FA1E4E"
        d="m12 2 8.66 5v10L12 22 3.34 17V7L12 2Zm0 4.31L7.34 9v6L12 17.69 16.66 15V9L12 6.31Z"
      />
      <path
        fill="#FA1E4E"
        d="M12 9.8 9.3 11.3v1.4L12 14.2l2.7-1.5v-1.4L12 9.8Z"
      />
    </svg>
  );
}

export function GoogleWorkspaceIcon({ size = 18, className }: IconProps) {
  // Google "G" mark — used for the Identity Providers card.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
    >
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

export function MicrosoftIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 23 23"
      className={className}
    >
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function getProviderIcon(provider: string) {
  switch ((provider || '').toLowerCase()) {
    case 'aws_inspector':
      return AwsIcon;
    case 'azure_defender':
      return AzureIcon;
    case 'gcp_scc':
      return GcpIcon;
    case 'nessus':
      return NessusIcon;
    case 'nexpose':
      return NexposeIcon;
    default:
      return null;
  }
}
