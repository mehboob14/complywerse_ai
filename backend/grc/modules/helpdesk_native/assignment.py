"""Assignment engine — native port of the core Assignment Rule selection.

Converts logic spec §2 (Assignment). Frappe delegates round-robin / load-balancing
to its core `Assignment Rule` engine + the `_assign` JSON column; HD Team only
*provisions* the rule (`hd_team.py:create_assignment_rule`) and does cleanup
(`hd_ticket.py:remove_assignment_if_not_in_team`). This module reimplements the
core engine's *selection*, which §2.2 summarises as three strategies, and the
cleanup.

Model reality (see docs/HELPDESK_NATIVE_MODEL_MAP.md): the core `Assignment Rule`
doctype was NOT converted — `HDTeam.assignment_rule` is just a String holding the
Frappe rule name. So the native model carries **no** strategy field, **no** per-member
`weight`, and **no** `last_user` pointer. Consequences, all handled here without a
model change:
  * strategy defaults to "Round Robin" (Frappe's Assignment Rule default); see
    `_select` — a future `HDTeam.assignment_strategy` column would be honoured
    automatically but is not required.
  * round-robin's "last assigned user" state is reconstructed from the durable
    ticket store (the newest already-assigned ticket in the team) instead of a
    `last_user` column — DB-backed + tenant-scoped.
  * weighted distribution degenerates to round-robin (no per-member weight to
    distribute by).

The ticket core already persists the single current assignee on
`HDTicket.assigned_agent` (manual assign, §A15); this module adds the automatic
selection. Never raises for empty input.
"""
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import HDAgent, HDTicket

# Status whose label is exactly "Open" — the core assign_condition keys on the
# status *label* string `status == 'Open'` (hd_team.py:assign_condition), and the
# native contract surfaces that label via HDTicketStatus.label_agent.
OPEN_LABEL = "Open"
# status_category "Open" is what remove_assignment_if_not_in_team gates on
# (hd_ticket.py:431 — `self.status_category == "Open"`).
OPEN_CATEGORY = "Open"


# ─── helpers ─────────────────────────────────────────────────────────────────
def _members(db: Session, tid: int, team) -> list:
    """The team's assignable member logins, in membership order, deduped.

    SOURCE CHANGE (teams unification): members now come from the ComplyVerse Administration
    team (grc_teams → Team.members, each a GRCUser), not the retired HDTeamMember
    list. The login we rotate over is the member's GRCUser.email — the same value
    HDAgent.user holds. Restricted to members who are HD agents of this tenant, so
    a non-agent team member is never auto-assigned a ticket. The selection BEHAVIOUR
    (round-robin / load-balance over this ordered list) is unchanged.
    """
    seen: set = set()
    emails: list = []
    for m in team.members:  # TeamMember rows (grc_team_members)
        email = m.user.email if m.user else None
        if email and email not in seen:
            seen.add(email)
            emails.append(email)
    if not emails:
        return []
    agents = {
        r[0] for r in db.query(HDAgent.user)
        .filter(HDAgent.tenant_id == tid, HDAgent.user.in_(emails))
        .all()
    }
    return [e for e in emails if e in agents]


def _next_in_cycle(members: list, last):
    """Round-robin core: the user after `last` in order, wrapping; start at the
    first user when there is no prior / an unknown last user."""
    if last in members:
        return members[(members.index(last) + 1) % len(members)]
    return members[0]


# ─── selection strategies (spec §2.2) ────────────────────────────────────────
def _round_robin(db: Session, ticket, team, members: list):
    """Cycle through `users` in order, tracking the last-assigned user so each new
    matching doc goes to the next user (wraps around).

    Frappe tracks "last_user" on the Assignment Rule; the native model has no such
    column, so the pointer is reconstructed from the durable ticket store: the
    assignee of the most-recently-assigned ticket in THIS team = the last user.
    # ponytail: id-desc proxy for last_user — a manual assign in the team also
    # moves the pointer; add an HDTeam.last_assigned_agent column if exact
    # rule-only rotation is ever required.
    """
    last = (
        db.query(HDTicket.assigned_agent)
        .filter(
            HDTicket.tenant_id == ticket.tenant_id,
            HDTicket.agent_group_id == team.id,
            HDTicket.assigned_agent.isnot(None),
            HDTicket.id != ticket.id,
        )
        .order_by(HDTicket.id.desc())
        .first()
    )
    return _next_in_cycle(members, last[0] if last else None)


