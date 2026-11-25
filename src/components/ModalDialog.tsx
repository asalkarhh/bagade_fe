import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from 'react';
import './ModalDialog.css';

export interface ModalDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  preventClose?: boolean;
  children: ReactNode;
}

export function ModalDialog({
  open,
  title,
  onClose,
  preventClose = false,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.returnValue = '';
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      dialog.returnValue = '';
    }
  }, [open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (preventClose) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    onClose();
  };

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = '';
    }
    if (open) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClose={handleClose}
    >
      <div className="app-dialog__header">
        <h1 id={titleId} className="app-dialog__title">
          {title}
        </h1>
        <button
          type="button"
          className="app-dialog__close"
          onClick={onClose}
          disabled={preventClose}
          aria-label="Close dialog"
        >
          Close
        </button>
      </div>
      <div className="app-dialog__body">{open ? children : null}</div>
    </dialog>
  );
}
