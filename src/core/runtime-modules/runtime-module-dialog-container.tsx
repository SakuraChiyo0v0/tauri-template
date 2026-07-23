import { useEffect, useReducer, useRef } from "react";
import { runtimeModuleDialogBus, type RuntimeModuleDialogRequest } from "@/core/runtime-modules/runtime-module-dialogs";

export function ModuleDialogContainer() {
  const [, force] = useReducer((value: number) => value + 1, 0);
  const currentRef = useRef<RuntimeModuleDialogRequest | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputValueRef = useRef<string>("");

  useEffect(() => {
    runtimeModuleDialogBus.setRenderer((request) => {
      currentRef.current = request;
      inputValueRef.current = request.defaultValue;
      force();
      if (request.kind === "prompt") {
        queueMicrotask(() => inputRef.current?.focus());
      }
    });
    return () => {
      runtimeModuleDialogBus.setRenderer(() => undefined);
    };
  }, []);

  const request = currentRef.current;

  const close = (result: boolean | string | null) => {
    currentRef.current = null;
    force();
    request?.resolve(result);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (request?.kind === "confirm") close(true);
    else close(inputValueRef.current);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(null);
    }
  };

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
      onKeyDown={onKeyDown}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold tracking-tight">{request.title}</h2>
        {request.message && <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{request.message}</p>}
        {request.kind === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={request.placeholder}
            defaultValue={request.defaultValue}
            onChange={(event) => { inputValueRef.current = event.target.value; }}
          />
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
            onClick={() => close(null)}
          >
            {request.cancelLabel}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
