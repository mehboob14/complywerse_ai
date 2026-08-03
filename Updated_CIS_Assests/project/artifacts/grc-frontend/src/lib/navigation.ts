import { useLocation, useParams as wouterUseParams } from 'wouter';

export function usePathname(): string {
  const [location] = useLocation();
  return location;
}

export function useRouter() {
  const [, navigate] = useLocation();
  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: () => window.history.back(),
    refresh: () => window.location.reload(),
  };
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): Partial<T> {
  return wouterUseParams() as Partial<T>;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
