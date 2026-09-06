import { Subject } from 'rxjs';

export type TaskStatus =
  | 'initializing'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'
  | 'ready';

export type FlowStep =
  | 'initializing'
  | 'resolving_group'
  | 'attaching_frida'
  | 'navigating_viber'
  | 'paging_participants'
  | 'syncing_live_db'
  | 'restarting_viber'
  | 'waiting_numbers_sync'
  | 'deduplicating_and_finalizing'
  | 'fetching_online_activity'
  | 'exporting_results';

export interface TaskStepInfo {
  step: FlowStep;
  description: string;
  startedAt: string;
  durationMs?: number | undefined;
  progress?: Record<string, unknown> | undefined;
}

export interface TaskEvent {
  taskId: string;
  status: TaskStatus;
  step?: TaskStepInfo | undefined;
  progress?: Record<string, unknown> | undefined;
  error?: string | undefined;
  timestamp: string;
}

export class TaskEntity {
  readonly id: string;
  readonly groupTarget: string;
  readonly createdAt: Date;
  readonly abortController = new AbortController();
  readonly events$ = new Subject<TaskEvent>();

  status: TaskStatus = 'initializing';
  groupName?: string | undefined;
  conversationId?: number | undefined;
  currentStep: TaskStepInfo | null = null;
  stepHistory: TaskStepInfo[] = [];
  progress: Record<string, unknown> | null = null;
  error: string | null = null;
  result: Record<string, unknown> | null = null;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;

  constructor(id: string, groupTarget: string) {
    this.id = id;
    this.groupTarget = groupTarget;
    this.createdAt = new Date();
    this.setStep('initializing', 'Инициализация задачи и проверка параметров');
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  setStep(
    step: FlowStep,
    description: string,
    progress?: Record<string, unknown> | undefined,
  ): void {
    const now = new Date();

    if (this.currentStep) {
      const stepStartTime = new Date(this.currentStep.startedAt).getTime();
      this.currentStep.durationMs = Math.max(0, now.getTime() - stepStartTime);
      this.stepHistory.push({ ...this.currentStep });
    }

    this.currentStep = {
      step,
      description,
      startedAt: now.toISOString(),
      ...(progress !== undefined ? { progress } : {}),
    };

    if (progress) {
      this.progress = { ...(this.progress ?? {}), ...progress };
    }

    if (step === 'attaching_frida' || step === 'navigating_viber') {
      if (this.status === 'initializing') {
        this.status = 'starting';
        this.startedAt = now;
      }
    } else if (
      step === 'paging_participants' ||
      step === 'syncing_live_db' ||
      step === 'restarting_viber' ||
      step === 'waiting_numbers_sync' ||
      step === 'deduplicating_and_finalizing' ||
      step === 'exporting_results'
    ) {
      this.status = 'running';
    }

    this.emitEvent();
  }

  updateProgress(progress: Record<string, unknown>): void {
    this.progress = { ...(this.progress ?? {}), ...progress };
    if (this.currentStep) {
      this.currentStep.progress = { ...(this.currentStep.progress ?? {}), ...progress };
    }
    this.emitEvent();
  }

  complete(result: Record<string, unknown>): void {
    const now = new Date();
    if (this.currentStep) {
      const stepStartTime = new Date(this.currentStep.startedAt).getTime();
      this.currentStep.durationMs = Math.max(0, now.getTime() - stepStartTime);
      this.stepHistory.push({ ...this.currentStep });
      this.currentStep = null;
    }
    this.status = 'ready';
    this.result = result;
    this.completedAt = now;
    this.emitEvent();
    this.events$.complete();
  }

  fail(errorMessage: string): void {
    const now = new Date();
    if (this.currentStep) {
      const stepStartTime = new Date(this.currentStep.startedAt).getTime();
      this.currentStep.durationMs = Math.max(0, now.getTime() - stepStartTime);
      this.stepHistory.push({ ...this.currentStep });
    }
    this.status = 'error';
    this.error = errorMessage;
    this.completedAt = now;
    this.emitEvent();
    this.events$.complete();
  }

  stop(): void {
    const now = new Date();
    this.abortController.abort();
    if (this.currentStep) {
      const stepStartTime = new Date(this.currentStep.startedAt).getTime();
      this.currentStep.durationMs = Math.max(0, now.getTime() - stepStartTime);
      this.stepHistory.push({ ...this.currentStep });
    }
    this.status = 'stopped';
    this.completedAt = now;
    this.emitEvent();
    this.events$.complete();
  }

  private emitEvent(): void {
    this.events$.next({
      taskId: this.id,
      status: this.status,
      step: this.currentStep ?? undefined,
      progress: this.progress ?? undefined,
      error: this.error ?? undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