def _load_balanced(db: Session, ticket, team, members: list):
    """Pick the user with the fewest currently-open assignments (open ToDo rows)
    for the rule's document type. Native equivalent: fewest open-category tickets
    assigned to the member, tenant-scoped (matching the core per-user, per-doctype
    count). Tie-break by member order."""
    rows = (
        db.query(HDTicket.assigned_agent, func.count(HDTicket.id))
        .filter(
            HDTicket.tenant_id == ticket.tenant_id,
            HDTicket.assigned_agent.in_(members),
            HDTicket.status_category == OPEN_CATEGORY,
        )
        .group_by(HDTicket.assigned_agent)
        .all()
    )
    counts = {agent: n for agent, n in rows}
    return min(members, key=lambda m: (counts.get(m, 0), members.index(m)))


def _weighted(db: Session, ticket, team, members: list):
    """Distribute across `weighted_users` proportional to `weight`. The native
    model has no per-member weight (HDTeamMember carries no `weight` column), so
    every member weighs 1 and this degenerates to the round-robin rotation.
    # ponytail: equal weights — add HDTeamMember.weight to restore true weighting.
    """
    return _round_robin(db, ticket, team, members)


_STRATEGIES = {
    "Round Robin": _round_robin,
    "Load Balancing": _load_balanced,
    "Weighted Distribution": _weighted,
}


def _select(db: Session, ticket, team, members: list):
    # No strategy column on the native HDTeam → default to Round Robin (Frappe's
    # Assignment Rule default). A future HDTeam.assignment_strategy is honoured
    # here without further change.
    strategy = getattr(team, "assignment_strategy", None) or "Round Robin"
    return _STRATEGIES.get(strategy, _round_robin)(db, ticket, team, members)


# ─── entry points (called by tickets.py) ─────────────────────────────────────
def auto_assign(db: Session, ticket) -> None:
    """Pick and stamp an agent when a ticket is created/becomes Open with a team.

    §2.1 assign_condition `status == 'Open' and agent_group == '<team>'`
    (hd_team.py:create_assignment_rule): auto-assign fires only for Open-labelled
    tickets that carry a team. A disabled team's rule is disabled, so it never
    assigns (hd_team.py:on_update sets ar.disabled = team.disabled). No team / no
    members → no-op (ticket stays unassigned for manual §A15 assignment).
    """
    if ticket.agent_group_id is None:
        return
    status = ticket.status
    if status is None or status.label_agent != OPEN_LABEL:
        return
    team = ticket.team
    if team is None or not team.is_active:  # ComplyVerse Team uses is_active (was HDTeam.disabled)
        return
    members = _members(db, ticket.tenant_id, team)
    if not members:
        return
    agent = _select(db, ticket, team, members)
    if agent:
        ticket.assigned_agent = agent  # agent_group (team) is kept as set


def remove_if_not_in_team(db: Session, ticket) -> None:
    """Clear the assignee when the team changes and they aren't on the new team.

    §2.3 remove_assignment_if_not_in_team (hd_ticket.py:422): when agent_group
    changes and the ticket is Open-category, if the current assignee is NOT a
    member of the new team AND the new team's rule has users, clear the assignment
    so the rule can reassign to someone on the right team. (tickets.py calls this
    right after re-setting agent_group, so the "agent_group changed" guard is the
    call itself.)
    """
    if not ticket.assigned_agent or ticket.agent_group_id is None:
        return
    if (ticket.status_category or "") != OPEN_CATEGORY:
        return
    team = ticket.team
    # users_present_in_team_assignment_rule (hd_ticket.py:453): a disabled rule or a
    # rule with no users must NOT trigger a clear.
    if team is None or not team.is_active:  # ComplyVerse Team uses is_active (was HDTeam.disabled)
        return
    members = _members(db, ticket.tenant_id, team)
    if not members:
        return
    # agent_in_assigned_team (hd_ticket.py:444): assignee present in the new team?
    if ticket.assigned_agent not in members:
        ticket.assigned_agent = None  # clear_all_assignments


if __name__ == "__main__":  # pure round-robin cycle math (no DB needed)
    assert _next_in_cycle(["a", "b", "c"], "a") == "b"
    assert _next_in_cycle(["a", "b", "c"], "c") == "a"      # wrap
    assert _next_in_cycle(["a", "b", "c"], None) == "a"     # no prior
    assert _next_in_cycle(["a", "b", "c"], "x") == "a"      # unknown last (left team)
    assert _next_in_cycle(["a"], "a") == "a"                # single member
    print("assignment self-check ok")
