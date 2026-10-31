'use client';

// A mutation that always reports, for the place a page used a bare useMutation:
//
//   const archive = useReportedMutation({
//     mutationFn: (ids: number[]) => documentsApi.archive(ids),
//     success: (_, ids) => `Archived ${ids.length} documents`,
//     failure: "Couldn't archive the documents",
//     invalidate: [['documents']],
//     onSuccess: () => setSelected([]),
//   });
//   archive.mutate(ids);
//
// The confirmation is shown only when the server has answered ok, never before; a failure stays on screen until dismissed, with what the server
// said (cleaned) and a Retry that runs the same call with the same variables (not offered for a refusal that would be repeated, or with
// `retryable: false`: set it for a create that is not safe to repeat). It returns the mutation result unchanged. The rules are in reportOutcome.ts.
//
// `success` is a line, or `{ title: 'Settings saved', message: 'New requests use them from now on.' }` for a headline with a second line under it, or
// a function of what the server returned that gives either. `fallback: "The settings could not be saved."` is what a failure says when the server
// gave no usable words (the server's own words always win).
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNotify } from './useNotify';
import { reportedMutationOptions, type ReportedMutationConfig } from './reportOutcome';

export type { ReportedMutationConfig };

export function useReportedMutation<TData = unknown, TVariables = void>(config: ReportedMutationConfig<TData, TVariables>): UseMutationResult<TData, Error, TVariables> {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const mutation: UseMutationResult<TData, Error, TVariables> = useMutation<TData, Error, TVariables>(reportedMutationOptions(config, {
    notifySuccess: (message, options) => { notify.success(message, options); },
    notifyError: (message, options) => { notify.error(message, options); },
    invalidate: (queryKey) => { void queryClient.invalidateQueries({ queryKey }); },
    rerun: (variables) => mutation.mutate(variables),
  }));
  return mutation;
}
