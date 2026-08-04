from typing import Any, Dict


class ConditionEvaluator:
    @staticmethod
    def _get_path(data: Dict[str, Any], path: str) -> Any:
        current: Any = data
        for part in path.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current

    @classmethod
    def evaluate(cls, condition: Dict[str, Any], data: Dict[str, Any]) -> bool:
        if not condition:
            return True

        if "all" in condition:
            return all(cls.evaluate(child, data) for child in condition.get("all", []))

        if "any" in condition:
            return any(cls.evaluate(child, data) for child in condition.get("any", []))

        if "not" in condition:
            return not cls.evaluate(condition.get("not", {}), data)

        path = condition.get("path")
        operator = condition.get("operator", "eq")
        expected = condition.get("value")

        if not path:
            return True

        actual = cls._get_path(data, path)

        if operator == "eq":
            return actual == expected
        if operator == "neq":
            return actual != expected
        if operator == "gt":
            return actual is not None and expected is not None and actual > expected
        if operator == "gte":
            return actual is not None and expected is not None and actual >= expected
        if operator == "lt":
            return actual is not None and expected is not None and actual < expected
        if operator == "lte":
            return actual is not None and expected is not None and actual <= expected
        if operator == "in":
            return actual in (expected or [])
        if operator == "contains":
            return expected in (actual or [])
        if operator == "exists":
            return actual is not None
        if operator == "not_exists":
            return actual is None

        return False
