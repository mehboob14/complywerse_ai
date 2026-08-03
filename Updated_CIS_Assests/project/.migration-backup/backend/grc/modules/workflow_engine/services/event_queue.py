from queue import Empty, Queue
from typing import Any, Dict, Optional


class WorkflowEventQueue:
    def __init__(self) -> None:
        self._queue: Queue = Queue()

    def publish(self, item: Dict[str, Any]) -> None:
        self._queue.put(item)

    def consume(self, timeout: float = 0.5) -> Optional[Dict[str, Any]]:
        try:
            return self._queue.get(timeout=timeout)
        except Empty:
            return None

    def size(self) -> int:
        return self._queue.qsize()
