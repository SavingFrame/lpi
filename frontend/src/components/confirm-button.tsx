import { useEffect, useId, useRef, useState } from 'react';
import { Button, type ButtonProps } from './ui/button';

export function ConfirmButton({
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  disabled,
  children,
  ...props
}: Omit<ButtonProps, 'onClick'> & {
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
    } else if (open) {
      cancel.current?.focus();
    } else if (wasOpen.current) {
      trigger.current?.focus();
    }
    wasOpen.current = open;
  }, [disabled, open]);

  function close() {
    setOpen(false);
  }

  return (
    <div
      className={
        message
          ? 'flex min-w-0 flex-col items-start gap-2'
          : 'relative inline-grid shrink-0 items-center'
      }
    >
      <Button
        {...props}
        ref={trigger}
        className={`${props.className ?? ''} ${!message ? 'col-start-1 row-start-1' : ''} ${open && !disabled && !message ? 'invisible' : ''}`}
        aria-hidden={open && !disabled && !message ? true : undefined}
        tabIndex={open && !disabled && !message ? -1 : props.tabIndex}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? `${descriptionId}-confirmation` : undefined}
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
          }
        }}
      >
        {children}
      </Button>
      {open && !disabled && (
        <fieldset
          id={`${descriptionId}-confirmation`}
          className={
            message
              ? 'w-full max-w-sm rounded-md border border-input bg-background p-3 text-xs'
              : 'absolute inset-0 m-0 min-w-0 border-0 p-0'
          }
          aria-describedby={message ? descriptionId : undefined}
          aria-label={confirmLabel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          {message && (
            <p id={descriptionId} className="mb-3 text-muted-foreground">
              {message}
            </p>
          )}
          <div className={message ? 'flex flex-wrap gap-2' : 'flex h-full items-center gap-1'}>
            <Button
              ref={cancel}
              type="button"
              variant="outline"
              size="sm"
              className={message ? undefined : 'min-w-0 flex-1 px-2'}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              className={message ? undefined : 'min-w-0 flex-1 px-2'}
              onClick={() => {
                close();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
