# Workflow Runtime Flow and Logging Guide

This guide explains how workflow services work together and where to see detailed logs.

## Services and Responsibilities

- TriggerDispatcher
  - Polls platform audit logs.
  - Derives workflow event names.
  - Publishes queue events and matches active workflow definitions.

- TimerService
  - Scans waiting timer steps and schedules due workflow resumes.
  - Fires scheduled workflow runs (once/interval/cron).
  - Detects SLA breaches for pending approvals and performs timeout actions.

- WorkflowRuntime
  - Runs the background worker loop.
  - Polls TriggerDispatcher and TimerService each cycle.
  - Consumes queue items and advances workflow instances step-by-step.

- StepExecutor
  - Executes node logic by node type (condition/action/approval/timer/subworkflow).
  - Produces step outputs and waiting/completed/failed statuses.

- EmailService
  - Sends SMTP emails for notifications and escalation alerts.
  - Logs send start, success, and failure outcomes.

## End-to-End Flow

1. Event Ingestion
- Platform changes are captured in audit logs.
- TriggerDispatcher polls new audit entries and derives event names.
- Dispatcher publishes normalized events to queue.

2. Workflow Matching
- Dispatcher scans active workflow definitions for tenant.
- Exact or wildcard trigger event matches are evaluated.
- Matching workflows are queued as start_instance jobs.

3. Instance Execution
- Runtime consumes start_instance and creates WorkflowInstance.
- Runtime locates start node and begins executing nodes in sequence.
- StepExecutor runs each node and returns next status.

4. Waiting and Resuming
- Timer nodes return waiting_timer with next_run_at.
- Approval nodes return waiting_approval until required approvals are met.
- TimerService scans due timers and SLA deadlines, then enqueues resume jobs.

5. Escalation and Alerts
- SLA-breached approvals trigger timeout policy (auto-approve, delegate, or auto-reject).
- Escalation audit logs are written.
- Alert emails are sent to tenant users (best effort).

6. Completion and Webhooks
- Runtime marks instance completed/failed.
- Webhook notifications are sent for workflow.instance.completed / failed.

## Runtime Health Endpoint

Use this endpoint to verify workers are running:

- GET /grc/workflow-engine/runtime/status

Expected response:

{
  "running": true,
  "worker_thread": "workflow-runtime"
}

## Key Log Markers to Watch

- Runtime loop and queue
  - workflow.runtime.cycle
  - workflow.runtime.handle_item
  - workflow.runtime.instance_started
  - workflow.runtime.step_result
  - workflow.runtime.instance_advance
  - workflow.runtime.instance_completed
  - workflow.runtime.instance_failed

- Dispatcher
  - workflow.dispatcher.poll_cycle
  - workflow.dispatcher.publish_event
  - workflow.dispatcher.dispatch_event.start
  - workflow.dispatcher.dispatch_event.triggered
  - workflow.dispatcher.dispatch_event.done

- Scheduler and timers
  - workflow.timer.steps_due
  - workflow.scheduler.due
  - workflow.scheduler.fire
  - workflow.scheduler.next_run
  - workflow.sla.overdue_found
  - workflow.sla.action
  - workflow.sla.processed

- Step execution
  - workflow.step.execute.start
  - workflow.step.execute.condition
  - workflow.step.execute.action
  - workflow.step.execute.approval
  - workflow.step.approval.requests_created
  - workflow.step.approval.waiting
  - workflow.step.approval.completed
  - workflow.step.subworkflow.started

- Email
  - workflow.email.send.start
  - workflow.email.send.success
  - workflow.email.send.failed
  - workflow.email.bulk.start
  - workflow.email.bulk.done

## Notes

- Logs use INFO for major state transitions and WARNING/ERROR for failures.
- Background runtime starts on API startup and stops on shutdown.
- For high-volume production workloads, switch verbose markers to DEBUG as needed.
