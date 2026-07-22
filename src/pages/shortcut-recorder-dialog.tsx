import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/use-i18n";

interface ShortcutRecorderDialogProps {
  open: boolean;
  currentAccelerator: string | null;
  shortcutId?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (accelerator: string) => Promise<boolean>;
}

const modifierCodes = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

const supportedNamedKeys = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backquote",
  "Backslash",
  "Backspace",
  "BracketLeft",
  "BracketRight",
  "CapsLock",
  "Comma",
  "Delete",
  "End",
  "Enter",
  "Equal",
  "Escape",
  "Home",
  "Insert",
  "MediaPlayPause",
  "MediaStop",
  "MediaTrackNext",
  "MediaTrackPrevious",
  "Minus",
  "PageDown",
  "PageUp",
  "Period",
  "PrintScreen",
  "Quote",
  "ScrollLock",
  "Semicolon",
  "Slash",
  "Space",
  "Tab",
  "VolumeDown",
  "VolumeMute",
  "VolumeUp",
]);

function acceleratorKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code;
  if (/^Numpad(?:[0-9]|Add|Decimal|Divide|Enter|Multiply|Subtract)$/.test(event.code)) return event.code;
  if (supportedNamedKeys.has(event.code)) return event.code;

  if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase();
  return null;
}

function modifiersOf(event: KeyboardEvent<HTMLButtonElement>) {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");
  return modifiers;
}

export function ShortcutRecorderDialog({
  open,
  currentAccelerator,
  shortcutId,
  onOpenChange,
  onConfirm,
}: ShortcutRecorderDialogProps) {
  const { t } = useI18n();
  const recorderRef = useRef<HTMLButtonElement>(null);
  const [accelerator, setAccelerator] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAccelerator(null);
    setValidationMessage(null);
    setSubmitting(false);
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      onOpenChange(false);
      return;
    }

    if (modifierCodes.has(event.code)) return;

    if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
      && (event.key === "Backspace" || event.key === "Delete")) {
      setAccelerator(null);
      setValidationMessage(null);
      return;
    }

    const modifiers = modifiersOf(event);
    const key = acceleratorKey(event);
    if (modifiers.length === 0) {
      setAccelerator(null);
      setValidationMessage(t("modules.shortcutRequiresModifier"));
      return;
    }
    if (!key) return;

    setAccelerator([...modifiers, key].join("+"));
    setValidationMessage(null);
  };

  const confirmShortcut = async () => {
    if (!accelerator || submitting) return;
    setSubmitting(true);
    const saved = await onConfirm(accelerator);
    if (saved) {
      onOpenChange(false);
      return;
    }
    setSubmitting(false);
    recorderRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          recorderRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("modules.rebind")}</DialogTitle>
          <DialogDescription>{t("modules.shortcutPrompt")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-center text-xs text-muted-foreground">
            {shortcutId ? `${shortcutId} · ` : ""}
            {t("modules.shortcutCurrent", { shortcut: currentAccelerator ?? t("common.none") })}
          </p>
          <button
            ref={recorderRef}
            type="button"
            disabled={submitting}
            aria-label={t("modules.shortcutCaptureLabel")}
            onKeyDown={handleKeyDown}
            className="flex min-h-36 w-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/40 p-6 outline-none transition-colors hover:bg-muted/60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <Keyboard className="size-7 text-primary" />
            {accelerator ? (
              <span data-testid="shortcut-preview" className="flex flex-wrap items-center justify-center gap-1.5" aria-live="polite">
                {accelerator.split("+").map((part, index) => (
                  <span key={`${part}-${index}`} className="contents">
                    {index > 0 && <span className="text-muted-foreground">+</span>}
                    <kbd className="rounded-md border border-border bg-background px-2.5 py-1 font-mono text-sm shadow-sm">{part}</kbd>
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{t("modules.shortcutWaiting")}</span>
            )}
          </button>
          <p className="min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
            {validationMessage ?? t("modules.shortcutRetryHint")}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!accelerator || submitting} onClick={() => void confirmShortcut()}>
            {t(submitting ? "modules.shortcutSaving" : "common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
