import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiClientError } from '../../api/errors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import type { PurchasingApi } from '../purchasingApi.ts';
import type { Vendor } from '../types.ts';

export interface VendorFormModalProps {
  open: boolean;
  api: PurchasingApi;
  onClose: () => void;
  onCreated: (vendor: Vendor) => Promise<void> | void;
}

interface VendorFieldErrors {
  name?: string;
  contact?: string;
}

function VendorFormContent({
  api,
  isSubmitting,
  onSubmittingChange,
  onClose,
  onCreated,
}: {
  api: PurchasingApi;
  isSubmitting: boolean;
  onSubmittingChange: (pending: boolean) => void;
  onClose: () => void;
  onCreated: (vendor: Vendor) => Promise<void> | void;
}) {
  const nameId = useId();
  const nameErrorId = useId();
  const contactId = useId();
  const contactHintId = useId();
  const contactErrorId = useId();

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [fieldErrors, setFieldErrors] = useState<VendorFieldErrors>({});
  const [submitError, setSubmitError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);

  const submittingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const contactInputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || isSubmitting) {
      return;
    }

    const trimmedName = name.trim();
    const trimmedContact = contact.trim();
    const nextErrors: VendorFieldErrors = {};

    if (!trimmedName) {
      nextErrors.name = 'Enter a vendor name.';
    } else if (trimmedName.length > 200) {
      nextErrors.name = 'Vendor name must not exceed 200 characters.';
    }

    if (trimmedContact.length > 200) {
      nextErrors.contact = 'Contact must not exceed 200 characters.';
    }

    if (nextErrors.name || nextErrors.contact) {
      setFieldErrors(nextErrors);
      setSubmitError({ message: 'Please correct the highlighted vendor fields.' });
      if (nextErrors.name) {
        nameInputRef.current?.focus();
      } else {
        contactInputRef.current?.focus();
      }
      return;
    }

    submittingRef.current = true;
    onSubmittingChange(true);
    setFieldErrors({});
    setSubmitError(null);

    try {
      const created = await api.createVendor({
        name: trimmedName,
        contact: trimmedContact || null,
      });
      await onCreated(created);
      onClose();
    } catch (error) {
      if (isApiClientError(error)) {
        const mapped: VendorFieldErrors = {};
        for (const item of error.fieldErrors) {
          if (item.field === 'name' && !mapped.name) {
            mapped.name = item.message;
          } else if (item.field === 'contact' && !mapped.contact) {
            mapped.contact = item.message;
          }
        }
        setFieldErrors(mapped);
        setSubmitError({
          message: error.message || 'Could not create vendor.',
          requestId: error.requestId,
        });
      } else {
        setSubmitError({ message: 'Could not create vendor. Please try again.' });
      }
    } finally {
      submittingRef.current = false;
      onSubmittingChange(false);
    }
  };

  const contactDescribedBy = fieldErrors.contact
    ? `${contactHintId} ${contactErrorId}`
    : contactHintId;

  return (
    <>
      {submitError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{submitError.message}</p>
            {submitError.requestId ? (
              <p className="alert-banner__meta">Request ID: {submitError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <form className="catalog-modal-form" onSubmit={handleSubmit} noValidate>
        <div className="catalog-field">
          <label htmlFor={nameId} className="catalog-label">
            Vendor name <span className="form-required" aria-hidden="true">*</span>
          </label>
          <input
            ref={nameInputRef}
            id={nameId}
            name="vendorName"
            type="text"
            className="catalog-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (fieldErrors.name && event.target.value.trim()) {
                setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            maxLength={200}
            required
            autoFocus
            aria-invalid={fieldErrors.name ? 'true' : 'false'}
            aria-describedby={fieldErrors.name ? nameErrorId : undefined}
          />
          {fieldErrors.name ? (
            <p id={nameErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{fieldErrors.name}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-field">
          <label htmlFor={contactId} className="catalog-label">
            Contact (optional)
          </label>
          <span id={contactHintId} className="catalog-field-hint">
            Phone number, email address, or contact person.
          </span>
          <input
            ref={contactInputRef}
            id={contactId}
            name="vendorContact"
            type="text"
            className="catalog-input"
            value={contact}
            onChange={(event) => {
              setContact(event.target.value);
              if (fieldErrors.contact && event.target.value.trim().length <= 200) {
                setFieldErrors((prev) => ({ ...prev, contact: undefined }));
              }
            }}
            maxLength={200}
            aria-invalid={fieldErrors.contact ? 'true' : 'false'}
            aria-describedby={contactDescribedBy}
          />
          {fieldErrors.contact ? (
            <p id={contactErrorId} className="catalog-field-error">
              <span aria-hidden="true">!</span>
              <span>{fieldErrors.contact}</span>
            </p>
          ) : null}
        </div>

        <div className="catalog-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Create vendor'}
          </button>
        </div>
      </form>
    </>
  );
}

export function VendorFormModal({ open, api, onClose, onCreated }: VendorFormModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    onClose();
  };

  return (
    <ModalDialog
      open={open}
      title="New vendor"
      onClose={handleClose}
      preventClose={isSubmitting}
    >
      {open ? (
        <VendorFormContent
          api={api}
          isSubmitting={isSubmitting}
          onSubmittingChange={setIsSubmitting}
          onClose={handleClose}
          onCreated={onCreated}
        />
      ) : null}
    </ModalDialog>
  );
}
