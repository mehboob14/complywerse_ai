// Who is offered My Work (the page of the controls and framework requirements assigned to a person): administrators, and people with framework, control-library or evidence access. The page
// has always decided this itself, and Task Management's My work offers its link on the same rule, so the rule is written once. It copies no server rule (the server answers `scf/my-work` to
// any signed-in person); it is what the page has always checked.
export const MY_WORK_RIGHTS: readonly string[] = ['compliance:frameworks:*', 'controls:control_library:*', 'evidence:evidence_library:*'];

export const canOpenMyWork = (isAdmin: boolean, hasAny: (rights: string[]) => boolean): boolean => isAdmin || hasAny(MY_WORK_RIGHTS.slice());
