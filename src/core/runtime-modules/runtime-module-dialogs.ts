import type {
  RuntimeModuleConfirmOptions,
  RuntimeModuleDialogs,
  RuntimeModulePromptOptions,
} from "./runtime-module-types";

const MAX_TITLE = 200;
const MAX_MESSAGE = 2000;
const MAX_LABEL = 40;
const MAX_INPUT = 500;

export type RuntimeModuleDialogKind = "confirm" | "prompt";

export interface RuntimeModuleDialogRequest {
  readonly kind: RuntimeModuleDialogKind;
  readonly moduleId: string;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly defaultValue: string;
  readonly placeholder: string;
  resolve(value: boolean | string | null): void;
  cancel(): void;
}

export type RuntimeModuleDialogRenderer = (request: RuntimeModuleDialogRequest) => void;

interface PendingRequest {
  readonly moduleId: string;
  readonly render: () => void;
  resolve(value: boolean | string | null): void;
  cancel(): void;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max);
}

export class RuntimeModuleDialogBus {
  private renderer: RuntimeModuleDialogRenderer | undefined;
  private queue: PendingRequest[] = [];
  private busy = false;
  private readonly active = new Set<string>();

  setRenderer(renderer: RuntimeModuleDialogRenderer) {
    this.renderer = renderer;
    this.pump();
  }

  createModuleApi(moduleId: string): RuntimeModuleDialogs {
    this.active.add(moduleId);
    return {
      confirm: (options) => this.enqueue(moduleId, "confirm", options) as Promise<boolean>,
      prompt: (options) => this.enqueue(moduleId, "prompt", options) as Promise<string | null>,
    };
  }

  releaseModule(moduleId: string) {
    this.active.delete(moduleId);
    for (const pending of this.queue) {
      if (pending.moduleId === moduleId) pending.cancel();
    }
    this.queue = this.queue.filter((pending) => pending.moduleId !== moduleId);
    this.pump();
  }

  private enqueue(
    moduleId: string,
    kind: RuntimeModuleDialogKind,
    options: RuntimeModuleConfirmOptions | RuntimeModulePromptOptions,
  ): Promise<boolean | string | null> {
    if (!this.active.has(moduleId)) {
      return Promise.reject(new Error(`Host SDK dialogs for module ${moduleId} have been released.`));
    }
    const title = truncate(options.title ?? "", MAX_TITLE);
    const message = truncate((options as { message?: string }).message ?? "", MAX_MESSAGE);
    const confirmLabel = truncate((options as { confirmLabel?: string }).confirmLabel ?? "", MAX_LABEL) || "OK";
    const cancelLabel = truncate((options as { cancelLabel?: string }).cancelLabel ?? "", MAX_LABEL) || "Cancel";
    const defaultValue = truncate((options as RuntimeModulePromptOptions).defaultValue ?? "", MAX_INPUT);
    const placeholder = truncate((options as RuntimeModulePromptOptions).placeholder ?? "", MAX_INPUT);
    return new Promise<boolean | string | null>((resolve) => {
      let settled = false;
      const pending: PendingRequest = {
        moduleId,
        resolve: (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
          this.advance();
        },
        cancel: () => {
          if (settled) return;
          settled = true;
          resolve(kind === "confirm" ? false : null);
          this.advance();
        },
        render: () => {
          const renderer = this.renderer;
          if (!renderer) {
            pending.cancel();
            return;
          }
          const request: RuntimeModuleDialogRequest = {
            kind,
            moduleId,
            title,
            message,
            confirmLabel,
            cancelLabel,
            defaultValue,
            placeholder,
            resolve: (value) => pending.resolve(value),
            cancel: () => pending.cancel(),
          };
          renderer(request);
        },
      };
      this.queue.push(pending);
      this.pump();
    });
  }

  private advance() {
    this.busy = false;
    this.queue.shift();
    this.pump();
  }

  private pump() {
    if (this.busy) return;
    const next = this.queue[0];
    if (!next) return;
    this.busy = true;
    next.render();
  }
}

export function createRuntimeModuleDialogBus() {
  return new RuntimeModuleDialogBus();
}

export const runtimeModuleDialogBus = createRuntimeModuleDialogBus();
