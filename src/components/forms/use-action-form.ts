"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import type { FieldErrors } from "@/lib/validation/field-errors";

type ActionResult = { ok: boolean } | null;

// reset() generation at the time each submit was dispatched (useActionState runs submits in a queue).
const dispatchGeneration = new WeakMap<FormData, number>();

function failureOf(state: ActionResult): { error?: string; fieldErrors?: FieldErrors } | null {
  return state && !state.ok ? (state as { error?: string; fieldErrors?: FieldErrors }) : null;
}

// `data-field` lets an input answer for a field whose submitted name differs (e.g. "lines.0.plannedAmount").
function fieldKey(el: Element): string | undefined {
  return (el as HTMLElement).dataset.field ?? (el as HTMLInputElement).name;
}

function focusAfterError(
  form: HTMLFormElement | null,
  fieldErrors: FieldErrors | undefined,
  submitter: HTMLElement | null,
) {
  if (!form) return;
  for (const el of Array.from(form.elements)) {
    const key = fieldKey(el);
    if (!key || !fieldErrors?.[key]) continue;
    if ((el as HTMLInputElement).type === "hidden" || el.matches(":disabled")) continue;
    const details = el.closest("details");
    if (details) details.open = true;
    (el as HTMLElement).focus();
    return;
  }
  const active = document.activeElement;
  if (active && active !== document.body) return;
  if (submitter?.isConnected) submitter.focus();
}

// useActionState for forms that keep the user's input after a failed submit.
// Edit-in-place forms must pass `resetOnSuccess: false`: reset() restores each <select> to its
// mount-time default, which React does not update, so the next save would revert it.
export function useActionForm<S extends ActionResult>(
  action: (prev: S, formData: FormData) => Promise<S>,
  {
    onSuccess,
    resetOnSuccess = true,
  }: {
    // `stale`: reset() ran while the submit was in flight; the mutation still happened.
    onSuccess?: (state: Extract<S, { ok: true }>, meta: { stale: boolean }) => void;
    resetOnSuccess?: boolean;
  } = {},
) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitterRef = useRef<HTMLElement | null>(null);
  const generationRef = useRef(0);
  const idPrefix = useId();
  const [state, dispatch, pending] = useActionState<S, FormData>(async (prev, formData) => {
    const generation = dispatchGeneration.get(formData) ?? generationRef.current;
    const next = await action(prev, formData);
    // reset() ran meanwhile: keep the result out of the new session (no stale error, no
    // reset of fields typed since), but still let the caller react to a success.
    const stale = generation !== generationRef.current;
    if (next?.ok) {
      if (resetOnSuccess && !stale) formRef.current?.reset();
      onSuccess?.(next as Extract<S, { ok: true }>, { stale });
    }
    return stale ? prev : next;
  }, null as Awaited<S>);
  const [dismissed, setDismissed] = useState<Awaited<S> | null>(null);
  const current = state !== null && state === dismissed ? null : state;
  const [cleared, setCleared] = useState<{ state: Awaited<S> | null; keys: string[] }>({
    state: null,
    keys: [],
  });
  const failure = failureOf(current);
  const allFieldErrors = failure?.fieldErrors ?? {};
  const fieldErrors =
    cleared.state === current && cleared.keys.length
      ? Object.fromEntries(
          Object.entries(allFieldErrors).filter(([k]) => !cleared.keys.includes(k)),
        )
      : allFieldErrors;
  // A field already shows (or showed) this exact error: the summary alert would only repeat it.
  const error =
    failure?.error && !Object.values(allFieldErrors).includes(failure.error) ? failure.error : null;

  useEffect(() => {
    const f = failureOf(state);
    if (f) focusAfterError(formRef.current, f.fieldErrors, submitterRef.current);
  }, [state]);

  const errorId = (name: string) => `${idPrefix}-${name}-error`;

  return {
    state: current,
    pending,
    error,
    fieldError: (name: string): string | undefined => fieldErrors[name],
    errorId,
    // `describedBy` keeps an existing hint linked.
    fieldProps: (name: string, describedBy?: string) => ({
      "aria-invalid": fieldErrors[name] ? true : undefined,
      "aria-describedby":
        [fieldErrors[name] ? errorId(name) : null, describedBy].filter(Boolean).join(" ") ||
        undefined,
    }),
    // onSubmit prevents default and dispatches itself, so React skips its post-action form reset
    // (`action` only serves pre-hydration replay, avoiding a native GET with the fields in the URL).
    // A replayed pre-hydration submit still goes through React's action path, so it does reset.
    formProps: {
      ref: formRef,
      action: dispatch,
      onSubmit: (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        submitterRef.current = submitter;
        const formData = new FormData(e.currentTarget, submitter);
        dispatchGeneration.set(formData, generationRef.current);
        startTransition(() => dispatch(formData));
      },
    },
    // For errors that went stale client-side, e.g. positional "lines.N.*" after a row is removed.
    clearFieldErrors: (match: (name: string) => boolean) =>
      setCleared({
        state: current,
        keys: Object.keys(allFieldErrors).filter((k) => match(k) || !(k in fieldErrors)),
      }),
    // Hides the last result (e.g. when its dialog closes) and drops any in-flight one.
    reset: () => {
      generationRef.current += 1;
      setDismissed(state);
    },
  };
}

export type ActionForm = ReturnType<typeof useActionForm>;
