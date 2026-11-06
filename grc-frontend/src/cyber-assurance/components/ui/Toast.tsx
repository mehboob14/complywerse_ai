// One toast for the whole app: this copy had drifted into the same white-on-white title.
// No 'use client' here: Next refuses `export *` in a client boundary, and the source already is one.
export * from '@/components/ui/Toast';
export { default } from '@/components/ui/Toast';
