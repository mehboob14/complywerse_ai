from typing import Dict, Set


class WorkflowStateMachine:
    instance_transitions: Dict[str, Set[str]] = {
        "running": {"waiting", "completed", "failed", "cancelled"},
        "waiting": {"running", "completed", "failed", "cancelled"},
        "completed": set(),
        "failed": set(),
        "cancelled": set(),
    }

    step_transitions: Dict[str, Set[str]] = {
        "pending": {"running", "waiting_timer", "waiting_approval", "waiting_subworkflow", "completed", "failed"},
        "running": {"completed", "failed", "waiting_timer", "waiting_approval", "waiting_subworkflow"},
        "waiting_timer": {"running", "failed"},
        "waiting_approval": {"running", "failed"},
        "waiting_subworkflow": {"running", "failed"},
        "completed": set(),
        "failed": set(),
    }

    @classmethod
    def can_transition_instance(cls, current: str, new_state: str) -> bool:
        return new_state in cls.instance_transitions.get(current, set())

    @classmethod
    def can_transition_step(cls, current: str, new_state: str) -> bool:
        return new_state in cls.step_transitions.get(current, set())
